package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonValue
import kotlin.String
import kotlin.collections.Map

/**
 * pass | fail — the only two verdicts a scope may emit.
 */
public enum class IchiflowVerifyVerdict(
  @JsonValue
  public val `value`: String,
) {
  PASS("pass"),
  FAIL("fail"),
  ;

  override fun toString(): String = value

  public companion object {
    private val mapping: Map<String, IchiflowVerifyVerdict> =
        entries.associateBy(IchiflowVerifyVerdict::value)

    public fun fromValue(`value`: String): IchiflowVerifyVerdict? = mapping[value]
  }
}
