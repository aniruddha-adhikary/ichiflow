package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty

/**
 * The progress metric block — a count/ratio, never a narrative estimate.
 */
public data class IchiflowVerifyProgress(
  /**
   * Enumerable "how much is done": green vs total over the conformance suite.
   */
  @param:JsonProperty("conformance")
  @get:JsonProperty("conformance")
  public val conformance: IchiflowVerifyConformanceProgress? = null,
  /**
   * Coverage ratio against a declared threshold.
   */
  @param:JsonProperty("coverage")
  @get:JsonProperty("coverage")
  public val coverage: IchiflowVerifyCoverageProgress? = null,
)
