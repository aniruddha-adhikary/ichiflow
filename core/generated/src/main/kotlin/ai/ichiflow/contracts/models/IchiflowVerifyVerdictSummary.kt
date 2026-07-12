package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.Int

/**
 * Count summary across the scope's checks.
 */
public data class IchiflowVerifyVerdictSummary(
  @param:JsonProperty(
    "checks",
    required = true,
  )
  @get:JsonProperty("checks")
  public val checks: Int,
  @param:JsonProperty(
    "passed",
    required = true,
  )
  @get:JsonProperty("passed")
  public val passed: Int,
  @param:JsonProperty(
    "failed",
    required = true,
  )
  @get:JsonProperty("failed")
  public val failed: Int,
  @param:JsonProperty(
    "skipped",
    required = true,
  )
  @get:JsonProperty("skipped")
  public val skipped: Int,
)
