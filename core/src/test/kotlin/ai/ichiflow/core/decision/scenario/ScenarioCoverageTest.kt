package ai.ichiflow.core.decision.scenario

import ai.ichiflow.core.decision.DecisionSource
import ai.ichiflow.core.decision.DecisionSourceCompiler
import ai.ichiflow.core.decision.spi.DroolsDecisionEngine
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Build-failing scenario/coverage test (build plan 2.4, doc 03 §6). Runs the loan-eligibility
 * `Harness` on the SPI reference engine and asserts (a) each case produces its full typed `Outcome`
 * (type + reasons + attached conditions), and (b) the engine surfaces matched decision-table rows so
 * rule/row coverage is computable. Mirrors what `ScenarioCoverageRunner` writes for the harness gate.
 */
class ScenarioCoverageTest {

    private val mapper = ObjectMapper().registerKotlinModule()
    private val source: DecisionSource =
        mapper.readValue(
            File("../schemas/decision-harness/loan-eligibility.source.json"),
            DecisionSource::class.java,
        )
    private val engine = DroolsDecisionEngine()
    private val model = engine.load(DecisionSourceCompiler.compile(source), "loan-eligibility.dmn")

    private fun evaluate(given: Map<String, Any?>) =
        engine.evaluate(model, source.inputs.associate<_, String, Any?> { it.name to null } + given)

    @Test
    fun `low DTI approves with an OK reason and no conditions`() {
        val ev = evaluate(mapOf("dti" to 0.30))
        assertFalse(ev.hasErrors, "no evaluation errors: ${ev.messages}")
        val outcome = ev.resultOf("Assessment") as Map<*, *>
        assertEquals("approve", outcome["type"])
        val reasons = outcome["reasons"] as List<*>
        assertTrue(reasons.any { it is Map<*, *> && it["code"] == "OK" })
        assertTrue((outcome["conditions"] as List<*>).isEmpty())
    }

    @Test
    fun `high DTI without co-signer is denied`() {
        val ev = evaluate(mapOf("dti" to 0.45))
        val outcome = ev.resultOf("Assessment") as Map<*, *>
        assertEquals("deny", outcome["type"])
        assertTrue((outcome["reasons"] as List<*>).any { it is Map<*, *> && it["code"] == "DTI_OVER_LIMIT" })
    }

    @Test
    fun `high DTI with a strong co-signer conditionally approves with a retention obligation`() {
        val ev = evaluate(mapOf("dti" to 0.45, "coSignerFico" to 760))
        val outcome = ev.resultOf("Assessment") as Map<*, *>
        assertEquals("conditional-approve", outcome["type"])
        val conditions = outcome["conditions"] as List<*>
        val condition = conditions.single() as Map<*, *>
        assertEquals("RETAIN_RECORDS", condition["code"])
        assertEquals("post-approval-obligation", condition["kind"])
        assertEquals("pending", condition["state"])
    }

    @Test
    fun `engine surfaces matched decision-table rows for coverage`() {
        val ev = evaluate(mapOf("dti" to 0.45, "coSignerFico" to 760))
        assertTrue(ev.firedRules.containsKey("OutcomeTypeCol"), "fired rows captured per decision")
        assertEquals(listOf(1), ev.firedRules["OutcomeTypeCol"], "FIRST hit selects the conditional-approve row")
    }
}
