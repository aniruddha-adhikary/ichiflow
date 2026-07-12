package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.Any
import kotlin.Double
import kotlin.String

/**
 * One check result. Failures carry a structured diff (expected/actual/artifact), never a
 * sentence. `id` is stable across runs so a dashboard and an agent track the same check.
 */
public data class IchiflowVerifyCheckResult(
  /**
   * Stable check id, e.g. `self-check.envelope-schema`.
   */
  @param:JsonProperty("id")
  @get:JsonProperty("id")
  public val id: String,
  /**
   * Outcome of a single enumerated check.
   */
  @param:JsonProperty("status")
  @get:JsonProperty("status")
  public val status: IchiflowVerifyCheckStatus,
  /**
   * The artifact this check is about, if any (e.g. `decision:loan-eligibility@3.2.0`).
   */
  @param:JsonProperty("artifact")
  @get:JsonProperty("artifact")
  public val artifact: String? = null,
  /**
   * Expected value for a failed check (structured, not prose).
   */
  @param:JsonProperty("expected")
  @get:JsonProperty("expected")
  public val expected: Any? = null,
  /**
   * Actual value for a failed check (structured, not prose).
   */
  @param:JsonProperty("actual")
  @get:JsonProperty("actual")
  public val `actual`: Any? = null,
  /**
   * A short structured diff string; supplements expected/actual.
   */
  @param:JsonProperty("diff")
  @get:JsonProperty("diff")
  public val diff: String? = null,
  /**
   * Named metric for coverage-style checks (e.g. `rule-coverage`).
   */
  @param:JsonProperty("metric")
  @get:JsonProperty("metric")
  public val metric: String? = null,
  /**
   * Metric value for a coverage-style check.
   */
  @param:JsonProperty("value")
  @get:JsonProperty("value")
  public val `value`: Double? = null,
  /**
   * Metric threshold for a coverage-style check.
   */
  @param:JsonProperty("threshold")
  @get:JsonProperty("threshold")
  public val threshold: Double? = null,
)
