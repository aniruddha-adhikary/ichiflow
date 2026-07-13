package ai.ichiflow.core.decision.spi

/**
 * The typed **`DecisionTrace`** (doc 03 §7, build plan 2.3): the explainability object every
 * `evaluate` emits — not a log line. Its shape is frozen by the canonical `DecisionTrace` JSON Schema
 * (schemas/decision-contracts.tsp); the `decision-layer` trace-shape harness validates every emitted
 * trace against it, because the per-Case DecisionRecord / why API (ADR-0011) depends on this contract.
 *
 * This type and its assembly are **engine-neutral** — no `org.kie..` coupling — so the trace shape is
 * uniform across any engine behind the SPI (ADR-0002).
 */
data class DecisionTrace(
    val model: ModelIdentity,
    val inputSnapshot: Map<String, Any?>,
    val firedDecisions: List<DecisionTraceEntry>,
    val intermediateValues: Map<String, Any?>,
    val outputs: Map<String, Any?>,
    val referenceData: List<ReferenceDataProvenance>,
    val authorityAttribution: Map<String, String>,
    val hasErrors: Boolean,
    val messages: List<String>,
) {
    companion object {
        /** Assemble the canonical trace from an engine's capabilities + a completed [DecisionEvaluation]. */
        fun from(
            capabilities: EngineCapabilities,
            modelName: String,
            inputs: Map<String, Any?>,
            evaluation: DecisionEvaluation,
        ): DecisionTrace = DecisionTrace(
            model = ModelIdentity(
                id = modelName,
                engine = capabilities.engineId,
                engineVersion = capabilities.engineVersion,
                capabilities = capabilities.enabled(),
            ),
            inputSnapshot = inputs,
            firedDecisions = evaluation.trace,
            // v1: no named FEEL sub-expression capture yet; the shape is frozen (empty is valid).
            intermediateValues = emptyMap(),
            outputs = evaluation.results,
            referenceData = emptyList(),
            authorityAttribution = emptyMap(),
            hasErrors = evaluation.hasErrors,
            messages = evaluation.messages,
        )
    }
}

/** DecisionModel identity + engine/capability set that produced a trace (doc 03 §7). */
data class ModelIdentity(
    val id: String,
    val version: String? = null,
    val engine: String,
    val engineVersion: String,
    val capabilities: List<String>,
)

/** Reference-data provenance for one fired decision: which CodeSet@version and which rows it read (§7). */
data class ReferenceDataProvenance(
    val decisionName: String,
    val codeSet: String,
    val rows: List<String>,
)
