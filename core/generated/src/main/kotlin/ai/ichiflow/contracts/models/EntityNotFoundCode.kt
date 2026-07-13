package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonValue
import kotlin.String
import kotlin.collections.Map

public enum class EntityNotFoundCode(
  @JsonValue
  public val `value`: String,
) {
  ENTITY_NOT_FOUND("entity-not-found"),
  ;

  override fun toString(): String = value

  public companion object {
    private val mapping: Map<String, EntityNotFoundCode> =
        entries.associateBy(EntityNotFoundCode::value)

    public fun fromValue(`value`: String): EntityNotFoundCode? = mapping[value]
  }
}
