package ai.ichiflow.core.authz

import ai.ichiflow.core.authz.engine.AuthzModel
import ai.ichiflow.core.authz.engine.InMemoryOpenFgaEngine
import ai.ichiflow.core.authz.engine.RelationTuple
import ai.ichiflow.core.authz.pep.ArtifactAccessPep
import ai.ichiflow.core.authz.pep.RuntimeAccessPep
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Build-failing unit tests for the OpenFGA-semantics reference engine, the PDP gateway, and the PEPs
 * (build plan 4.3, doc 06 Part 4). These pin the check semantics (direct / computed-userset /
 * tuple-to-userset / union, transitive membership, association read-without-leak), the mandatory
 * decision log, and design-time = runtime parity independently of the vector-file harness.
 */
class AuthzEngineTest {

    private val mapper = ObjectMapper().registerKotlinModule()

    private fun loadEngine(): InMemoryOpenFgaEngine {
        val root = File("..").canonicalFile
        val model = mapper.treeToValue(
            mapper.readTree(File(root, "schemas/authz/model.json")),
            AuthzModel::class.java,
        )
        val tuples = mapper.readTree(File(root, "schemas/authz/tuples.json")).map {
            RelationTuple(it["object"].asText(), it["relation"].asText(), it["user"].asText())
        }
        return InMemoryOpenFgaEngine(model, tuples)
    }

    @Test
    fun `steward inherits can_edit and can_approve via tuple-to-userset from owner`() {
        val engine = loadEngine()
        assertTrue(engine.check("user:sara", "can_edit", "artifact:codeset-natures", emptyMap()).allow)
        assertTrue(engine.check("user:sara", "can_approve", "artifact:codeset-natures", emptyMap()).allow)
    }

    @Test
    fun `editor can edit but cannot approve`() {
        val engine = loadEngine()
        assertTrue(engine.check("user:eve", "can_edit", "artifact:codeset-natures", emptyMap()).allow)
        assertFalse(engine.check("user:eve", "can_approve", "artifact:codeset-natures", emptyMap()).allow)
    }

    @Test
    fun `nested team membership grants view transitively`() {
        val engine = loadEngine()
        assertTrue(engine.check("user:nick", "can_view", "artifact:codeset-natures", emptyMap()).allow)
    }

    @Test
    fun `other-team member is denied across the ownership boundary`() {
        val engine = loadEngine()
        assertFalse(engine.check("user:pat", "can_view", "artifact:codeset-natures", emptyMap()).allow)
        assertFalse(engine.check("user:pat", "can_view", "case:c-100", emptyMap()).allow)
    }

    @Test
    fun `association reader can view a linked case but not modify it (read without leak)`() {
        val engine = loadEngine()
        assertTrue(engine.check("user:iris", "can_view", "case:c-100", emptyMap()).allow)
        assertFalse(engine.check("user:iris", "can_modify", "case:c-100", emptyMap()).allow)
    }

    @Test
    fun `an assignee scoped to one linked case gains no visibility into the peer`() {
        val engine = loadEngine()
        assertFalse(engine.check("user:carl", "can_view", "case:c-100", emptyMap()).allow)
    }

    @Test
    fun `the PDP records one decision-log entry per check with a reason and effect`() {
        val pdp = Pdp(loadEngine())
        val allow = pdp.check("user:dan", "can_modify", "case:c-100", emptyMap())
        val deny = pdp.check("user:vic", "can_modify", "case:c-100", emptyMap())
        assertTrue(allow.allow)
        assertFalse(deny.allow)
        val log = pdp.decisionLog()
        assertEquals(2, log.size)
        assertEquals("allow", log[0].effect)
        assertEquals("deny", log[1].effect)
        assertTrue(log.all { it.decisionId.isNotBlank() && it.reason.isNotBlank() })
    }

    @Test
    fun `the decision id is deterministic across identical checks`() {
        val a = Pdp(loadEngine()).also { it.check("user:dan", "can_view", "case:c-100", emptyMap()) }
        val b = Pdp(loadEngine()).also { it.check("user:dan", "can_view", "case:c-100", emptyMap()) }
        assertEquals(a.decisionLog()[0].decisionId, b.decisionLog()[0].decisionId)
    }

    @Test
    fun `design-time and runtime PEPs agree for every artifact and case check (one PDP)`() {
        val artifactPep = ArtifactAccessPep(Pdp(loadEngine()))
        val runtimePep = RuntimeAccessPep(Pdp(loadEngine()))
        val probes = listOf(
            Triple("user:sara", "can_edit", "artifact:codeset-natures"),
            Triple("user:iris", "can_view", "case:c-100"),
            Triple("user:pat", "can_view", "case:c-100"),
        )
        for ((subject, relation, obj) in probes) {
            assertEquals(
                artifactPep.mayAccess(subject, relation, obj).allow,
                runtimePep.mayAccess(subject, relation, obj).allow,
                "PEPs must not disagree for $subject $relation $obj",
            )
        }
    }
}
