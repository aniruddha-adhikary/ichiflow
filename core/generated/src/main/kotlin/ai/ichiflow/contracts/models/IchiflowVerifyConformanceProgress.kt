package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.Int

/**
 * Enumerable "how much is done": green vs total over the conformance suite.
 */
public data class IchiflowVerifyConformanceProgress(
  @param:JsonProperty(
    "green",
    required = true,
  )
  @get:JsonProperty("green")
  public val green: Int,
  @param:JsonProperty(
    "total",
    required = true,
  )
  @get:JsonProperty("total")
  public val total: Int,
)
