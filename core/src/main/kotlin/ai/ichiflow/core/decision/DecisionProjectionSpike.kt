package ai.ichiflow.core.decision

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File
import java.io.StringReader
import java.math.BigDecimal
import org.kie.api.io.ResourceType
import org.kie.dmn.api.core.DMNMessage
import org.kie.dmn.api.core.DMNRuntime
import org.kie.dmn.core.internal.utils.DMNRuntimeBuilder
import org.kie.internal.io.ResourceFactory

/**
 * Phase 2.0 decision-projection spike (build plan 2.0, ADR-0001/0002/0027). Compiles the
 * `decision-source` fixture to DMN 1.6 and executes **both** it and the hand-authored reference DMN
 * on Apache KIE / Drools (pinned 10.2.0) across the input vectors, asserting identical results. This
 * retires "riskiest bet #2": the hard boxed-expression kinds (BKM FEEL functions, boxed contexts,
 * invocations) both compile to valid DMN *and* execute identically to a reference. Results are
 * written machine-readably for the `decision-projection-spike` verify scope.
 */
object DecisionProjectionSpike {

    private fun buildRuntime(xml: String, sourcePath: String): DMNRuntime {
        val res = ResourceFactory.newReaderResource(StringReader(xml))
            .apply { sourcePath.let { setSourcePath(it) } }
        res.resourceType = ResourceType.DMN
        return DMNRuntimeBuilder.fromDefaults()
            .buildConfiguration()
            .fromResources(listOf(res))
            .getOrElseThrow { e -> RuntimeException("DMN runtime build failed for $sourcePath", e) }
    }

    private fun coerce(v: Any?): Any? =
        when (v) {
            is Int -> BigDecimal(v)
            is Long -> BigDecimal(v)
            is Double -> BigDecimal(v.toString())
            is Float -> BigDecimal(v.toString())
            else -> v
        }

    /** Evaluate one decision over one input row; returns the stringified result + whether it errored. */
    fun evaluate(runtime: DMNRuntime, inputs: Map<String, Any?>, decisionName: String): Pair<String?, Boolean> {
        val model = runtime.models.first()
        val ctx = runtime.newContext()
        for ((k, v) in inputs) ctx.set(k, coerce(v))
        val result = runtime.evaluateAll(model, ctx)
        val hasError = result.messages.any { it.severity == DMNMessage.Severity.ERROR }
        val value = result.getDecisionResultByName(decisionName)?.result
        return value?.toString() to hasError
    }

    @JvmStatic
    fun main(args: Array<String>) {
        // Working dir is core/; the decision-source + vectors live one level up under schemas/.
        val repoRoot = File("..").canonicalFile
        val sourceFile = File(repoRoot, args.getOrElse(0) { "schemas/decision-source/fixtures/fee.decision.json" })
        val vectorsFile = File(repoRoot, args.getOrElse(1) { "schemas/decision-source/vectors.json" })
        val outputFile = File(args.getOrElse(2) { "build/decision-projection-results.json" })

        val mapper = ObjectMapper().registerKotlinModule()
        val source = mapper.readValue(sourceFile, DecisionSource::class.java)
        val vectors = mapper.readTree(vectorsFile)
        val decisionName = vectors["decision"].asText()

        val referenceXml = javaClass.getResourceAsStream("/dmn/reference/fee.dmn")!!
            .bufferedReader().use { it.readText() }
        val compiledXml = DecisionSourceCompiler.compile(source)

        val referenceRuntime = buildRuntime(referenceXml, "reference.dmn")
        val compiledRuntime = buildRuntime(compiledXml, "compiled.dmn")

        val root = mapper.createObjectNode()
        root.put("engine", "kie-dmn:10.2.0")
        root.put("specVersion", "DMN 1.6")
        root.put("decision", decisionName)
        val arr = root.putArray("vectors")

        for (vector in vectors["vectors"]) {
            val id = vector["id"].asText()
            val inputs = mutableMapOf<String, Any?>()
            vector["inputs"].fields().forEach { (k, node) ->
                inputs[k] = if (node.isNumber) node.numberValue() else node.asText()
            }
            val (refValue, refError) = evaluate(referenceRuntime, inputs, decisionName)
            val (compValue, compError) = evaluate(compiledRuntime, inputs, decisionName)

            val node = arr.addObject()
            node.put("id", id)
            node.put("expect", vector["expect"]?.asText())
            node.put("reference", refValue)
            node.put("compiled", compValue)
            node.put("match", refValue != null && refValue == compValue)
            node.put("referenceErrors", refError)
            node.put("compiledErrors", compError)
        }

        outputFile.parentFile.mkdirs()
        outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
        println("Wrote ${vectors["vectors"].size()} projection results to ${outputFile.path}")
    }
}
