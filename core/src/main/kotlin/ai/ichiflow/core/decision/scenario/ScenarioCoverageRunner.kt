package ai.ichiflow.core.decision.scenario

import ai.ichiflow.core.decision.DecisionSource
import ai.ichiflow.core.decision.DecisionSourceCompiler
import ai.ichiflow.core.decision.spi.DroolsDecisionEngine
import ai.ichiflow.core.decision.spi.LoadedModel
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File

/**
 * Scenario-suite + rule/row coverage runner (build plan 2.4, doc 03 §6.1/§6.2). For a DecisionModel's
 * governed `Harness`, it runs each business-readable given/expect case against the projected DMN 1.6
 * model on the SPI reference engine, asserting the full typed `Outcome` (type + reasons + conditions),
 * and computes rule/row coverage from the engine's fired decision-table rows. Writes
 * `core/build/scenario-coverage-results.json`, consumed by the `decision-layer` scope for
 * `scenarios_pass / total` and the coverage gate.
 */
object ScenarioCoverageRunner {

    @JvmStatic
    fun main(args: Array<String>) {
        val repoRoot = File("..").canonicalFile
        val harnessFile = File(repoRoot, args.getOrElse(0) { "schemas/decision-harness/loan-eligibility.harness.json" })
        val sourceFile = File(repoRoot, args.getOrElse(1) { "schemas/decision-harness/loan-eligibility.source.json" })
        val outputFile = File(args.getOrElse(2) { "build/scenario-coverage-results.json" })

        val mapper = ObjectMapper().registerKotlinModule()
        val harness = mapper.readTree(harnessFile)
        val source = mapper.readValue(sourceFile, DecisionSource::class.java)

        val engine = DroolsDecisionEngine()
        val dmn = DecisionSourceCompiler.compile(source)
        val model = engine.load(dmn, "${source.name}.dmn")

        val totalRows = source.allDecisions().sumOf { it.decisionTable?.rules?.size ?: 0 }
        val coveredRows = mutableSetOf<String>()

        val root = mapper.createObjectNode()
        root.put("decisionModel", harness["decisionModel"].asText())
        root.put("coverageThreshold", harness["coverageThreshold"].asDouble())
        val cases: ArrayNode = root.putArray("cases")

        val defaults = source.inputs.associate<_, String, Any?> { it.name to null }
        for (scenario in harness["scenarios"]) {
            val scenarioName = scenario["name"].asText()
            for (case in scenario["cases"]) {
                runCase(engine, model, defaults, case, coveredRows, cases.addObject().put("scenario", scenarioName))
            }
        }

        val coverage = if (totalRows == 0) 1.0 else coveredRows.size.toDouble() / totalRows
        root.put("coverage", coverage)
        root.put("coveredRows", coveredRows.size)
        root.put("totalRows", totalRows)

        outputFile.parentFile.mkdirs()
        outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
        println("Wrote ${cases.size()} scenario results (coverage=$coverage) to ${outputFile.path}")
    }

    private fun runCase(
        engine: DroolsDecisionEngine,
        model: LoadedModel,
        defaults: Map<String, Any?>,
        case: JsonNode,
        coveredRows: MutableSet<String>,
        node: ObjectNode,
    ) {
        val evaluation = engine.evaluate(model, defaults + readGiven(case["given"]))
        evaluation.firedRules.forEach { (decision, rows) -> rows.forEach { coveredRows.add("$decision#$it") } }
        val failure =
            outcomeFailure(case["expect"], evaluation.resultOf("Assessment"), evaluation.hasErrors, evaluation.messages)
        node.put("name", case["name"].asText())
        node.put("pass", failure == null)
        node.put("detail", failure ?: "ok")
    }

    private fun readGiven(given: JsonNode): Map<String, Any?> {
        val inputs = mutableMapOf<String, Any?>()
        given.fields().forEach { (k, v) ->
            inputs[k] = when {
                v.isNumber -> v.numberValue()
                v.isBoolean -> v.booleanValue()
                v.isNull -> null
                else -> v.asText()
            }
        }
        return inputs
    }

    /** Returns null when the assessment satisfies the expected typed Outcome, else a readable reason. */
    private fun outcomeFailure(
        expect: JsonNode,
        assessment: Any?,
        hasErrors: Boolean,
        messages: List<String>,
    ): String? {
        val prelude = when {
            hasErrors -> "evaluation errors: $messages"
            assessment !is Map<*, *> -> "Assessment did not produce an Outcome context: $assessment"
            else -> null
        }
        if (prelude != null) return prelude

        val outcome = assessment as Map<*, *>
        val type = outcome["type"]?.toString()
        if (type != expect["type"].asText()) return "type expected ${expect["type"].asText()}, got $type"

        val badReason = expect["reasons"]?.firstOrNull {
            !hasRef(outcome["reasons"], it["code"].asText(), it["codeSet"].asText())
        }
        if (badReason != null) return "missing reason ${badReason["code"].asText()}@${badReason["codeSet"].asText()}"

        val badCondition = expect["conditions"]?.firstOrNull { !hasCondition(outcome["conditions"], it) }
        return badCondition?.let {
            "missing condition ${it["code"]["code"].asText()} (${it["kind"].asText()}/${it["state"].asText()})"
        }
    }

    private fun hasRef(reasons: Any?, code: String, codeSet: String): Boolean {
        val list = reasons as? List<*> ?: return false
        return list.any { it is Map<*, *> && it["code"] == code && it["codeSet"] == codeSet }
    }

    private fun hasCondition(conditions: Any?, expected: JsonNode): Boolean {
        val list = conditions as? List<*> ?: return false
        return list.any {
            it is Map<*, *> &&
                it["code"] == expected["code"]["code"].asText() &&
                it["codeSet"] == expected["code"]["codeSet"].asText() &&
                it["kind"] == expected["kind"].asText() &&
                it["state"] == expected["state"].asText()
        }
    }
}
