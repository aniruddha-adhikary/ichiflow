package ai.ichiflow.core.authz.spi

/**
 * The engine-neutral **Policy Engine SPI** (build plan 4.3; ADR-0010). The central PDP calls a
 * `PolicyEngine` to answer `(subject, relation, object, context)` → allow/deny; v1 binds the
 * OpenFGA-style ReBAC reference engine, and Cedar/OPA ABAC can later bind the *same* interface without
 * touching the PDP or the PEPs (doc 06 §2.1 — "adding Cedar/OPA later is a `PolicyEngine` SPI binding,
 * not a re-architecture"). The contract stays free of any concrete engine type.
 */
interface PolicyEngine {
    /**
     * Decide whether [subject] holds [relation] on [obj] under the bound model + relationship graph.
     * [context] carries attribute facts (OpenFGA conditional relationships / future ABAC); unused by
     * the v1 pure-ReBAC binding but part of the stable contract.
     */
    fun check(subject: String, relation: String, obj: String, context: Map<String, Any?>): AuthzDecision
}

/**
 * The engine's answer: the effect plus an explainable [reason] — the relation path that granted access,
 * or why it was denied. The reason feeds the mandatory decision log (doc 06 §2.4) and the UI "why is
 * this hidden" surface.
 */
data class AuthzDecision(val allow: Boolean, val reason: String)
