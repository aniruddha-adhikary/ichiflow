import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The canonical **authorization (PDP) slice** contracts (build plan 4.3; ADR-0010, ADR-0025, doc 06
 * Parts 2 & 4, doc 13 §2.f). v1 authz is **OpenFGA only** (ADR-0010): Teams, membership,
 * role-as-relation, and artifact/case ownership are expressed as an OpenFGA-style **ReBAC** model, and
 * the **same central PDP** answers both **design-time** ("may this principal edit/approve this
 * CodeSet/Schema/Decision/Flow") and **runtime** ("may this principal view/modify this Case row")
 * questions — one relation vocabulary, one decision path, one decision log (doc 06 §4.2). This schema
 * fixes the *shape* of that model, the relationship tuples, the allow/deny test vectors, and the
 * mandatory decision log; the engine binding (a deterministic in-memory OpenFGA-semantics evaluator in
 * the Kotlin core, swappable for a real OpenFGA server / Cedar-OPA later) sits behind the PDP facade.
 *
 * The load-bearing property the harness proves (doc 13 §2.f): **design-time = runtime, one vector
 * set** — the *same* PDP evaluates artifact-access and data-access checks, so a vector can never pass
 * one surface and fail the other. If the two enforcement points ever diverge, the "same PDP"
 * invariant is broken and parity fails.
 */
@jsonSchema
namespace Ichiflow.Authz;

/** The effect of an authorization decision — the PDP answers `allow` or `deny`. */
union AuthzEffect {
  allow: "allow",
  deny: "deny",
}

/**
 * Which enforcement surface a check exercises. The single PDP spans both: `design-time` is the
 * Workspace **artifact-access** path (the `artifact` object type — CodeSet/Schema/Decision/Flow),
 * `runtime` is the **data-access** path (the `case`/entity object types). Proving both surfaces are
 * covered by *one* vector set through *one* PDP is the parity claim (doc 06 §4.2, doc 13 §2.f).
 */
union AuthzSurface {
  designTime: "design-time",
  runtime: "runtime",
}

/**
 * Tuple-to-userset rewrite (`<relation> from <tupleset>`): expand `relation` on every object reached
 * from this object via the `tupleset` relation. E.g. `approver from owner` — follow the artifact's
 * `owner` tuples to the owning Team, then check `approver` there (doc 06 §4.3).
 */
model TupleToUserset {
  /** The relation to expand on each object the tupleset points at (e.g. `approver`). */
  relation: string;

  /** The relation on *this* object whose target objects are followed (e.g. `owner`). */
  tupleset: string;
}

/**
 * A userset-rewrite node — how a relation's user set is computed, matching OpenFGA check semantics.
 * Exactly one variant is set per node (`this` | `computedUserset` | `tupleToUserset` | `union`).
 */
model Rewrite {
  /**
   * Direct assignment (OpenFGA `this`): the relation is populated by stored tuples for it. The listed
   * strings are the allowed subject type refs (`user`, or a userset type like `team#member`),
   * documentary of what may be assigned; membership is decided by the tuples themselves.
   */
  direct?: string[];

  /** Computed userset: expand to another relation on the **same** object (`define X: otherRelation`). */
  computedUserset?: string;

  /** Tuple-to-userset: `<relation> from <tupleset>` (indirection through a related object). */
  tupleToUserset?: TupleToUserset;

  /** Union: the user set is the union of the child rewrites (OpenFGA `or`). */
  unionOf?: Rewrite[];
}

/** One relation on a type — its name and the rewrite that computes its user set. */
model RelationDef {
  name: string;
  rewrite: Rewrite;
}

/** One object type in the authorization model with its relations (e.g. `team`, `artifact`, `case`). */
model TypeDef {
  /** The object type name (the prefix before `:` in an object id, e.g. `artifact` in `artifact:x`). */
  type: string;

  relations: RelationDef[];
}

/**
 * The committed **OpenFGA-style authorization model** (doc 06 §4.3–4.4): the object types (organization,
 * team, artifact, case, association) and their relations (membership, role-as-relation, ownership,
 * derived `can_*`). One model governs design-time and runtime alike.
 */
model AuthzModel {
  /** OpenFGA model schema version marker (documentary, e.g. `1.1`). */
  schemaVersion: string;

  types: TypeDef[];
}

/**
 * One relationship tuple `(object, relation, user)` — a graph edge in the OpenFGA store. `user` is a
 * concrete subject (`user:alice`) **or** a userset (`team:trade#member`); `object` is a typed id
 * (`artifact:codeset-natures`). Tuple writes are write-through/CDC-driven in production (doc 06 §2.1);
 * here they are the committed graph fixtures the vectors evaluate against.
 */
model RelationTuple {
  /** The object the relation is on, `type:id` (e.g. `artifact:codeset-natures`). */
  object: string;

  /** The relation name (e.g. `owner`, `member`, `can_view`). */
  relation: string;

  /** The subject: a concrete `user:<id>` or a userset `<type>:<id>#<relation>`. */
  user: string;
}

/**
 * One committed **authz allow/deny vector** (doc 13 §2.f): a `{ subject, relation, object, context }`
 * question with its pinned `expect`ed effect, tagged with the enforcement `surface` it belongs to. The
 * same corpus spans `design-time` (artifact) and `runtime` (case/entity) so the harness can prove one
 * PDP answers both without drift.
 */
model AuthzVector {
  name: string;

  /** The enforcement surface this vector exercises (design-time artifact vs runtime data). */
  surface: AuthzSurface;

  /** The principal, `user:<id>`. */
  subject: string;

  /** The action being checked, expressed as a relation (`can_view`, `can_edit`, `can_approve`, …). */
  relation: string;

  /** The resource, `type:id`. */
  object: string;

  /** Optional attribute context (OpenFGA conditional relationships / future ABAC). */
  context?: Record<unknown>;

  /** The pinned expected decision. */
  expect: AuthzEffect;
}

/**
 * One **authorization decision-log** entry (doc 06 §2.4, ADR-0010) — mandatory for every PDP decision.
 * Feeds both compliance audit and the UI "why is this hidden" explanation surface, and joins the
 * DecisionRecord. The `reason` is the relation/rule path that granted access, or the denial reason.
 */
model AuthzDecisionLog {
  /** Stable decision id (deterministic, derived from the checked tuple — no wall-clock/RNG). */
  decisionId: string;

  /** The principal evaluated. */
  principal: string;

  /** The action (relation) checked. */
  action: string;

  /** The resource (`type:id`). */
  resource: string;

  /** The attribute context supplied to the decision. */
  context: Record<unknown>;

  effect: AuthzEffect;

  /** Human/machine-readable reason — the granting relation path, or why it was denied. */
  reason: string;
}
