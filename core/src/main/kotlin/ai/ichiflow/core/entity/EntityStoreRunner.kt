package ai.ichiflow.core.entity

import ai.ichiflow.core.entity.spi.EntityNotFoundException
import ai.ichiflow.core.entity.spi.EntityQuerySpec
import ai.ichiflow.core.entity.spi.EntityRepository
import ai.ichiflow.core.entity.spi.StoredEntity
import ai.ichiflow.core.entity.store.InMemoryEntityRepository
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File

/**
 * Entity-store conformance runner (build plan 4.1, harness-first). For every committed
 * `EntityStoreVector` it replays the CRUD/query ops against a fresh [InMemoryEntityRepository] behind
 * the [EntityRepository] SPI, asserting: generated-repo **round-trip** (create/update read back exactly,
 * versions and soft-delete honoured, query/pagination/search return the pinned page), and the
 * **transactional outbox** — the audit log and outbox match the pinned oracle in order and relaying the
 * outbox marks every record delivered. Writes `core/build/entity-store-results.json`, consumed by the
 * `entity-store` verify scope for `vectors_green / total` and `outbox_delivered / total`.
 *
 * Fully deterministic (retry-forbidden, doc 13 §3.6): a fresh store per vector, monotonic sequence
 * stamps, no wall-clock or RNG.
 */
object EntityStoreRunner {

    @JvmStatic
    fun main(args: Array<String>) {
        val repoRoot = File("..").canonicalFile
        val vectorsDir = File(repoRoot, args.getOrElse(0) { "schemas/entity-store/vectors" })
        val outputFile = File(args.getOrElse(1) { "build/entity-store-results.json" })

        val mapper = ObjectMapper().registerKotlinModule()
        val vectorFiles = vectorsDir.listFiles { f -> f.name.endsWith(".vector.json") }
            ?.sortedBy { it.name }
            ?: emptyList()

        val root = mapper.createObjectNode()
        root.put("vectorsDir", vectorsDir.relativeToOrSelf(repoRoot).path)
        val arr = root.putArray("vectors")

        var green = 0
        var outboxDelivered = 0
        var outboxTotal = 0
        for (file in vectorFiles) {
            val vector = mapper.readTree(file)
            val node = arr.addObject()
            val result = runVector(vector, node)
            if (result.pass) green++
            outboxDelivered += result.delivered
            outboxTotal += result.outboxSize
        }

        root.put("vectorsGreen", green)
        root.put("total", vectorFiles.size)
        root.put("outboxDelivered", outboxDelivered)
        root.put("outboxTotal", outboxTotal)

        outputFile.parentFile.mkdirs()
        outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
        println("Wrote ${vectorFiles.size} entity-store vector results ($green green) to ${outputFile.path}")
    }

    private data class VectorResult(val pass: Boolean, val delivered: Int, val outboxSize: Int)

    private fun runVector(vector: JsonNode, node: ObjectNode): VectorResult {
        val name = vector["name"].asText()
        val entityType = vector["entityType"].asText()
        node.put("name", name)
        node.put("entityType", entityType)

        val repo: EntityRepository = InMemoryEntityRepository()
        val failure = try {
            runOps(entityType, repo, vector["ops"])
        } catch (ex: EntityNotFoundException) {
            "op threw: ${ex.message}"
        } catch (ex: IllegalArgumentException) {
            "op threw: ${ex.message}"
        }

        val expect = vector["expect"]
        val auditFailure = failure ?: auditFailure(repo, expect["audit"])
        val outboxFailure = auditFailure ?: outboxFailure(repo, expect["outbox"])

        val delivered = repo.relayOutbox()
        val outboxSize = repo.outbox().size
        val allDelivered = repo.outbox().all { it.delivered }
        val expectAllDelivered = expect["outboxDeliveredAll"].asBoolean()
        val deliveryFailure = outboxFailure ?: when {
            allDelivered != expectAllDelivered ->
                "outboxDeliveredAll expected $expectAllDelivered, got $allDelivered"
            allDelivered && delivered != outboxSize ->
                "relay dispatched $delivered of $outboxSize outbox records"
            else -> null
        }

        node.put("pass", deliveryFailure == null)
        node.put("detail", deliveryFailure ?: "ok")
        node.put("outboxSize", outboxSize)
        node.put("delivered", delivered)
        return VectorResult(deliveryFailure == null, delivered, outboxSize)
    }

