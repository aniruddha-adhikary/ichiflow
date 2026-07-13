package ai.ichiflow.core.entity.store

import ai.ichiflow.core.entity.spi.EntityAuditEntry
import ai.ichiflow.core.entity.spi.EntityNotFoundException
import ai.ichiflow.core.entity.spi.EntityOp
import ai.ichiflow.core.entity.spi.EntityPageResult
import ai.ichiflow.core.entity.spi.EntityQuerySpec
import ai.ichiflow.core.entity.spi.EntityRepository
import ai.ichiflow.core.entity.spi.OutboxRecord
import ai.ichiflow.core.entity.spi.StoredEntity

/**
 * The v1 **reference binding** of the [EntityRepository] SPI (ADR-0018, build plan 4.1): a fully
 * deterministic in-memory store that models the store's *semantics* — CRUD, optimistic-concurrency
 * versioning, soft-delete, exact-match + free-text query/pagination, an append-only audit log, and a
 * transactional outbox — without a database. This is what the harness runs; the PostgreSQL binding
 * (and the deferred jOOQ/Exposed/plain-SQL pick, ADR-0018) is a drop-in behind the same interface.
 *
 * Determinism (retry-forbidden flake policy, doc 13 §3.6): all ordering comes from monotonic counters,
 * never the wall clock or RNG; query results are totally ordered by (`sort` field, then `id`). The
 * "same logical transaction" of the outbox pattern is modelled by appending the audit entry and the
 * outbox record together on every mutation — there is no window in which one exists without the other.
 */
class InMemoryEntityRepository : EntityRepository {

    private data class Row(var entity: StoredEntity)

    private val rows = LinkedHashMap<String, Row>()
    private val audit = mutableListOf<EntityAuditEntry>()
    private val outbox = mutableListOf<OutboxRecord>()
    private var seqCounter = 0L
    private var auditSeq = 0L
    private var outboxSeq = 0L

    private fun key(entityType: String, id: String) = "$entityType\u0000$id"

    private fun nextSeq(): Long = seqCounter++

    private fun record(entityType: String, id: String, operation: EntityOp, version: Int, caseId: String?) {
        // Audit + outbox are appended together — the transactional-outbox invariant (no dual-write).
        audit += EntityAuditEntry(auditSeq++, id, entityType, operation, version, caseId)
        outbox += OutboxRecord(outboxSeq++, id, entityType, operation, caseId, delivered = false)
    }

    override fun create(entityType: String, id: String, caseId: String?, data: Map<String, Any?>): StoredEntity {
        val k = key(entityType, id)
        require(!rows.containsKey(k)) { "$entityType with id '$id' already exists" }
        val seq = nextSeq()
        val entity = StoredEntity(
            id = id,
            caseId = caseId,
            entityType = entityType,
            version = 1,
            createdSeq = seq,
            updatedSeq = seq,
            deleted = false,
            data = data.toMap(),
        )
        rows[k] = Row(entity)
        record(entityType, id, EntityOp.CREATE, entity.version, caseId)
        return entity
    }

    override fun get(entityType: String, id: String): StoredEntity? {
        val row = rows[key(entityType, id)] ?: return null
        return if (row.entity.deleted) null else row.entity
    }

    override fun update(entityType: String, id: String, data: Map<String, Any?>): StoredEntity {
        val row = rows[key(entityType, id)]
        if (row == null || row.entity.deleted) throw EntityNotFoundException(entityType, id)
        val updated = row.entity.copy(
            version = row.entity.version + 1,
            updatedSeq = nextSeq(),
            data = data.toMap(),
        )
        row.entity = updated
        record(entityType, id, EntityOp.UPDATE, updated.version, updated.caseId)
        return updated
    }

    override fun delete(entityType: String, id: String) {
        val row = rows[key(entityType, id)]
        if (row == null || row.entity.deleted) throw EntityNotFoundException(entityType, id)
        val tombstoned = row.entity.copy(
            version = row.entity.version + 1,
            updatedSeq = nextSeq(),
            deleted = true,
        )
        row.entity = tombstoned
        record(entityType, id, EntityOp.DELETE, tombstoned.version, tombstoned.caseId)
    }

    override fun query(query: EntityQuerySpec): EntityPageResult {
        val matched = rows.values
            .map { it.entity }
            .filter { !it.deleted && it.entityType == query.entityType }
            .filter { entity -> query.filter.all { (field, value) -> stringify(entity.data[field]) == value } }
            .filter { entity -> query.search == null || matchesSearch(entity, query.search) }
            .sortedWith(comparator(query.sort))

        val total = matched.size
        val from = (query.page * query.size).coerceIn(0, total)
        val to = (from + query.size).coerceIn(0, total)
        return EntityPageResult(
            total = total,
            page = query.page,
            size = query.size,
            ids = matched.subList(from, to).map { it.id },
        )
    }

    override fun auditLog(): List<EntityAuditEntry> = audit.toList()

    override fun outbox(): List<OutboxRecord> = outbox.toList()

    override fun relayOutbox(): Int {
        var dispatched = 0
        for (i in outbox.indices) {
            if (!outbox[i].delivered) {
                outbox[i] = outbox[i].copy(delivered = true)
                dispatched++
            }
        }
        return dispatched
    }

    private fun matchesSearch(entity: StoredEntity, term: String): Boolean {
        val needle = term.lowercase()
        return entity.data.values.any { stringify(it).lowercase().contains(needle) }
    }

    private fun comparator(sort: String?): Comparator<StoredEntity> {
        val byId = compareBy<StoredEntity> { it.id }
        if (sort.isNullOrBlank()) return byId
        return compareBy<StoredEntity> { stringify(it.data[sort]) }.thenComparing(byId)
    }

    private fun stringify(value: Any?): String = when (value) {
        null -> ""
        is Double -> if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
        else -> value.toString()
    }
}
