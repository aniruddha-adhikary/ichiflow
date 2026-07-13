package ai.ichiflow.core.decision.feel

import ai.ichiflow.core.decision.DecisionDef
import ai.ichiflow.core.decision.DecisionSource
import ai.ichiflow.core.decision.DecisionSourceCompiler
import ai.ichiflow.core.decision.spi.DroolsDecisionEngine
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File

/**
 * FEEL semantics-vector runner (build plan 2.4; doc 13 §2.b, doc 03 open-q4). Each vector is a known
 * DMN/FEEL interchange-ambiguity expression (list `sort` ordering, string built-ins, decimal rounding,
 * date arithmetic; research 01 §7) pinned to the reference engine's chosen, published result. Each is
 * evaluated as a single literal-expression decision on the SPI reference engine and compared to the
 * pin. Writes `core/build/feel-vector-results.json`, consumed by the `decision-layer` scope for
 * `feel_vectors_green / total`. A KIE bump that silently shifts a result fails loudly here.
 */
object FeelVectorRunner {

    @JvmStatic
    fun main(args: Array<String>) {
        val repoRoot = File("..").canonicalFile
        val vectorsFile = File(repoRoot, args.getOrElse(0) { "schemas/decision-feel/vectors.json" })
        val outputFile = File(args.getOrElse(1) { "build/feel-vector-results.json" })

        val mapper = ObjectMapper().registerKotlinModule()
        val doc = mapper.readTree(vectorsFile)
        val engine = DroolsDecisionEngine()

        val root = mapper.createObjectNode()
        root.put("engine", engine.capabilities.engineId)
        root.put("engineVersion", engine.capabilities.engineVersion)
        val arr = root.putArray("vectors")

        for (vector in doc["vectors"]) {
            arr.add(evaluateVector(mapper, engine, vector))
        }

        outputFile.parentFile.mkdirs()
        outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
        println("Wrote ${doc["vectors"].size()} FEEL vector results to ${outputFile.path}")
    }

    private fun evaluateVector(
        mapper: ObjectMapper,
        engine: DroolsDecisionEngine,
        vector: JsonNode,
    ): com.fasterxml.jackson.databind.node.ObjectNode {
        val id = vector["id"].asText()
        val expect = vector["expect"].asText()
        val source = DecisionSource(
            namespace = "https://ichiflow.ai/dmn/feel/$id",
            name = "feel_$id",
            decision = DecisionDef(name = "Result", type = "Any", literal = vector["expr"].asText()),
        )
        val model = engine.load(DecisionSourceCompiler.compile(source), "$id.dmn")
        val evaluation = engine.evaluate(model, emptyMap())
        val actual = evaluation.resultOf("Result")?.toString()

        val node = mapper.createObjectNode()
        node.put("id", id)
        node.put("expect", expect)
        node.put("actual", actual)
        node.put("green", !evaluation.hasErrors && actual == expect)
        return node
    }
}
