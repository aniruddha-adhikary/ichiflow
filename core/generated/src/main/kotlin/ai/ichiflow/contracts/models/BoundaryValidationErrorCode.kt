package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonValue
import kotlin.String
import kotlin.collections.Map

public enum class BoundaryValidationErrorCode(
  @JsonValue
  public val `value`: String,
) {
  VALIDATION_FAILED("validation-failed"),
  ;

  override fun toString(): String = value

  public companion object {
    private val mapping: Map<String, BoundaryValidationErrorCode> =
        entries.associateBy(BoundaryValidationErrorCode::value)

    public fun fromValue(`value`: String): BoundaryValidationErrorCode? = mapping[value]
  }
}
