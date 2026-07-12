package ai.ichiflow.core.contracts

import ai.ichiflow.contracts.models.IchiflowVerifyVerdict
import ai.ichiflow.contracts.models.IchiflowVerifyVerdictEnvelope
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Round-trip proof for the Fabrikt-generated Kotlin models (build plan 1.2): the canonical verdict
 * envelope must deserialize into the generated model and survive a serialize→deserialize cycle with
 * structural equality. If codegen drifts from the authored contract this stops compiling or fails.
 */
class ContractModelRoundTripTest {
    private val mapper: ObjectMapper =
        ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule())

    private val canonical =
        """
        {"verifyVersion":"1","scope":"self-check","ranAt":"2026-07-12T00:00:00Z","seed":"sha256:0000","verdict":"pass","summary":{"checks":1,"passed":1,"failed":0,"skipped":0},"progress":{"conformance":{"green":1,"total":1}},"checks":[{"id":"self-check.example","status":"pass"}],"flaky":false}
        """.trimIndent()

    @Test
    fun `round-trips the canonical verdict envelope through the generated model`() {
        val envelope = mapper.readValue(canonical, IchiflowVerifyVerdictEnvelope::class.java)

        assertEquals("self-check", envelope.scope)
        assertEquals(IchiflowVerifyVerdict.PASS, envelope.verdict)
        assertEquals(false, envelope.flaky)
        assertEquals(1, envelope.summary.passed)
        assertEquals(1, envelope.progress.conformance?.green)

        val reparsed =
            mapper.readValue(mapper.writeValueAsString(envelope), IchiflowVerifyVerdictEnvelope::class.java)
        assertEquals(envelope, reparsed)
    }
}