    private fun runOps(entityType: String, repo: EntityRepository, ops: JsonNode): String? {
        for (op in ops) {
            val failure = runOp(entityType, repo, op)
            if (failure != null) return failure
        }
        return null
    }

    private fun runOp(entityType: String, repo: EntityRepository, op: JsonNode): String? {
        return when (val kind = op["operation"].asText()) {
            "create" -> {
                repo.create(entityType, op["id"].asText(), op["caseId"]?.asText(), readData(op["data"]))
                null
            }
            "update" -> {
                repo.update(entityType, op["id"].asText(), readData(op["data"]))
                null
            }
            "delete" -> {
                repo.delete(entityType, op["id"].asText())
                null
            }
            "get" -> getFailure(entityType, repo, op)
            "list" -> listFailure(repo, op)
            else -> "unknown op '$kind'"
        }
    }

    private fun getFailure(entityType: String, repo: EntityRepository, op: JsonNode): String? {
        val id = op["id"].asText()
        val stored = repo.get(entityType, id)
        if (op["expectMissing"]?.asBoolean() == true) {
            return if (stored == null) null else "get $id expected missing, got version ${stored.version}"
        }
        if (stored == null) return "get $id expected present, got missing"
        val versionFailure = op["expectVersion"]?.let {
            if (stored.version != it.asInt()) "get $id version expected ${it.asInt()}, got ${stored.version}" else null
        }
        return versionFailure ?: fieldFailure(id, stored, op["expect"])
    }

    private fun fieldFailure(id: String, stored: StoredEntity, expect: JsonNode?): String? {
        if (expect == null) return null
        for ((field, value) in expect.fields()) {
            val actual = stringify(stored.data[field])
            val wanted = stringify(readScalar(value))
            if (actual != wanted) return "get $id field '$field' expected $wanted, got $actual"
        }
        return null
    }

    private fun listFailure(repo: EntityRepository, op: JsonNode): String? {
        val query = op["query"]
        val spec = EntityQuerySpec(
            entityType = query["entityType"].asText(),
            filter = query["filter"]?.fields()?.asSequence()?.associate { (k, v) -> k to stringify(readScalar(v)) }
                ?: emptyMap(),
            search = query["search"]?.asText(),
            sort = query["sort"]?.asText(),
            page = query["page"].asInt(),
            size = query["size"].asInt(),
        )
        val page = repo.query(spec)
        op["expectTotal"]?.let {
            if (page.total != it.asInt()) return "list total expected ${it.asInt()}, got ${page.total}"
        }
        op["expectIds"]?.let {
            val expectIds = it.map { id -> id.asText() }
            if (page.ids != expectIds) return "list ids expected $expectIds, got ${page.ids}"
        }
        return null
    }

    private fun readData(data: JsonNode): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>()
        data.fields().forEach { (k, v) -> map[k] = readScalar(v) }
        return map
    }

    private fun readScalar(v: JsonNode): Any? = when {
        v.isNumber -> v.numberValue()
        v.isBoolean -> v.booleanValue()
        v.isNull -> null
        else -> v.asText()
    }

    private fun auditFailure(repo: EntityRepository, expected: JsonNode): String? {
        val actual = repo.auditLog()
        if (actual.size != expected.size()) return "audit expected ${expected.size()} entries, got ${actual.size}"
        expected.forEachIndexed { i, exp ->
            val entry = actual[i]
            if (entry.operation.wire() != exp["operation"].asText() ||
                entry.id != exp["id"].asText() ||
                entry.version != exp["version"].asInt()
            ) {
                return "audit[$i] expected ${exp["operation"].asText()}/${exp["id"].asText()}/v${exp["version"].asInt()}, " +
                    "got ${entry.operation.wire()}/${entry.id}/v${entry.version}"
            }
        }
        return null
    }

    private fun outboxFailure(repo: EntityRepository, expected: JsonNode): String? {
        val actual = repo.outbox()
        if (actual.size != expected.size()) return "outbox expected ${expected.size()} records, got ${actual.size}"
        expected.forEachIndexed { i, exp ->
            val entry = actual[i]
            if (entry.operation.wire() != exp["operation"].asText() || entry.id != exp["id"].asText()) {
                return "outbox[$i] expected ${exp["operation"].asText()}/${exp["id"].asText()}, " +
                    "got ${entry.operation.wire()}/${entry.id}"
            }
        }
        return null
    }

    private fun stringify(value: Any?): String = when (value) {
        null -> ""
        is Double -> if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
        is Int -> value.toString()
        is Long -> value.toString()
        else -> value.toString()
    }
}
