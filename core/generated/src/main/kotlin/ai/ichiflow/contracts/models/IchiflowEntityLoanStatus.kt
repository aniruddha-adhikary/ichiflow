package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonValue
import kotlin.String
import kotlin.collections.Map

/**
 * Lifecycle status of the v1 reference entity (a permit/benefit-style application record).
 */
public enum class IchiflowEntityLoanStatus(
  @JsonValue
  public val `value`: String,
) {
  DRAFT("draft"),
  SUBMITTED("submitted"),
  APPROVED("approved"),
  DECLINED("declined"),
  ;

  override fun toString(): String = value

  public companion object {
    private val mapping: Map<String, IchiflowEntityLoanStatus> =
        entries.associateBy(IchiflowEntityLoanStatus::value)

    public fun fromValue(`value`: String): IchiflowEntityLoanStatus? = mapping[value]
  }
}
