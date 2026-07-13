package ai.ichiflow.core.decision.trace

import ai.ichiflow.core.decision.DecisionSource
import ai.ichiflow.core.decision.DecisionSourceCompiler
import ai.ichiflow.core.decision.spi.DecisionTrace
import ai.ichiflow.core.decision.spi.DroolsDecisionEngine
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File

/**
 * DecisionTrace emission runner (build plan 2.3, doc 03 §7). Projects every construct in the DMN
 * feature matrix to DMN 1.6, evaluates it on the SPI reference engine, and emits the typed
 * [DecisionTrace] each `evaluate` produces to `core/build/decision-trace-results.json`. The
 * `decision-layer` trace-shape harness validates every emitted trace against the frozen `DecisionTrace`
 * JSON Schema — proof that the explainability contract the DecisionRecord/why API depends on holds.
 */
object DecisionTraceRunner {

    @JvmStatic
    fun main(args: Array<String>) {
        val repoRoot = File("..").canonicalFile
        val matrixFile = File(repoRoot, args.getOrElse(0) { "schemas/decision-source/projection/matrix.json" })
        val outputFile = File(args.getOrElse(1) { "build/decision-trace-results.json" })

        val mapper = ObjectMapper().registerKotlinModule()
            .setSerializationInclusion(JsonInclude.Include.NON_NULL)
        val matrix = mapper.readTree(matrixFile)
        val engine = DroolsDecisionEngine()

        val root = mapper.createObjectNode()
        root.put("engine", engine.capabilities.engineId)
        root.put("engineVersion", engine.capabilities.engineVersion)
        val arr = root.putArray("traces")

        for (node in matrix["constructs"]) {
            arr.add(traceFor(mapper, engine, node))
        }

        outputFile.parentFile.mkdirs()
        outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
        println("Wrote ${matrix["constructs"].size()} decision traces to ${outputFile.path}")
    }

    private fun traceFor(mapper: ObjectMapper, engine: DroolsDecisionEngine, node: JsonNode): ObjectNode {
        val construct = node["construct"].asText()
        val source = mapper.treeToValue(node["source"], DecisionSource::class.java)
        val dmn = DecisionSourceCompiler.compile(source)
        val model = engine.load(dmn, "$construct.dmn")

        val inputs = mutableMapOf<String, Any?>()
        node["inputs"].fields().forEach { (k, v) ->
            inputs[k] = if (v.isNumber) v.numberValue() else v.asText()
        }

        val trace: DecisionTrace = engine.trace(model, inputs)
        val entry = mapper.createObjectNode()
        entry.put("construct", construct)
        entry.set<ObjectNode>("trace", mapper.valueToTree(trace))
        return entry
    }
}
