package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.Boolean
import kotlin.Double

/**
 * Coverage ratio against a declared threshold.
 */
public data class IchiflowVerifyCoverageProgress(
  @param:JsonProperty(
    "value",
    required = true,
  )
  @get:JsonProperty("value")
  public val `value`: Double,
  @param:JsonProperty(
    "threshold",
    required = true,
  )
  @get:JsonProperty("threshold")
  public val threshold: Double,
  @param:JsonProperty(
    "met",
    required = true,
  )
  @get:JsonProperty("met")
  public val met: Boolean,
)
