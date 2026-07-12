package ai.ichiflow.core.decision

import ai.ichiflow.core.decision.spi.DecisionEngine
import ai.ichiflow.core.decision.spi.DroolsDecisionEngine
import ai.ichiflow.core.decision.spi.LoadedModel
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File

/**
 * Phase 2.0 decision-projection spike (build plan 2.0, ADR-0001/0002/0027). Compiles the
 * `decision-source` fixture to DMN 1.6 and executes **both** it and the hand-authored reference DMN
 * on Apache KIE / Drools (pinned 10.2.0) across the input vectors, asserting identical results. This
 * retires "riskiest bet #2": the hard boxed-expression kinds (BKM FEEL functions, boxed contexts,
 * invocations) both compile to valid DMN *and* execute identically to a reference. Results are
 * written machine-readably for the `decision-projection-spike` verify scope.
 *
 * As of Phase 2.1 the KIE coupling lives behind the [DecisionEngine] SPI; this spike drives that
 * engine rather than talking to `org.kie.*` directly.
 */
object DecisionProjectionSpike {

    /** Evaluate one decision over one input row; returns the stringified result + whether it errored. */
    fun evaluate(engine: DecisionEngine, model: LoadedModel, inputs: Map<String, Any?>, decisionName: String): Pair<String?, Boolean> {
        val evaluation = engine.evaluate(model, inputs)
        return evaluation.resultOf(decisionName)?.toString() to evaluation.hasErrors
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

        val engine = DroolsDecisionEngine()
        val referenceModel = engine.load(referenceXml, "reference.dmn")
        val compiledModel = engine.load(compiledXml, "compiled.dmn")

        val root = mapper.createObjectNode()
        root.put("engine", "kie-dmn:${engine.capabilities.engineVersion}")
        root.put("specVersion", "DMN 1.6")
        root.put("decision", decisionName)
        val arr = root.putArray("vectors")

        for (vector in vectors["vectors"]) {
            val id = vector["id"].asText()
            val inputs = mutableMapOf<String, Any?>()
            vector["inputs"].fields().forEach { (k, node) ->
                inputs[k] = if (node.isNumber) node.numberValue() else node.asText()
            }
            val (refValue, refError) = evaluate(engine, referenceModel, inputs, decisionName)
            val (compValue, compError) = evaluate(engine, compiledModel, inputs, decisionName)

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
