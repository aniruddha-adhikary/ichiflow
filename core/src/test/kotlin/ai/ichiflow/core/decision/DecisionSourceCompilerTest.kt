package ai.ichiflow.core.decision

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DecisionSourceCompilerTest {

    private val mapper = ObjectMapper().registerKotlinModule()

    private fun feeSource(): DecisionSource {
        val file = File("../schemas/decision-source/fixtures/fee.decision.json")
        return mapper.readValue(file, DecisionSource::class.java)
    }

    @Test
    fun `compiles decision-source to valid DMN 1_6`() {
        val xml = DecisionSourceCompiler.compile(feeSource())
        assertTrue(xml.contains("https://www.omg.org/spec/DMN/20240513/MODEL/"), "DMN 1.6 model namespace")
        assertTrue(xml.contains("<businessKnowledgeModel"), "BKM projected")
        assertTrue(xml.contains("<invocation>"), "invocation projected")
        assertTrue(xml.contains("<context>"), "boxed context projected")
    }

    @Test
    fun `compiled DMN executes identically to the hand-authored reference`() {
        val xml = DecisionSourceCompiler.compile(feeSource())
        val referenceXml = javaClass.getResourceAsStream("/dmn/reference/fee.dmn")!!
            .bufferedReader().use { it.readText() }

        val compiled = buildAndEval(xml, "compiled.dmn", mapOf("Income" to 2000, "Region" to "A"))
        val reference = buildAndEval(referenceXml, "reference.dmn", mapOf("Income" to 2000, "Region" to "A"))

        assertFalse(compiled.second, "compiled model has no DMN errors")
        assertFalse(reference.second, "reference model has no DMN errors")
        assertEquals(reference.first, compiled.first, "compiled result equals reference")
        assertEquals("200", compiled.first)
    }

    private fun buildAndEval(
        xml: String,
        path: String,
        inputs: Map<String, Any?>,
    ): Pair<String?, Boolean> {
        val res = org.kie.internal.io.ResourceFactory.newReaderResource(java.io.StringReader(xml))
            .apply { setSourcePath(path) }
        res.resourceType = org.kie.api.io.ResourceType.DMN
        val runtime = org.kie.dmn.core.internal.utils.DMNRuntimeBuilder.fromDefaults()
            .buildConfiguration()
            .fromResources(listOf(res))
            .getOrElseThrow { e -> RuntimeException("build failed", e) }
        return DecisionProjectionSpike.evaluate(runtime, inputs, "Fee")
    }
}
