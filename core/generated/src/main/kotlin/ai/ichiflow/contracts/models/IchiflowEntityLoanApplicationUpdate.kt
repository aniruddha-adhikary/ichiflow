package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.Double
import kotlin.String

/**
 * The v1 **reference domain entity** (ADR-0018) — an ordinary business record the store persists,
 * lists, queries, and audits. Its persisted shape is schema-defined here; the store validates
 * writes
 * against this contract at the boundary.
 */
public data class IchiflowEntityLoanApplicationUpdate(
  /**
   * The applicant's display name (also the default free-text search field).
   */
  @param:JsonProperty("applicant")
  @get:JsonProperty("applicant")
  public val applicant: String? = null,
  /**
   * Requested principal amount.
   */
  @param:JsonProperty("amount")
  @get:JsonProperty("amount")
  public val amount: Double? = null,
  /**
   * The permit/product code this application is for (a `CodeSet` codeRef in the full model).
   */
  @param:JsonProperty("productCode")
  @get:JsonProperty("productCode")
  public val productCode: String? = null,
  /**
   * Lifecycle status of the v1 reference entity (a permit/benefit-style application record).
   */
  @param:JsonProperty("status")
  @get:JsonProperty("status")
  public val status: IchiflowEntityLoanStatus? = null,
)
