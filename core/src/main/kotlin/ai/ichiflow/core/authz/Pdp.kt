package ai.ichiflow.core.authz

import ai.ichiflow.core.authz.spi.AuthzDecision
import ai.ichiflow.core.authz.spi.PolicyEngine
import java.security.MessageDigest

/**
 * One **authorization decision-log** entry (doc 06 §2.4, ADR-0010) — mandatory for every PDP decision.
 * Matches the emitted `AuthzDecisionLog` JSON Schema; feeds compliance audit, the UI explanation
 * surface, and the DecisionRecord.
 */
data class DecisionLogEntry(
    val decisionId: String,
    val principal: String,
    val action: String,
    val resource: String,
    val context: Map<String, Any?>,
    val effect: String,
    val reason: String,
)

/**
 * The central **PDP (Policy Decision Point)** gateway (build plan 4.3; doc 06 Part 2). Every
 * enforcement point — the generated-API PEP, the UI PEP, and the design-time artifact-access PEP —
 * calls *this one* gateway, which delegates the relationship check to the bound [PolicyEngine] and
 * **records a decision log for every call**. That single-gateway shape is what makes "design-time =
 * runtime, one PDP" true rather than aspirational (doc 06 §4.2, doc 13 §2.f): there is one decision
 * path, so no surface can drift from another.
 *
 * Deterministic (retry-forbidden, doc 13 §3.6): the `decisionId` is a content hash of the checked
 * `(principal, action, resource)` — no wall-clock or RNG — so a replay produces byte-identical logs.
 */
class Pdp(private val engine: PolicyEngine) {

    private val log = mutableListOf<DecisionLogEntry>()

    fun check(principal: String, action: String, resource: String, context: Map<String, Any?>): AuthzDecision {
        val decision = engine.check(principal, action, resource, context)
        log.add(
            DecisionLogEntry(
                decisionId = decisionId(principal, action, resource),
                principal = principal,
                action = action,
                resource = resource,
                context = context,
                effect = if (decision.allow) "allow" else "deny",
                reason = decision.reason,
            ),
        )
        return decision
    }

    fun decisionLog(): List<DecisionLogEntry> = log.toList()

    private fun decisionId(principal: String, action: String, resource: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$principal|$action|$resource".toByteArray())
        return "authz-" + digest.take(8).joinToString("") { "%02x".format(it) }
    }
}
