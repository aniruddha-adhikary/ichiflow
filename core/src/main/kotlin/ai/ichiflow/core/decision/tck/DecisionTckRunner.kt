package ai.ichiflow.core.decision.tck

import ai.ichiflow.core.decision.spi.DecisionEngine
import ai.ichiflow.core.decision.spi.DroolsDecisionEngine
import ai.ichiflow.core.decision.spi.EngineCapabilities
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import java.io.File

/**
 * DMN-TCK subset conformance runner (build plan 2.1, ADR-0002). Runs the curated conformance cases
 * (`schemas/decision-tck/cases.json`) through the Decision Engine SPI reference engine (Drools),
 * recording per-case actual-vs-expected results and the engine's published capability descriptor.
 * The `decision-layer` verify scope consumes the emitted `core/build/decision-tck-results.json` and
 * asserts `tck_cases_green == total` plus capability-descriptor conformance.
 */
object DecisionTckRunner {

    @JvmStatic
    fun main(args: Array<String>) {
        val repoRoot = File("..").canonicalFile
        val casesFile = File(repoRoot, args.getOrElse(0) { "schemas/decision-tck/cases.json" })
        val outputFile = File(args.getOrElse(1) { "build/decision-tck-results.json" })

        val mapper = ObjectMapper()
        val corpus = mapper.readTree(casesFile)
        val engine = DroolsDecisionEngine()

        val root = mapper.createObjectNode()
        root.put("engine", engine.capabilities.engineId)
        root.put("engineVersion", engine.capabilities.engineVersion)
        root.put("suite", corpus["suite"]?.asText())
        root.set<ObjectNode>("capabilities", capabilitiesNode(mapper, engine.capabilities))
        val arr = root.putArray("cases")

        for (case in corpus["cases"]) {
            arr.add(runCase(mapper, engine, case))
        }

        outputFile.parentFile.mkdirs()
        outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
        println("Wrote ${corpus["cases"].size()} TCK conformance results to ${outputFile.path}")
    }

    private fun runCase(mapper: ObjectMapper, engine: DecisionEngine, case: JsonNode): ObjectNode {
        val modelPath = case["model"].asText()
        val decision = case["decision"].asText()
        val xml = javaClass.getResourceAsStream(modelPath)
            ?.bufferedReader()?.use { it.readText() }
            ?: error("bundled TCK model not found on classpath: $modelPath")

        val inputs = mutableMapOf<String, Any?>()
        case["inputs"].fields().forEach { (k, node) ->
            inputs[k] = if (node.isNumber) node.numberValue() else node.asText()
        }

        val evaluation = engine.load(xml, modelPath).let { engine.evaluate(it, inputs) }
        val actual = evaluation.resultOf(decision)?.toString()

        return mapper.createObjectNode().apply {
            put("id", case["id"].asText())
            put("model", modelPath)
            put("decision", decision)
            put("kind", case["kind"]?.asText())
            put("expect", case["expect"]?.asText())
            put("actual", actual)
            put("errors", evaluation.hasErrors)
        }
    }

    private fun capabilitiesNode(mapper: ObjectMapper, cap: EngineCapabilities): ObjectNode =
        mapper.createObjectNode().apply {
            put("engineId", cap.engineId)
            put("engineVersion", cap.engineVersion)
            putArray("dmnSpecVersions").also { arr -> cap.dmnSpecVersions.forEach { arr.add(it) } }
            put("feel", cap.feel)
            put("decisionTable", cap.decisionTable)
            put("businessKnowledgeModel", cap.businessKnowledgeModel)
            put("context", cap.context)
            put("invocation", cap.invocation)
        }
}
