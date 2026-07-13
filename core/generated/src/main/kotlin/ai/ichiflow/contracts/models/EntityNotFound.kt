package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.String

public data class EntityNotFound(
  @param:JsonProperty("code")
  @get:JsonProperty("code")
  public val code: EntityNotFoundCode,
  @param:JsonProperty("message")
  @get:JsonProperty("message")
  public val message: String,
)
