package ai.ichiflow.core.decision.trace

import ai.ichiflow.core.decision.DecisionSource
import ai.ichiflow.core.decision.DecisionSourceCompiler
import ai.ichiflow.core.decision.spi.DroolsDecisionEngine
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Build-failing trace-shape test (build plan 2.3, doc 03 §7): every `evaluate` across the DMN feature
 * matrix must emit a typed `DecisionTrace` carrying the DecisionRecord-critical fields — model
 * identity + engine/capability set, the input snapshot, the fired decisions, and the outputs. Mirrors
 * what `DecisionTraceRunner` writes for the verify trace-shape assertion, so a regression in trace
 * emission fails `./gradlew test` as well as the harness.
 */
class DecisionTraceTest {

    private val mapper = ObjectMapper().registerKotlinModule()
    private val matrix: JsonNode =
        mapper.readTree(File("../schemas/decision-source/projection/matrix.json"))

    @Test
    fun `every evaluate emits a well-formed DecisionTrace`() {
        val engine = DroolsDecisionEngine()
        val constructs = matrix["constructs"]
        assertTrue(constructs.size() >= 10, "feature matrix covers a meaningful surface")

        for (node in constructs) {
            val construct = node["construct"].asText()
            val source = mapper.treeToValue(node["source"], DecisionSource::class.java)
            val model = engine.load(DecisionSourceCompiler.compile(source), "$construct.dmn")

            val inputs = mutableMapOf<String, Any?>()
            node["inputs"].fields().forEach { (k, v) ->
                inputs[k] = if (v.isNumber) v.numberValue() else v.asText()
            }

            val trace = engine.trace(model, inputs)

            assertFalse(trace.hasErrors, "$construct: no DMN errors (${trace.messages})")
            assertEquals("drools", trace.model.engine, "$construct: engine identity")
            assertEquals("10.2.0", trace.model.engineVersion, "$construct: engine version")
            assertTrue(trace.model.capabilities.isNotEmpty(), "$construct: capability set present")
            assertEquals(model.name, trace.model.id, "$construct: model identity")
            assertEquals(inputs, trace.inputSnapshot, "$construct: input snapshot is as-of evaluation")
            assertTrue(trace.firedDecisions.isNotEmpty(), "$construct: at least one decision fired")
            assertTrue(trace.firedDecisions.all { it.succeeded }, "$construct: all fired decisions succeeded")
            assertTrue(trace.outputs.isNotEmpty(), "$construct: outputs present")
        }
    }

    @Test
    fun `multi-decision graphs surface every fired decision in the trace`() {
        val engine = DroolsDecisionEngine()
        val node = matrix["constructs"].first { it["construct"].asText() == "informationRequirement" }
        val source = mapper.treeToValue(node["source"], DecisionSource::class.java)
        val model = engine.load(DecisionSourceCompiler.compile(source), "graph.dmn")

        val inputs = mutableMapOf<String, Any?>()
        node["inputs"].fields().forEach { (k, v) ->
            inputs[k] = if (v.isNumber) v.numberValue() else v.asText()
        }

        val trace = engine.trace(model, inputs)
        val fired = trace.firedDecisions.map { it.decisionName }.toSet()
        assertTrue(fired.containsAll(setOf("Base", "Final")), "graph fired both decisions, got $fired")
    }
}
