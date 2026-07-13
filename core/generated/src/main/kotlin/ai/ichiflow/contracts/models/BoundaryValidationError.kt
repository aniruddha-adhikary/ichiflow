package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.String
import kotlin.collections.List

public data class BoundaryValidationError(
  @param:JsonProperty("code")
  @get:JsonProperty("code")
  public val code: BoundaryValidationErrorCode,
  @param:JsonProperty("message")
  @get:JsonProperty("message")
  public val message: String,
  /**
   * Structured validation errors (Ajv messages) — never prose.
   */
  @param:JsonProperty("errors")
  @get:JsonProperty("errors")
  public val errors: List<String>,
)
