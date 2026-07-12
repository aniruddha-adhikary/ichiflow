package ai.ichiflow.core.decision.spi

/**
 * The **Decision Engine SPI** (ADR-0002, build plan 2.1). Every engine is an interchangeable
 * importer/executor of canonical DMN 1.6: it loads a DMN model and evaluates it against inputs,
 * returning a structured result plus an evaluation **trace** (which decisions fired and their
 * values) that feeds the DecisionRecord audit chain (ADR-0011). Engines advertise an
 * `EngineCapabilities` descriptor so the harness can assert what a given engine actually supports
 * rather than assuming. Drools is the v1 reference implementation; keeping the contract behind this
 * interface is what keeps the engine replaceable (the anti-lock-in intent of ADR-0001/0002).
 */
interface DecisionEngine {
    /** Static description of what this engine supports — asserted for conformance by the harness. */
    val capabilities: EngineCapabilities

    /** Parse/compile a DMN 1.6 document into an opaque handle the engine can evaluate repeatedly. */
    fun load(dmnXml: String, sourcePath: String): LoadedModel

    /** Evaluate every decision in the model against `inputs`; never throws for decision-level errors. */
    fun evaluate(model: LoadedModel, inputs: Map<String, Any?>): DecisionEvaluation
}

/** Opaque compiled-model handle; each engine defines its own concrete subtype. */
interface LoadedModel {
    val name: String
}

/** Capability descriptor an engine publishes (build plan 2.1: capability-descriptor conformance). */
data class EngineCapabilities(
    val engineId: String,
    val engineVersion: String,
    /** DMN spec versions the engine executes, as OMG spec dates, e.g. `["20240513"]` for DMN 1.6. */
    val dmnSpecVersions: List<String>,
    val feel: Boolean,
    val decisionTable: Boolean,
    val businessKnowledgeModel: Boolean,
    val context: Boolean,
    val invocation: Boolean,
)

/** One decision's contribution to the evaluation trace. */
data class DecisionTraceEntry(
    val decisionId: String?,
    val decisionName: String,
    val result: Any?,
    val succeeded: Boolean,
)

/** Structured evaluation result: per-decision values + the fired-decision trace + error surface. */
data class DecisionEvaluation(
    val results: Map<String, Any?>,
    val trace: List<DecisionTraceEntry>,
    val hasErrors: Boolean,
    val messages: List<String>,
) {
    fun resultOf(decisionName: String): Any? = results[decisionName]
}
