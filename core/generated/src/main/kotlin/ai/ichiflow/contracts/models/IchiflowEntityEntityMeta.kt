package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.Boolean
import kotlin.Int
import kotlin.Long
import kotlin.String

/**
 * Store-owned metadata stamped on every persisted record (ADR-0018/0012): stable id, the
 * correlating
 * global `case_id`, the entity type, an optimistic-concurrency `version`, monotonic create/update
 * sequence stamps (the deterministic stand-in for wall-clock timestamps in the harness), and the
 * soft-delete tombstone.
 */
public data class IchiflowEntityEntityMeta(
  /**
   * Stable store id (unique per entity type).
   */
  @param:JsonProperty("id")
  @get:JsonProperty("id")
  public val id: String,
  /**
   * The correlating global `case_id` (ADR-0012); absent for entities not yet bound to a Case.
   */
  @param:JsonProperty("caseId")
  @get:JsonProperty("caseId")
  public val caseId: String? = null,
  /**
   * The entity type discriminator, e.g. `LoanApplication`.
   */
  @param:JsonProperty("entityType")
  @get:JsonProperty("entityType")
  public val entityType: String,
  /**
   * Optimistic-concurrency version — 1 on create, incremented on each update.
   */
  @param:JsonProperty(
    "version",
    required = true,
  )
  @get:JsonProperty("version")
  public val version: Int,
  /**
   * Monotonic sequence stamp at create time.
   */
  @param:JsonProperty(
    "createdSeq",
    required = true,
  )
  @get:JsonProperty("createdSeq")
  public val createdSeq: Long,
  /**
   * Monotonic sequence stamp at the last mutation.
   */
  @param:JsonProperty(
    "updatedSeq",
    required = true,
  )
  @get:JsonProperty("updatedSeq")
  public val updatedSeq: Long,
  /**
   * Soft-delete tombstone — a deleted record is retained (for audit) but excluded from queries.
   */
  @param:JsonProperty(
    "deleted",
    required = true,
  )
  @get:JsonProperty("deleted")
  public val deleted: Boolean,
)
