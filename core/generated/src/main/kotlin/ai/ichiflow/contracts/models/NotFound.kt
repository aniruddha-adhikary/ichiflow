package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.String

public data class NotFound(
  @param:JsonProperty("code")
  @get:JsonProperty("code")
  public val code: NotFoundCode,
  @param:JsonProperty("message")
  @get:JsonProperty("message")
  public val message: String,
)
