package ai.ichiflow.core.spike

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SpikeValidatorTest {
    private val repoRoot = File("..").canonicalFile
    private val schemaDir = File(repoRoot, "schemas/generated/json-schema")
    private val corpusFile = File(repoRoot, "schemas/spike/corpus.json")

    @Test
    fun networknt_matches_every_expected_verdict() {
        val vectors = SpikeValidator.loadCorpus(corpusFile)
        assertTrue(vectors.isNotEmpty(), "probe corpus is empty")

        val results = SpikeValidator.validate(schemaDir, corpusFile)
        val disagreements = vectors.filter { results[it.id] != it.expect }
            .map { "${it.id}: expected ${it.expect}, got ${results[it.id]}" }

        assertEquals(emptyList(), disagreements, "networknt disagreed with expected verdicts")
    }
}
