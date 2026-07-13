package ai.ichiflow.core.authz

import ai.ichiflow.core.authz.engine.AuthzModel
import ai.ichiflow.core.authz.engine.InMemoryOpenFgaEngine
import ai.ichiflow.core.authz.engine.RelationTuple
import ai.ichiflow.core.authz.pep.ArtifactAccessPep
import ai.ichiflow.core.authz.pep.RuntimeAccessPep
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File

/**
 * Authz PDP-slice conformance runner (build plan 4.3, doc 13 §2.f, harness-first). It loads the
 * committed OpenFGA-style model + relationship graph, binds the reference [InMemoryOpenFgaEngine]
 * behind the [Pdp], and replays every committed allow/deny vector.
 *
 * It proves the **design-time = runtime, one PDP** invariant: the surface-matched PEP produces each
 * vector's decision (and its decision log), and — crucially — the **same** vector is *also* run through
 * *both* the [ArtifactAccessPep] and the [RuntimeAccessPep]; if the two enforcement points ever
 * disagree, `parity` fails, because the "one PDP" claim is broken. Writes `core/build/authz-results.json`
 * (consumed by the `authz` verify scope): `vectors_green / total`, `parity(design-time, runtime)`,
 * design-time/runtime coverage counts, and the full decision log.
 *
 * Fully deterministic (retry-forbidden, doc 13 §3.6): fixed model + graph, stable evaluation order,
 * content-hash decision ids, no wall-clock or RNG.
 */
object AuthzRunner {

    private val mapper = ObjectMapper().registerKotlinModule()

    /** Running aggregates over the vector corpus. */
    private data class Totals(
        var green: Int = 0,
        var designTimeCovered: Int = 0,
        var runtimeCovered: Int = 0,
        var parityPass: Boolean = true,
    )

    @JvmStatic
    fun main(args: Array<String>) {
        val repoRoot = File("..").canonicalFile
        val authzDir = File(repoRoot, args.getOrElse(0) { "schemas/authz" })
        val outputFile = File(args.getOrElse(1) { "build/authz-results.json" })

        val model = mapper.treeToValue(mapper.readTree(File(authzDir, "model.json")), AuthzModel::class.java)
        val tuples = mapper.readTree(File(authzDir, "tuples.json")).map {
            RelationTuple(it["object"].asText(), it["relation"].asText(), it["user"].asText())
        }
        val vectors = File(authzDir, "vectors").listFiles { f -> f.name.endsWith(".vectors.json") }
            ?.sortedBy { it.name }
            ?.flatMap { file -> mapper.readTree(file).map { it } }
            ?: emptyList()

        // Primary path: the surface-matched PEP, logged. Parity path: run every vector through BOTH
        // PEPs (on a separate PDP) and require agreement — the "one PDP" proof.
        val pdp = Pdp(InMemoryOpenFgaEngine(model, tuples))
        val primary = Peps(ArtifactAccessPep(pdp), RuntimeAccessPep(pdp))
        val parityPdp = Pdp(InMemoryOpenFgaEngine(model, tuples))
        val parity = Peps(ArtifactAccessPep(parityPdp), RuntimeAccessPep(parityPdp))

        val root = mapper.createObjectNode()
        root.put("authzDir", authzDir.relativeToOrSelf(repoRoot).path)
        val arr = root.putArray("vectors")
        val totals = Totals()
        for (v in vectors) evaluateVector(v, primary, parity, totals, arr.addObject())

        root.put("vectorsGreen", totals.green)
        root.put("total", vectors.size)
        root.put("parityPass", totals.parityPass)
        root.put("designTimeCovered", totals.designTimeCovered)
        root.put("runtimeCovered", totals.runtimeCovered)
        root.put("decisionLogsComplete", writeDecisionLog(pdp, vectors.size, root.putArray("decisionLog")))

        outputFile.parentFile.mkdirs()
        outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
        println(
            "Wrote ${vectors.size} authz vector results " +
                "(${totals.green} green, parity=${totals.parityPass}) to ${outputFile.path}",
        )
    }

    private data class Peps(val artifact: ArtifactAccessPep, val runtime: RuntimeAccessPep)

    private fun evaluateVector(v: JsonNode, primary: Peps, parity: Peps, totals: Totals, node: ObjectNode) {
        val surface = v["surface"].asText()
        val subject = v["subject"].asText()
        val relation = v["relation"].asText()
        val obj = v["object"].asText()
        val expect = v["expect"].asText()
        val context = readContext(v["context"])

        val decision = if (surface == "design-time") {
            totals.designTimeCovered++
            primary.artifact.mayAccess(subject, relation, obj, context)
        } else {
            totals.runtimeCovered++
            primary.runtime.mayAccess(subject, relation, obj, context)
        }
        val actual = if (decision.allow) "allow" else "deny"
        val pass = actual == expect
        if (pass) totals.green++

        // One PDP: the artifact-access and data-access enforcement points must never disagree.
        val agrees = parity.artifact.mayAccess(subject, relation, obj, context).allow ==
            parity.runtime.mayAccess(subject, relation, obj, context).allow
        if (!agrees) totals.parityPass = false

        node.put("name", v["name"].asText())
        node.put("surface", surface)
        node.put("subject", subject)
        node.put("relation", relation)
        node.put("object", obj)
        node.put("expect", expect)
        node.put("actual", actual)
        node.put("pass", pass)
        node.put("parity", agrees)
        node.put("reason", decision.reason)
    }

    /** Writes the decision log and returns whether it is complete (one non-blank entry per decision). */
    private fun writeDecisionLog(pdp: Pdp, expectedCount: Int, logArr: ArrayNode): Boolean {
        val log = pdp.decisionLog()
        var complete = log.size == expectedCount
        for (entry in log) {
            writeLogEntry(logArr.addObject(), entry)
            if (entry.decisionId.isBlank() || entry.reason.isBlank()) complete = false
        }
        return complete
    }

    private fun readContext(node: JsonNode?): Map<String, Any?> {
        if (node == null || node.isNull) return emptyMap()
        val map = LinkedHashMap<String, Any?>()
        for (k in node.fieldNames()) {
            val v = node.get(k)
            map[k] = when {
                v.isNumber -> v.numberValue()
                v.isBoolean -> v.booleanValue()
                v.isNull -> null
                else -> v.asText()
            }
        }
        return map
    }

    private fun writeLogEntry(n: ObjectNode, entry: DecisionLogEntry) {
        n.put("decisionId", entry.decisionId)
        n.put("principal", entry.principal)
        n.put("action", entry.action)
        n.put("resource", entry.resource)
        val ctx = n.putObject("context")
        entry.context.forEach { (k, value) ->
            when (value) {
                null -> ctx.putNull(k)
                is Boolean -> ctx.put(k, value)
                is Int -> ctx.put(k, value)
                is Long -> ctx.put(k, value)
                is Double -> ctx.put(k, value)
                else -> ctx.put(k, value.toString())
            }
        }
        n.put("effect", entry.effect)
        n.put("reason", entry.reason)
    }
}
