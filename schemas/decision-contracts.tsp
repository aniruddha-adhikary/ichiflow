import "@typespec/json-schema";
import "./reference-data.tsp";

using TypeSpec.JsonSchema;
using Ichiflow.ReferenceData;

/**
 * Canonical decision contracts (build plan 2.3; doc 02 §9.3, doc 03 §7). A Decision result is richer
 * than approve/deny: ichiflow canonicalises a first-class **`Outcome`** (and its `CompositeOutcome`
 * composition, its attached `Condition`s, and the first-class `scoreBreakdown`/`feeBreakdown` facets)
 * so every Decision output, outbound decision event, Portal, and the DecisionRecord speak one shape.
 *
 * Every `evaluate` also emits a typed **`DecisionTrace`** (doc 03 §7) — fired decisions, the input
 * snapshot, intermediate values, outputs + reasons, reference-data provenance, authority attribution,
 * and model identity. **The DecisionRecord / why API depends on this shape**, so it is *frozen here*
 * (build plan 2.3, §2.1): the `decision-layer` trace-shape harness asserts every emitted trace
 * validates against it.
 */
@jsonSchema
namespace Ichiflow.Decision;

/**
 * The typed result kind of a Decision. The reserved canonical types are closed-vocabulary and
 * understood by every consumer; a domain needing a new kind declares it under an `x-<org>/<type>`
 * extension namespace (BRIEF §21, doc 02 §9.3) — enumerable, never an ad-hoc string. Unknown types
 * roll up as `refer`-equivalent (never silently `approve`).
 */
union OutcomeType {
  approve: "approve",
  deny: "deny",
  refer: "refer",
  conditionalApprove: "conditional-approve",
  partial: "partial",

  /** A declared `x-<org>/<type>` extension outcome kind. */
  extension: string,
}

/** Declared composition policy over N authority Outcomes (doc 02 §9.3, doc 03 §2.3). */
union CompositionPolicy {
  allMustApprove: "all-must-approve",
  anyBlocks: "any-blocks",
  quorum: "quorum",
  weighted: "weighted",
}

/** One line of a points-based tally — first-class contract, not an audit-time reconstruction (§9.3). */
model ScoreLine {
  /** The scored criterion. */
  criterion: string;

  /** Points awarded for this criterion. */
  points: float64;

  /** Optional band/label the points fall into. */
  band?: string;

  /** CodeRef into the governed rationale/criterion CodeSet. */
  whyRef?: CodeRef;
}

/** One itemized fee/duty component — first-class contract that travels as data (§9.3). */
model FeeLine {
  /** The fee component (duty, GST, processing fee, …). */
  component: string;

  /** The base amount the rate applies to. */
  base: float64;

  /** CodeRef into the governed rate table used (§2.2, §9.4). */
  rateRef: CodeRef;

  /** The computed amount for this component. */
  amount: float64;
}

/** Behavioural class of a Condition (doc 04 §5.5; the CodeSet `kind` column, §9.1). */
union ConditionKind {
  blocking: "blocking",
  postApprovalObligation: "post-approval-obligation",
  informational: "informational",
}

/** Individually-stateful Condition lifecycle (doc 04 §5.5). */
union ConditionState {
  pending: "pending",
  satisfied: "satisfied",
  breached: "breached",
  waived: "waived",
}

/**
 * An attached, individually-stateful condition on an Outcome (doc 04 §5.5). Its shape is frozen here
 * as a canonical `$ref`-able contract; its lifecycle transitions live with the Case layer that owns it.
 */
model Condition {
  /** The governed condition code (into a `conditions`/`obligations` CodeSet). */
  code: CodeRef;

  kind: ConditionKind;

  state: ConditionState;

  /** ISO-8601 retention duration for post-approval-obligation conditions (e.g. `P5Y`). */
  retainFor?: string;
}

/**
 * The typed result of a Decision (doc 02 §9.3). Every Decision output and outbound decision event
 * references this instead of ad-hoc `{outcome, reasonCodes}` pairs. `scoreBreakdown`/`feeBreakdown`
 * are optional first-class facets, so a plain approve/deny Outcome carries neither.
 */
model Outcome {
  type: OutcomeType;

  /** Machine-readable reasons drawn from governed CodeSets. */
  reasons: CodeRef[];

  /** Attached, individually-stateful conditions (doc 04 §5.5). */
  conditions: Condition[];

  /** Set when this Outcome is a member of a CompositeOutcome — its originating authority. */
  authority?: string;

  /** Itemized per-criterion points tally (points-based decisions). */
  scoreBreakdown?: ScoreLine[];

  /** Itemized fee/duty breakdown (fee-computing decisions). */
  feeBreakdown?: FeeLine[];
}

/**
 * N independent authority Outcomes composed into one result (doc 02 §9.3, doc 03 §2.3). Each member
 * stays attributed to its originating authority; an unrecognised member type rolls up as `refer`.
 */
model CompositeOutcome {
  policy: CompositionPolicy;

  /** One per authority; each attributed via `Outcome.authority`. */
  members: Outcome[];

  /** Rolled-up result computed from `policy` over `members`. */
  rolledUp: OutcomeType;
}

/** One DMN decision that evaluated during a trace (doc 03 §7). */
model FiredDecision {
  /** DMN decision id, when the engine exposes it. */
  decisionId?: string;

  /** DMN decision name. */
  decisionName: string;

  /** The decision's evaluated result. */
  result?: unknown;

  /** False when the decision produced an evaluation error. */
  succeeded: boolean;
}

/** Reference-data provenance for one fired decision: which CodeSet@version and which rows it read (§7). */
model ReferenceDataProvenance {
  /** The fired decision that read the reference data. */
  decisionName: string;

  /** The CodeSet as `id@version`. */
  codeSet: string;

  /** The specific reason/condition/rate row `code`s selected. */
  rows: string[];
}

/** DecisionModel identity + engine/capability set that produced a trace (doc 03 §7). */
model ModelIdentity {
  /** DecisionModel id (v1: the loaded DMN model name). */
  id: string;

  /** DecisionModel semver, when governed. */
  version?: string;

  /** Effective window of the released model version. */
  effective?: EffectiveWindow;

  /** The engine that evaluated the model (e.g. `drools`). */
  engine: string;

  /** The pinned engine version (e.g. `10.2.0`). */
  engineVersion: string;

  /** The engine capability set exercised (e.g. `feel`, `decisionTable`, `businessKnowledgeModel`). */
  capabilities: string[];
}

/**
 * The typed evaluation trace every `evaluate` emits (doc 03 §7) — not a log line, a typed domain
 * object. It flows into the per-Case DecisionRecord and the why API, so this shape is **frozen**:
 * the `decision-layer` trace-shape harness validates every emitted trace against it.
 */
model DecisionTrace {
  `model`: ModelIdentity;

  /** The exact inputs the decision saw, as-of evaluation time. */
  inputSnapshot: Record<unknown>;

  /** Which decisions evaluated, in what order. */
  firedDecisions: FiredDecision[];

  /** Outputs of upstream DRD decisions and named FEEL sub-expressions. */
  intermediateValues: Record<unknown>;

  /** The final decision outputs (the leaf decisions' results). */
  outputs: Record<unknown>;

  /** Per-fired-decision CodeSet id+version + selected rows. */
  referenceData: ReferenceDataProvenance[];

  /** Member-outcome → emitting authority, carried through composite decisions. */
  authorityAttribution: Record<string>;

  /** True when any fired decision produced an evaluation error. */
  hasErrors: boolean;

  /** Engine-surfaced messages (errors/warnings) for the evaluation. */
  messages: string[];
}
