import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The canonical **domain entity store** contracts (build plan 4.1; ADR-0018, ADR-0012). The design
 * review's biggest gap was that the ordinary business **entity** — the `LoanApplication` *record
 * itself*, queryable / editable / listable / searchable — had **no home**. This schema fixes the
 * *presence, shape, and contracts* of that store (the ORM/data-access pick — jOOQ vs Exposed vs plain
 * SQL — stays deliberately open, ADR-0018):
 *
 *   - **Schema-defined entities** — a domain entity's persisted shape is declared here in the canonical
 *     schema; `LoanApplication` is the v1 reference entity. Its tables/repositories are *generated*
 *     from this shape, so the same JSON Schema that types callers validates at the store boundary
 *     (zero-drift, doc 02 §5).
 *   - **CRUD + audit-log + transactional outbox — not event-sourced** (ADR-0018 / ADR-0011): business
 *     entities are ordinary versioned records with an append-only `EntityAuditEntry` log and a
 *     transactional `OutboxRecord` stream that later feeds adapters (Phase 5) and read models. Event
 *     sourcing stays confined to the decision/flow core.
 *   - **Query / pagination / search contract** (`EntityQuery` → `EntityPage`) emitted alongside the API
 *     surface, consumed by the generated UI and Flows; search default is Postgres FTS.
 *   - **`case_id` correlation** — every record and every audit/outbox row is stamped with the global
 *     `case_id` (ADR-0012), though entity lifecycle and Case lifecycle stay distinct (an entity can
 *     precede or outlive a Case, ADR-0018).
 *
 * The persistence binding lives behind a **Repository SPI** (Kotlin core); this schema is the neutral
 * contract every binding and every generated caller shares.
 */
@jsonSchema
namespace Ichiflow.Entity;

/** The mutation kind recorded on the audit log and emitted to the outbox. */
union EntityOp {
  create: "create",
  update: "update",
  delete: "delete",
}

/** Lifecycle status of the v1 reference entity (a permit/benefit-style application record). */
union LoanStatus {
  draft: "draft",
  submitted: "submitted",
  approved: "approved",
  declined: "declined",
}

/**
 * The v1 **reference domain entity** (ADR-0018) — an ordinary business record the store persists,
 * lists, queries, and audits. Its persisted shape is schema-defined here; the store validates writes
 * against this contract at the boundary.
 */
model LoanApplication {
  /** The applicant's display name (also the default free-text search field). */
  applicant: string;

  /** Requested principal amount. */
  @minValue(0)
  amount: float64;

  /** The permit/product code this application is for (a `CodeSet` codeRef in the full model). */
  productCode: string;

  status: LoanStatus;
}

/**
 * Store-owned metadata stamped on every persisted record (ADR-0018/0012): stable id, the correlating
 * global `case_id`, the entity type, an optimistic-concurrency `version`, monotonic create/update
 * sequence stamps (the deterministic stand-in for wall-clock timestamps in the harness), and the
 * soft-delete tombstone.
 */
model EntityMeta {
  /** Stable store id (unique per entity type). */
  id: string;

  /** The correlating global `case_id` (ADR-0012); absent for entities not yet bound to a Case. */
  caseId?: string;

  /** The entity type discriminator, e.g. `LoanApplication`. */
  entityType: string;

  /** Optimistic-concurrency version — 1 on create, incremented on each update. */
  @minValue(1)
  version: int32;

  /** Monotonic sequence stamp at create time. */
  @minValue(0)
  createdSeq: int64;

  /** Monotonic sequence stamp at the last mutation. */
  @minValue(0)
  updatedSeq: int64;

  /** Soft-delete tombstone — a deleted record is retained (for audit) but excluded from queries. */
  deleted: boolean;
}

/** One append-only **audit-log** entry (ADR-0018) — who changed which record to which version. */
model EntityAuditEntry {
  /** Monotonic audit sequence number. */
  @minValue(0)
  seq: int64;

  id: string;
  entityType: string;
  operation: EntityOp;

  /** The resulting version after the mutation. */
  @minValue(1)
  version: int32;

  caseId?: string;
}

