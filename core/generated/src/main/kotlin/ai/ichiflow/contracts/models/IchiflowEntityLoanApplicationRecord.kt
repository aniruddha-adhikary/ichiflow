package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty

/**
 * A persisted record as returned over the API — the entity payload plus store-owned metadata.
 */
public data class IchiflowEntityLoanApplicationRecord(
  /**
   * The v1 **reference domain entity** (ADR-0018) — an ordinary business record the store persists,
   * lists, queries, and audits. Its persisted shape is schema-defined here; the store validates
   * writes
   * against this contract at the boundary.
   */
  @param:JsonProperty("data")
  @get:JsonProperty("data")
  public val `data`: IchiflowEntityLoanApplication,
  /**
   * Store-owned metadata stamped on every persisted record (ADR-0018/0012): stable id, the
   * correlating
   * global `case_id`, the entity type, an optimistic-concurrency `version`, monotonic create/update
   * sequence stamps (the deterministic stand-in for wall-clock timestamps in the harness), and the
   * soft-delete tombstone.
   */
  @param:JsonProperty("meta")
  @get:JsonProperty("meta")
  public val meta: IchiflowEntityEntityMeta,
)
