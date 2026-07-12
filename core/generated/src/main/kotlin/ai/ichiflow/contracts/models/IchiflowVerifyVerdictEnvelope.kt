package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import java.time.OffsetDateTime
import kotlin.Boolean
import kotlin.String
import kotlin.collections.List

/**
 * The verdict envelope emitted by every verify scope.
 */
public data class IchiflowVerifyVerdictEnvelope(
  /**
   * Envelope schema version.
   */
  @param:JsonProperty("verifyVersion")
  @get:JsonProperty("verifyVersion")
  public val verifyVersion: String,
  /**
   * The scope that produced this verdict (e.g. `self-check`, `schema-pipeline`).
   */
  @param:JsonProperty("scope")
  @get:JsonProperty("scope")
  public val scope: String,
  /**
   * ISO-8601 UTC timestamp of the run.
   */
  @param:JsonProperty("ranAt")
  @get:JsonProperty("ranAt")
  public val ranAt: OffsetDateTime,
  /**
   * Seed for deterministic time/data (§3.6); recorded so a run is reproducible.
   */
  @param:JsonProperty("seed")
  @get:JsonProperty("seed")
  public val seed: String,
  /**
   * pass | fail — the only two verdicts a scope may emit.
   */
  @param:JsonProperty("verdict")
  @get:JsonProperty("verdict")
  public val verdict: IchiflowVerifyVerdict,
  /**
   * Count summary across the scope's checks.
   */
  @param:JsonProperty("summary")
  @get:JsonProperty("summary")
  public val summary: IchiflowVerifyVerdictSummary,
  /**
   * The progress metric block — a count/ratio, never a narrative estimate.
   */
  @param:JsonProperty("progress")
  @get:JsonProperty("progress")
  public val progress: IchiflowVerifyProgress,
  @param:JsonProperty("checks")
  @get:JsonProperty("checks")
  public val checks: List<IchiflowVerifyCheckResult>,
  /**
   * Must always be false — a flaky check is a harness defect, not a retry (§3.6).
   */
  @param:JsonProperty(
    "flaky",
    required = true,
  )
  @get:JsonProperty("flaky")
  public val flaky: Boolean,
)
