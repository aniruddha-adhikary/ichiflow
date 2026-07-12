package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonValue
import kotlin.String
import kotlin.collections.Map

/**
 * Outcome of a single enumerated check.
 */
public enum class IchiflowVerifyCheckStatus(
  @JsonValue
  public val `value`: String,
) {
  PASS("pass"),
  FAIL("fail"),
  SKIP("skip"),
  ;

  override fun toString(): String = value

  public companion object {
    private val mapping: Map<String, IchiflowVerifyCheckStatus> =
        entries.associateBy(IchiflowVerifyCheckStatus::value)

    public fun fromValue(`value`: String): IchiflowVerifyCheckStatus? = mapping[value]
  }
}