/**
 * One **transactional-outbox** record (ADR-0018/0012). Written in the *same* transaction as the entity
 * mutation (atomicity is the whole point — no dual-write), then relayed to downstream consumers and
 * marked `delivered`. Feeds adapters (Phase 5) and read-model projections.
 */
model OutboxRecord {
  /** Monotonic outbox sequence number. */
  @minValue(0)
  seq: int64;

  id: string;
  entityType: string;
  operation: EntityOp;
  caseId?: string;

  /** True once the relay has dispatched this record to consumers. */
  delivered: boolean;
}

/**
 * The **query / pagination / search** request (ADR-0018) the generated list/detail screens and Flows
 * issue. `filter` is exact-match on scalar fields; `search` is free-text (Postgres FTS by default);
 * results are a stable, sorted, paginated `EntityPage`.
 */
model EntityQuery {
  entityType: string;

  /** Exact-match field filters (field name → expected stringified value). */
  filter?: Record<string>;

  /** Free-text search term (matched against the entity's searchable text). */
  search?: string;

  /** Sort field; results are additionally ordered by `id` for a total, deterministic order. */
  sort?: string;

  /** Zero-based page index. */
  @minValue(0)
  page: int32;

  /** Page size (max rows returned). */
  @minValue(1)
  size: int32;
}

/** A page of query results — ids in stable order plus the total match count (ADR-0018). */
model EntityPage {
  @minValue(0)
  total: int32;

  @minValue(0)
  page: int32;

  @minValue(1)
  size: int32;

  /** The matching record ids for this page, in the query's deterministic order. */
  ids: string[];
}

/** The operation kind exercised by an entity-store harness vector step. */
union EntityStoreOpKind {
  create: "create",
  update: "update",
  delete: "delete",
  get: "get",
  list: "list",
}

/**
 * One step of an entity-store **conformance vector** (build plan 4.1, harness-first). `create`/`update`
 * carry the entity `data` (validated against `LoanApplication.json` at the boundary); `get` pins the
 * expected record (or its absence); `list` pins the expected page ids + total for a query.
 */
model EntityStoreOp {
  operation: EntityStoreOpKind;

  /** Target record id (create/update/delete/get). */
  id?: string;

  /** Correlating `case_id` stamped on create. */
  caseId?: string;

  /**
   * The entity payload for create/update. Entity-agnostic at the DSL level (an opaque field map); the
   * harness validates it against the *specific* entity's schema (`LoanApplication`) at the boundary.
   */
  data?: Record<unknown>;

  /** The query for a `list` step. */
  query?: EntityQuery;

  /**
   * For `get`: the expected persisted field values (a partial assertion — only the named fields are
   * checked; omit with `expectMissing` for a not-found assertion).
   */
  expect?: Record<unknown>;

  /** For `get`: assert the record is absent (never created, or soft-deleted). */
  expectMissing?: boolean;

  /** For `get`: the expected version after the round-trip. */
  expectVersion?: int32;

  /** For `list`: the expected page ids in deterministic order. */
  expectIds?: string[];

  /** For `list`: the expected total match count. */
  expectTotal?: int32;
}

/** The pinned audit-log shape a vector must produce (seq is assigned by the store, so omitted here). */
model EntityAuditExpectation {
  operation: EntityOp;
  id: string;

  @minValue(1)
  version: int32;
}

/** The pinned outbox shape a vector must produce (seq assigned by the store). */
model EntityOutboxExpectation {
  operation: EntityOp;
  id: string;
}

/** The pinned oracle for an entity-store vector — the exact audit log + outbox the ops must yield. */
model EntityStoreExpectation {
  /** The append-only audit log, in order. */
  audit: EntityAuditExpectation[];

  /** The transactional outbox, in order. */
  outbox: EntityOutboxExpectation[];

  /** True iff relaying the outbox marks every record delivered (transactional-outbox liveness). */
  outboxDeliveredAll: boolean;
}

/**
 * One committed **entity-store conformance vector** (build plan 4.1): a named sequence of CRUD/query
 * ops over the reference entity paired with the pinned audit-log + outbox oracle. Proves generated-repo
 * round-trip, query/pagination/search, versioning, soft-delete, and transactional-outbox delivery.
 */
model EntityStoreVector {
  name: string;
  entityType: string;
  ops: EntityStoreOp[];
  expect: EntityStoreExpectation;
}
