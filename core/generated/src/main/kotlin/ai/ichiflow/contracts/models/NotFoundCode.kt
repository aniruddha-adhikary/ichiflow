package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonValue
import kotlin.String
import kotlin.collections.Map

public enum class NotFoundCode(
  @JsonValue
  public val `value`: String,
) {
  SCOPE_NOT_FOUND("scope-not-found"),
  ;

  override fun toString(): String = value

  public companion object {
    private val mapping: Map<String, NotFoundCode> = entries.associateBy(NotFoundCode::value)

    public fun fromValue(`value`: String): NotFoundCode? = mapping[value]
  }
}
