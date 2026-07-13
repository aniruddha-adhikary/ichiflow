package ai.ichiflow.core.authz.engine

import ai.ichiflow.core.authz.spi.AuthzDecision
import ai.ichiflow.core.authz.spi.PolicyEngine

/** A tuple-to-userset rewrite: `<relation> from <tupleset>` (indirection through a related object). */
data class TupleToUserset(val relation: String, val tupleset: String)

/** A userset-rewrite node (OpenFGA check semantics). Exactly one variant is populated. */
data class Rewrite(
    val direct: List<String>? = null,
    val computedUserset: String? = null,
    val tupleToUserset: TupleToUserset? = null,
    val unionOf: List<Rewrite>? = null,
)

/** One relation on a type and the rewrite that computes its user set. */
data class RelationDef(val name: String, val rewrite: Rewrite)

/** One object type and its relations. */
data class TypeDef(val type: String, val relations: List<RelationDef>)

/** The OpenFGA-style authorization model (types → relations → rewrites). */
data class AuthzModel(val schemaVersion: String, val types: List<TypeDef>)

/** One relationship tuple `(object, relation, user)` — a graph edge. */
data class RelationTuple(val obj: String, val relation: String, val user: String)

/**
 * The v1 reference **PolicyEngine** binding (build plan 4.3; ADR-0010): a deterministic in-memory
 * evaluator implementing OpenFGA's userset-rewrite check semantics — direct assignment, computed
 * userset, tuple-to-userset, and union — over a fixed model + relationship graph. It is the ReBAC
 * backbone v1 runs on (relationships, multi-tenancy, transitive membership, row-level access); a real
 * OpenFGA server or a Cedar/OPA engine binds the same [PolicyEngine] SPI later (doc 06 §2.1).
 *
 * Fully deterministic (retry-forbidden, doc 13 §3.6): tuples are evaluated in a stable sort order, a
 * visited-set breaks relationship cycles, and there is no wall-clock or RNG. Given the same model +
 * graph, `check` is a pure function of its arguments.
 */
class InMemoryOpenFgaEngine(
    private val model: AuthzModel,
    tuples: List<RelationTuple>,
) : PolicyEngine {

    // Stable evaluation order → deterministic reason paths (doc 13 §3.6).
    private val byObjectRelation: Map<Pair<String, String>, List<RelationTuple>> =
        tuples.sortedWith(compareBy({ it.obj }, { it.relation }, { it.user }))
            .groupBy { it.obj to it.relation }

    override fun check(subject: String, relation: String, obj: String, context: Map<String, Any?>): AuthzDecision {
        val reason = member(subject, relation, obj, HashSet())
        return if (reason != null) {
            AuthzDecision(allow = true, reason = reason)
        } else {
            AuthzDecision(allow = false, reason = "no relation path grants $relation on $obj to $subject")
        }
    }

    /** Returns the granting relation path if [subject] is in `(obj, relation)`'s user set, else null. */
    private fun member(subject: String, relation: String, obj: String, visited: MutableSet<String>): String? {
        val key = "$obj#$relation@$subject"
        if (!visited.add(key)) return null
        val type = obj.substringBefore(":")
        val def = model.types.firstOrNull { it.type == type }
            ?.relations?.firstOrNull { it.name == relation }
            ?: return null
        return evalRewrite(def.rewrite, subject, relation, obj, visited)
    }

    private fun evalRewrite(
        rw: Rewrite,
        subject: String,
        relation: String,
        obj: String,
        visited: MutableSet<String>,
    ): String? = evalDirect(rw, subject, relation, obj, visited)
        ?: evalComputed(rw, subject, relation, obj, visited)
        ?: evalTupleToUserset(rw, subject, relation, obj, visited)
        ?: evalUnion(rw, subject, relation, obj, visited)

    private fun evalDirect(
        rw: Rewrite,
        subject: String,
        relation: String,
        obj: String,
        visited: MutableSet<String>,
    ): String? {
        if (rw.direct == null) return null
        for (t in tuplesFor(obj, relation)) {
            if (t.user == subject) return "$obj#$relation ⇐ $subject"
            if (!t.user.contains('#')) continue
            val sub = member(subject, t.user.substringAfter('#'), t.user.substringBefore('#'), visited)
            if (sub != null) return "$obj#$relation ⇐ ${t.user} · $sub"
        }
        return null
    }

    private fun evalComputed(
        rw: Rewrite,
        subject: String,
        relation: String,
        obj: String,
        visited: MutableSet<String>,
    ): String? {
        val other = rw.computedUserset ?: return null
        val sub = member(subject, other, obj, visited) ?: return null
        return "$obj#$relation = $other · $sub"
    }

    private fun evalTupleToUserset(
        rw: Rewrite,
        subject: String,
        relation: String,
        obj: String,
        visited: MutableSet<String>,
    ): String? {
        val ttu = rw.tupleToUserset ?: return null
        for (t in tuplesFor(obj, ttu.tupleset)) {
            val sub = member(subject, ttu.relation, t.user, visited) ?: continue
            return "$obj#$relation = ${ttu.relation} from ${ttu.tupleset} → ${t.user} · $sub"
        }
        return null
    }

    private fun evalUnion(
        rw: Rewrite,
        subject: String,
        relation: String,
        obj: String,
        visited: MutableSet<String>,
    ): String? {
        val children = rw.unionOf ?: return null
        for (child in children) {
            val sub = evalRewrite(child, subject, relation, obj, visited)
            if (sub != null) return sub
        }
        return null
    }

    private fun tuplesFor(obj: String, relation: String): List<RelationTuple> =
        byObjectRelation[obj to relation] ?: emptyList()
}
