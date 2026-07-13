package ai.ichiflow.core.decision.feel

import ai.ichiflow.core.decision.DecisionDef
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
 * Build-failing FEEL semantics-vector test (build plan 2.4, doc 13 §2.b). Every frozen
 * interchange-ambiguity vector must still evaluate to its pinned result on the reference engine, so a
 * KIE bump that silently shifts list-sort ordering or decimal rounding fails `./gradlew test` too.
 */
class FeelVectorTest {

    private val mapper = ObjectMapper().registerKotlinModule()
    private val engine = DroolsDecisionEngine()

    @Test
    fun `every FEEL semantics vector evaluates to its pinned result`() {
        val doc = mapper.readTree(File("../schemas/decision-feel/vectors.json"))
        val vectors = doc["vectors"]
        assertTrue(vectors.size() >= 5, "a meaningful set of interchange-ambiguity vectors")

        for (vector in vectors) {
            val id = vector["id"].asText()
            val source = DecisionSource(
                namespace = "https://ichiflow.ai/dmn/feel/$id",
                name = "feel_$id",
                decision = DecisionDef(name = "Result", type = "Any", literal = vector["expr"].asText()),
            )
            val model = engine.load(DecisionSourceCompiler.compile(source), "$id.dmn")
            val ev = engine.evaluate(model, emptyMap())
            assertFalse(ev.hasErrors, "$id evaluates without errors: ${ev.messages}")
            assertEquals(vector["expect"].asText(), ev.resultOf("Result")?.toString(), "vector $id")
        }
    }
}
