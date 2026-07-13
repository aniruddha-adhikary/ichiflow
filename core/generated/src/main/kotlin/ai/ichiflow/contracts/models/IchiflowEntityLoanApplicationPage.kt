package ai.ichiflow.contracts.models

import com.fasterxml.jackson.`annotation`.JsonProperty
import kotlin.Int
import kotlin.collections.List

/**
 * A page of full records for the list endpoint (detail rows, in the query's deterministic order).
 */
public data class IchiflowEntityLoanApplicationPage(
  @param:JsonProperty(
    "total",
    required = true,
  )
  @get:JsonProperty("total")
  public val total: Int,
  @param:JsonProperty(
    "page",
    required = true,
  )
  @get:JsonProperty("page")
  public val page: Int,
  @param:JsonProperty(
    "size",
    required = true,
  )
  @get:JsonProperty("size")
  public val size: Int,
  @param:JsonProperty("items")
  @get:JsonProperty("items")
  public val items: List<IchiflowEntityLoanApplicationRecord>,
)
