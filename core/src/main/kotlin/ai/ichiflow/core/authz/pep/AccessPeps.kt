package ai.ichiflow.core.authz.pep

import ai.ichiflow.core.authz.Pdp
import ai.ichiflow.core.authz.spi.AuthzDecision

/**
 * The **design-time** Policy Enforcement Point — guards Workspace **artifact** access ("may this
 * principal edit/approve this CodeSet / Schema / Decision / Flow", doc 06 §4.2). It is deliberately
 * thin: it holds *no* authorization logic of its own and delegates every decision to the shared [Pdp].
 */
class ArtifactAccessPep(private val pdp: Pdp) {
    fun mayAccess(
        principal: String,
        relation: String,
        artifact: String,
        context: Map<String, Any?> = emptyMap(),
    ): AuthzDecision = pdp.check(principal, relation, artifact, context)
}

/**
 * The **runtime** Policy Enforcement Point — guards data access on Cases / Tasks / entity rows ("may
 * this principal view/modify this Case row"). Like [ArtifactAccessPep] it carries no logic and routes
 * through the *same* [Pdp]. Two thin PEPs over one PDP is the concrete realization of the "one decision
 * source, no drift" invariant (doc 06 §4.2): design-time and runtime cannot disagree because they share
 * the decision path.
 */
class RuntimeAccessPep(private val pdp: Pdp) {
    fun mayAccess(
        principal: String,
        relation: String,
        resource: String,
        context: Map<String, Any?> = emptyMap(),
    ): AuthzDecision = pdp.check(principal, relation, resource, context)
}
