package ai.ichiflow.core.decision.spi

import java.io.StringReader
import java.math.BigDecimal
import org.kie.api.io.ResourceType
import org.kie.dmn.api.core.DMNMessage
import org.kie.dmn.api.core.DMNModel
import org.kie.dmn.api.core.DMNRuntime
import org.kie.dmn.api.core.event.AfterEvaluateDecisionTableEvent
import org.kie.dmn.api.core.event.DMNRuntimeEventListener
import org.kie.dmn.core.internal.utils.DMNRuntimeBuilder
import org.kie.internal.io.ResourceFactory

/**
 * The v1 reference `DecisionEngine`: Apache KIE / Drools (pinned 10.2.0), executing canonical
 * DMN 1.6 behind the engine-neutral SPI (ADR-0002). All KIE-specific coupling — runtime build,
 * FEEL number coercion, `DMNResult` → trace mapping — is confined to this class; nothing outside the
 * SPI package touches a `org.kie.*` type.
 */
class DroolsDecisionEngine : DecisionEngine {

    override val capabilities: EngineCapabilities = EngineCapabilities(
        engineId = "drools",
        engineVersion = KIE_VERSION,
        dmnSpecVersions = listOf(DMN_1_6_SPEC_DATE),
        feel = true,
        decisionTable = true,
        businessKnowledgeModel = true,
        context = true,
        invocation = true,
    )

    private class DroolsModel(val runtime: DMNRuntime, val model: DMNModel) : LoadedModel {
        override val name: String get() = model.name
    }

    override fun load(dmnXml: String, sourcePath: String): LoadedModel {
        val res = ResourceFactory.newReaderResource(StringReader(dmnXml)).apply {
            setSourcePath(sourcePath)
            resourceType = ResourceType.DMN
        }
        val runtime = DMNRuntimeBuilder.fromDefaults()
            .buildConfiguration()
            .fromResources(listOf(res))
            .getOrElseThrow { e -> IllegalArgumentException("DMN runtime build failed for $sourcePath", e) }
        val model = runtime.models.firstOrNull()
            ?: throw IllegalArgumentException("No DMN model found in $sourcePath")
        return DroolsModel(runtime, model)
    }

    /**
     * Captures the hit-policy-*selected* decision-table rule indexes per owning decision, for rule/row
     * coverage (§6.2). Kept a `Drools`-named type so it stays inside the engine adapter's KIE-allowed
     * boundary (ArchUnit `spi.contract.engine-neutral`).
     */
    private class DroolsRuleFiringListener : DMNRuntimeEventListener {
        val fired: MutableMap<String, MutableList<Int>> = mutableMapOf()

        override fun afterEvaluateDecisionTable(event: AfterEvaluateDecisionTableEvent) {
            val key = event.decisionName ?: event.decisionTableName ?: return
            fired.getOrPut(key) { mutableListOf() }.addAll(event.selected ?: emptyList())
        }
    }

    override fun evaluate(model: LoadedModel, inputs: Map<String, Any?>): DecisionEvaluation {
        val m = model as DroolsModel
        val listener = DroolsRuleFiringListener()
        m.runtime.addListener(listener)
        try {
            val ctx = m.runtime.newContext()
            for ((k, v) in inputs) ctx.set(k, coerce(v))
            val result = m.runtime.evaluateAll(m.model, ctx)

            val trace = result.decisionResults.map { dr ->
                DecisionTraceEntry(
                    decisionId = dr.decisionId,
                    decisionName = dr.decisionName,
                    result = dr.result,
                    succeeded = dr.evaluationStatus.name == "SUCCEEDED",
                )
            }
            val results = trace.associate { it.decisionName to it.result }
            val errors = result.messages.filter { it.severity == DMNMessage.Severity.ERROR }
            return DecisionEvaluation(
                results = results,
                trace = trace,
                hasErrors = errors.isNotEmpty(),
                messages = errors.map { it.message },
                firedRules = listener.fired.mapValues { it.value.toList() },
            )
        } finally {
            m.runtime.removeListener(listener)
        }
    }

    private companion object {
        const val KIE_VERSION = "10.2.0"
        const val DMN_1_6_SPEC_DATE = "20240513"

        /** FEEL numbers are BigDecimal; coerce JSON-sourced ints/doubles so equality is exact. */
        fun coerce(v: Any?): Any? = when (v) {
            is Int -> BigDecimal(v)
            is Long -> BigDecimal(v)
            is Double -> BigDecimal(v.toString())
            is Float -> BigDecimal(v.toString())
            else -> v
        }
    }
}
