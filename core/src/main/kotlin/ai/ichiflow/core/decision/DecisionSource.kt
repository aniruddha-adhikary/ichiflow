package ai.ichiflow.core.decision

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

/**
 * `decision-source` — the engine-neutral authoring shape that projects one-way to DMN 1.6
 * (ADR-0027, build plan 2.0/2.2). Phase 2.0 covered only the hard boxed-expression kinds needed to
 * retire the projection-feasibility risk (a BKM FEEL function, a boxed Context, an Invocation).
 * Phase 2.2 generalises the shape to the DMN feature matrix: a model is now a small decision graph
 * (`decisions`, wired by information/knowledge requirements) whose leaves may be any of the boxed
 * expression kinds — literalExpression, decisionTable (any hit policy), context, invocation, list,
 * relation. `decision` (singular) is retained for the Phase 2.0 fixture. The shape is deliberately
 * minimal, not the frozen contract.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class DecisionSource(
    val namespace: String,
    val name: String,
    val inputs: List<InputDef> = emptyList(),
    val bkms: List<BkmDef> = emptyList(),
    val decision: DecisionDef? = null,
    val decisions: List<DecisionDef> = emptyList(),
) {
    /** All decisions in graph order: explicit `decisions` first, then the singular `decision`. */
    fun allDecisions(): List<DecisionDef> = decisions + listOfNotNull(decision)
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class InputDef(val name: String, val type: String)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ParamDef(val name: String, val type: String)

/** A BKM projecting to `<businessKnowledgeModel>` with an encapsulated FEEL function. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class BkmDef(
    val name: String,
    val type: String,
    val parameters: List<ParamDef> = emptyList(),
    val body: String,
)

/**
 * A decision projecting to `<decision>`. Exactly one logic body is supplied: a boxed `context`, a
 * `literal` FEEL expression, a `decisionTable`, a bare `invoke`, a `list`, or a `relation`. `requires`
 * lists required *inputData*; `requiresDecisions` lists required upstream *decisions* (both project to
 * `<informationRequirement>`); `knowledge` lists required BKMs (`<knowledgeRequirement>`).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class DecisionDef(
    val name: String,
    val type: String,
    val requires: List<String> = emptyList(),
    val requiresDecisions: List<String> = emptyList(),
    val knowledge: List<String> = emptyList(),
    val context: List<ContextEntryDef> = emptyList(),
    val literal: String? = null,
    val decisionTable: DecisionTableDef? = null,
    val invoke: InvokeDef? = null,
    val list: List<String>? = null,
    val relation: RelationDef? = null,
)

/** A decision table projecting to `<decisionTable hitPolicy=...>` (UNIQUE, FIRST, ANY, COLLECT, ...). */
@JsonIgnoreProperties(ignoreUnknown = true)
data class DecisionTableDef(
    val hitPolicy: String = "UNIQUE",
    val inputs: List<DtInputDef>,
    val output: DtOutputDef,
    val rules: List<DtRuleDef>,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DtInputDef(val expr: String, val type: String = "string")

@JsonIgnoreProperties(ignoreUnknown = true)
data class DtOutputDef(val type: String = "string")

/** One decision-table rule: one unary test per input column, then the output entry. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class DtRuleDef(val whenTests: List<String>, val then: String)

/** A boxed relation projecting to `<relation>` — a table of literal cells. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class RelationDef(val columns: List<String>, val rows: List<List<String>>)

/** Invocation of a BKM: `bindings` maps each formal parameter to a FEEL expression. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class InvokeDef(val bkm: String, val bindings: Map<String, String> = emptyMap())

/**
 * One entry of a boxed context. Exactly one of `expr`/`invoke` supplies the value; the entry with
 * `result = true` is the context's result cell (no bound variable), projecting to a trailing
 * `<contextEntry>` with only a `<literalExpression>`.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class ContextEntryDef(
    val name: String? = null,
    val type: String? = null,
    val expr: String? = null,
    val invoke: InvokeDef? = null,
    val result: Boolean = false,
)
