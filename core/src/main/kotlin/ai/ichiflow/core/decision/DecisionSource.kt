package ai.ichiflow.core.decision

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

/**
 * `decision-source` — the engine-neutral authoring shape that projects one-way to DMN 1.6
 * (ADR-0027, build plan 2.0/2.2). Phase 2.0 covers only the *hard* boxed-expression kinds needed to
 * retire the projection-feasibility risk: a Business Knowledge Model whose body is a FEEL function, a
 * boxed Context decision, and an Invocation binding. Later chunks generalise this to the full DMN
 * feature matrix; the shape here is deliberately minimal, not the frozen contract.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class DecisionSource(
    val namespace: String,
    val name: String,
    val inputs: List<InputDef>,
    val bkms: List<BkmDef> = emptyList(),
    val decision: DecisionDef,
)

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

@JsonIgnoreProperties(ignoreUnknown = true)
data class DecisionDef(
    val name: String,
    val type: String,
    val requires: List<String> = emptyList(),
    val knowledge: List<String> = emptyList(),
    val context: List<ContextEntryDef>,
)

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
