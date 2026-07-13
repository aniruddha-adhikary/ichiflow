package ai.ichiflow.core.decision.projection

import ai.ichiflow.core.decision.DecisionSource
import ai.ichiflow.core.decision.DecisionSourceCompiler
import ai.ichiflow.core.decision.spi.DecisionEngine
import ai.ichiflow.core.decision.spi.DroolsDecisionEngine
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File

/**
 * Projection-coverage runner (build plan 2.2, ADR-0027). For each construct in the DMN feature
 * matrix (`schemas/decision-source/projection/matrix.json`) it compiles the embedded `decision-source`
 * one-way to DMN 1.6 via [DecisionSourceCompiler] and executes the projected model on the reference
 * engine behind the Decision Engine SPI, recording whether the construct is `covered` (projects,
 * executes, and matches its expected outcome). The `decision-layer` verify scope consumes the emitted
 * `core/build/projection-coverage-results.json` and asserts `constructs_covered == total`.
 */
object ProjectionCoverageRunner {

    @JvmStatic
    fun main(args: Array<String>) {
        val repoRoot = File("..").canonicalFile
        val matrixFile = File(repoRoot, args.getOrElse(0) { "schemas/decision-source/projection/matrix.json" })
        val outputFile = File(args.getOrElse(1) { "build/projection-coverage-results.json" })

        val mapper = ObjectMapper().registerKotlinModule()
        val matrix = mapper.readTree(matrixFile)
        val engine = DroolsDecisionEngine()

        val root = mapper.createObjectNode()
        root.put("engine", engine.capabilities.engineId)
        root.put("engineVersion", engine.capabilities.engineVersion)
        root.put("suite", matrix["suite"]?.asText())
        val arr = root.putArray("constructs")

        for (node in matrix["constructs"]) {
            arr.add(runConstruct(mapper, engine, node))
        }

        outputFile.parentFile.mkdirs()
        outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
        println("Wrote ${matrix["constructs"].size()} projection-coverage results to ${outputFile.path}")
    }

    // A construct that fails to project or execute for ANY reason (bad projection, engine load
    // failure, FEEL error) must be recorded as an uncovered construct — deterministically — rather
    // than aborting the whole coverage run. The catch-all is the point, hence the localized suppress.
    @Suppress("TooGenericExceptionCaught")
    private fun runConstruct(mapper: ObjectMapper, engine: DecisionEngine, node: JsonNode): ObjectNode {
        val construct = node["construct"].asText()
        val decisionName = node["decision"].asText()
        val expect = node["expect"]?.asText()
        val kind = node["kind"]?.asText()

        val result = mapper.createObjectNode()
        result.put("construct", construct)
        result.put("decision", decisionName)
        result.put("kind", kind)
        result.put("expect", expect)

        try {
            val source = mapper.treeToValue(node["source"], DecisionSource::class.java)
            val dmn = DecisionSourceCompiler.compile(source)
            val model = engine.load(dmn, "$construct.dmn")
            val evaluation = engine.evaluate(model, readInputs(node["inputs"]))
            val actual = evaluation.resultOf(decisionName)?.toString()
            result.put("actual", actual)
            result.put("errors", evaluation.hasErrors)
            result.put("covered", !evaluation.hasErrors && actual != null && matches(kind, expect, actual))
        } catch (ex: Exception) {
            result.put("actual", null as String?)
            result.put("errors", true)
            result.put("covered", false)
            result.put("message", "${ex.javaClass.simpleName}: ${ex.message}")
        }
        return result
    }

    private fun readInputs(node: JsonNode?): Map<String, Any?> {
        val inputs = mutableMapOf<String, Any?>()
        node?.fields()?.forEach { (k, v) ->
            inputs[k] = if (v.isNumber) v.numberValue() else v.asText()
        }
        return inputs
    }

    /** Numeric-tolerant for `kind: number` (FEEL scale: `80` vs `80.0`); exact string otherwise. */
    private fun matches(kind: String?, expect: String?, actual: String): Boolean {
        if (expect == null) return false
        if (expect == actual) return true
        if (kind != "number") return false
        val e = expect.toBigDecimalOrNull()
        val a = actual.toBigDecimalOrNull()
        return e != null && a != null && e.compareTo(a) == 0
    }
}
