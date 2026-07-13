package ai.ichiflow.core.entity.spi

/**
 * The **Repository SPI** for the domain entity store (ADR-0018, ADR-0012, build plan 4.1). The design
 * review's biggest gap was that ordinary business entities — the `LoanApplication` record itself,
 * queryable / editable / listable / searchable — had no home. This SPI fixes the *shape and contracts*
 * of that store while leaving the persistence binding swappable: the v1 reference binding is in-memory
 * ([ai.ichiflow.core.entity.store.InMemoryEntityRepository]); the PostgreSQL-first binding (and the
 * eventual jOOQ/Exposed/plain-SQL pick, deliberately left open in ADR-0018) slots in behind the same
 * interface without touching a single generated caller.
 *
 * Entities are **CRUD + audit-log + transactional outbox, not event-sourced** (ADR-0018/0011): every
 * mutation bumps an optimistic-concurrency `version`, appends an [EntityAuditEntry], and — atomically,
 * in the same logical transaction — enqueues an [OutboxRecord] the relay later delivers to downstream
 * consumers (adapters in Phase 5, read models). Every record and every audit/outbox row is stamped with
 * the correlating global `case_id` (ADR-0012). Entity lifecycle and Case lifecycle stay distinct.
 *
 * The store is engine-/RNG-/clock-neutral so the harness is deterministic: sequence stamps come from a
 * monotonic counter, not the wall clock. The contract mirrors the emitted JSON Schema
 * (`EntityMeta`, `EntityQuery`, `EntityPage`, ...), so the same schema that types callers validates at
 * the store boundary — zero drift.
 */
interface EntityRepository {
    /** Create a new record, stamping metadata and emitting audit + outbox rows atomically. */
    fun create(entityType: String, id: String, caseId: String?, data: Map<String, Any?>): StoredEntity

    /** Read a live (non-deleted) record by id, or `null` if absent or soft-deleted. */
    fun get(entityType: String, id: String): StoredEntity?

    /** Update an existing record: replace its data, bump `version`, append audit + outbox rows. */
    fun update(entityType: String, id: String, data: Map<String, Any?>): StoredEntity

    /** Soft-delete a record (retained for audit, excluded from queries); append audit + outbox rows. */
    fun delete(entityType: String, id: String)

    /** Query / paginate / search live records; returns ids in a total, deterministic order. */
    fun query(query: EntityQuerySpec): EntityPageResult

    /** The append-only audit log, in sequence order (ADR-0018). */
    fun auditLog(): List<EntityAuditEntry>

    /** The transactional outbox, in sequence order — undelivered until [relayOutbox]. */
    fun outbox(): List<OutboxRecord>

    /**
     * Relay every undelivered outbox record to consumers and mark it delivered, returning the count
     * dispatched. Idempotent: already-delivered records are skipped. Models the outbox-relay liveness
     * the transactional-outbox pattern guarantees (no dual-write, at-least-once delivery).
     */
    fun relayOutbox(): Int
}

/** The mutation kind recorded on the audit log and emitted to the outbox (mirrors `EntityOp`). */
enum class EntityOp {
    CREATE,
    UPDATE,
    DELETE,
    ;

    /** The canonical lower-case wire token used in the emitted schema and vectors. */
    fun wire(): String = name.lowercase()
}

/**
 * A persisted record: store-owned metadata (mirrors `EntityMeta`) plus the schema-defined entity data.
 * Immutable snapshot returned by the SPI; callers never mutate it in place.
 */
data class StoredEntity(
    val id: String,
    val caseId: String?,
    val entityType: String,
    val version: Int,
    val createdSeq: Long,
    val updatedSeq: Long,
    val deleted: Boolean,
    val data: Map<String, Any?>,
)

/** One append-only audit-log entry (mirrors `EntityAuditEntry`). */
data class EntityAuditEntry(
    val seq: Long,
    val id: String,
    val entityType: String,
    val operation: EntityOp,
    val version: Int,
    val caseId: String?,
)

/** One transactional-outbox record (mirrors `OutboxRecord`). */
data class OutboxRecord(
    val seq: Long,
    val id: String,
    val entityType: String,
    val operation: EntityOp,
    val caseId: String?,
    val delivered: Boolean,
)

/**
 * A query / pagination / search request (mirrors `EntityQuery`). `filter` is exact-match on scalar
 * fields (stringified); `search` is free-text (Postgres-FTS-style tokenized substring match in the
 * reference binding); results are sorted by `sort` then `id` for a total order, then paginated.
 */
data class EntityQuerySpec(
    val entityType: String,
    val filter: Map<String, String> = emptyMap(),
    val search: String? = null,
    val sort: String? = null,
    val page: Int = 0,
    val size: Int = 50,
)

/** A page of query results — ids in stable order plus the total match count (mirrors `EntityPage`). */
data class EntityPageResult(
    val total: Int,
    val page: Int,
    val size: Int,
    val ids: List<String>,
)

/** Thrown when a mutation targets a record that does not exist (or was deleted). */
class EntityNotFoundException(entityType: String, id: String) :
    RuntimeException("no live $entityType with id '$id'")
