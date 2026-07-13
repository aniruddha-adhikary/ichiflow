package ai.ichiflow.core.decision.projection

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
 * Build-failing projection-coverage test (build plan 2.2): every construct in the DMN feature matrix
 * must compile one-way from `decision-source` to DMN 1.6 and execute to its expected outcome on the
 * reference engine behind the SPI. Mirrors what `runProjectionCoverage` writes for the verify scope,
 * so a projection regression fails `./gradlew test` as well as the harness.
 */
class ProjectionCoverageTest {

    private val mapper = ObjectMapper().registerKotlinModule()
    private val matrix: JsonNode =
        mapper.readTree(File("../schemas/decision-source/projection/matrix.json"))

    @Test
    fun `every feature-matrix construct projects and executes to its expected outcome`() {
        val engine = DroolsDecisionEngine()
        val constructs = matrix["constructs"]
        assertTrue(constructs.size() >= 10, "feature matrix covers a meaningful surface")

        for (node in constructs) {
            val construct = node["construct"].asText()
            val decision = node["decision"].asText()
            val kind = node["kind"]?.asText()
            val expect = node["expect"].asText()

            val source = mapper.treeToValue(node["source"], DecisionSource::class.java)
            val dmn = DecisionSourceCompiler.compile(source)
            val model = engine.load(dmn, "$construct.dmn")

            val inputs = mutableMapOf<String, Any?>()
            node["inputs"].fields().forEach { (k, v) ->
                inputs[k] = if (v.isNumber) v.numberValue() else v.asText()
            }

            val evaluation = engine.evaluate(model, inputs)
            assertFalse(evaluation.hasErrors, "$construct: no DMN errors (${evaluation.messages})")
            val actual = evaluation.resultOf(decision)?.toString()
            assertTrue(matches(kind, expect, actual), "$construct: expected $expect, got $actual")
        }
    }

    private fun matches(kind: String?, expect: String, actual: String?): Boolean {
        if (actual == null) return false
        if (expect == actual) return true
        if (kind != "number") return false
        val e = expect.toBigDecimalOrNull()
        val a = actual.toBigDecimalOrNull()
        return e != null && a != null && e.compareTo(a) == 0
    }

    @Test
    fun `hit policies UNIQUE, FIRST and COLLECT all project`() {
        val hitPolicies = matrix["constructs"].mapNotNull { node ->
            node["source"]["decision"]?.get("decisionTable")?.get("hitPolicy")?.asText()
        }.toSet()
        assertEquals(setOf("UNIQUE", "FIRST", "COLLECT"), hitPolicies)
    }
}
