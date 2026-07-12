package ai.ichiflow.core.spike

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaValidatorsConfig
import com.networknt.schema.SpecVersion
import java.io.File

/**
 * The JVM half of the cross-language fidelity spike (build plan 1.0, ADR-0006). Validates the same
 * probe corpus, against the same emitted JSON Schemas, that the TS `schema-fidelity-spike` scope
 * runs through Ajv. networknt is configured to mirror the Ajv config (format assertion ON) so any
 * accept/reject divergence is a genuine schema-fidelity finding, not a config artifact.
 */
object SpikeValidator {
    // A synthetic base URI so relative `$ref`s (e.g. "Email.json") resolve within the registered set
    // rather than hitting the disk or network.
    private const val BASE = "https://ichiflow.local/schema/"

    private val mapper = ObjectMapper()

    data class Vector(val id: String, val schema: String, val expect: String, val instance: JsonNode)

    fun loadCorpus(corpusFile: File): List<Vector> {
        val root = mapper.readTree(corpusFile)
        return root.get("vectors").map { v ->
            Vector(
                id = v.get("id").asText(),
                schema = v.get("schema").asText(),
                expect = v.get("expect").asText(),
                instance = v.get("instance"),
            )
        }
    }

    /** Validate every vector, returning vectorId -> "accept" | "reject" (insertion order preserved). */
    fun validate(schemaDir: File, corpusFile: File): LinkedHashMap<String, String> {
        val schemaTexts = schemaDir.listFiles { f -> f.extension == "json" }
            ?.associate { BASE + it.name to it.readText() }
            ?: emptyMap()

        val factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012) { builder ->
            builder.schemaLoaders { loaders -> loaders.schemas(schemaTexts) }
        }
        val config = SchemaValidatorsConfig.builder().formatAssertionsEnabled(true).build()

        val results = LinkedHashMap<String, String>()
        for (v in loadCorpus(corpusFile)) {
            val schema = factory.getSchema(SchemaLocation.of(BASE + v.schema), config)
            val messages = schema.validate(v.instance)
            results[v.id] = if (messages.isEmpty()) "accept" else "reject"
        }
        return results
    }
}

fun main(args: Array<String>) {
    // Working dir is the Gradle project dir (core/); the schemas + corpus live one level up.
    // Args (both optional): [0] repo-relative corpus path, [1] core-relative output path. Defaults
    // target the fidelity spike so `pnpm spike:jvm` stays argument-free; `pnpm vectors:jvm` passes
    // the real-contract corpus (build plan 1.3).
    val repoRoot = File("..").canonicalFile
    val schemaDir = File(repoRoot, "schemas/generated/json-schema")
    val corpusFile = File(repoRoot, args.getOrElse(0) { "schemas/spike/corpus.json" })
    val outputFile = File(args.getOrElse(1) { "build/spike-results.json" })

    val results = SpikeValidator.validate(schemaDir, corpusFile)

    val mapper = ObjectMapper()
    val root = mapper.createObjectNode()
    root.put("validator", "networknt:1.5.4")
    val resultsNode = root.putObject("results")
    for ((id, verdict) in results) resultsNode.put(id, verdict)

    outputFile.parentFile.mkdirs()
    outputFile.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")
    println("Wrote ${results.size} results from ${corpusFile.name} to ${outputFile.path}")
}
