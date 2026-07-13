import "@typespec/json-schema";
import "./flow.tsp";

using TypeSpec.JsonSchema;

/**
 * The canonical **DecisionRecord** (build plan 3.4; ADR-0011, doc 08 §1) — the first-class, typed
 * domain object keyed by the global `case_id` that stitches a Case's causal chain into one
 * post-hoc-reconstructable record: flow **event history** → fired-**Decision** traces → **Task**
 * resolutions → the final outcome. Phase 3.4 assembles it from the sources that exist *now* (the flow
 * interpreter's `events` + `trace`); its *completeness* harness is cross-phase (doc 13 §2.g),
 * tightening as adapters (Phase 5) and issuance add event kinds, and only reaching full green in the
 * operational spine (Phase 7). Assembly is a pure, deterministic projection of a `FlowResult` — no
 * wall-clock, no I/O — so the record and its orphan verdict replay identically.
 *
 * Its correctness is **completeness**: every recorded event stitches into the chain (no gap). The
 * **orphan-event detector** (doc 13 §2.g) flags any event that does not stitch — a Task-lifecycle
 * event with no originating `task.created`, or a `human-task` trace with no terminal resolution event.
 */
@jsonSchema
namespace Ichiflow.DecisionRecord;

/** One fired **Decision** stitched into the chain (doc 03 §2) — the `decision-eval` steps' typed Outcomes. */
model DecisionRecordDecision {
  /** The step id that fired this Decision (correlation key into the flow + trace). */
  stepId: string;

  /** The evaluated DecisionModel id. */
  decision: string;

  /** The Decision's typed Outcome type. */
  outcomeType: string;

  /** The Outcome's value facet written to the blackboard. */
  value: float64;
}

/** One **Task** resolution stitched into the chain (doc 04 §5.2) — a `human-task` outcome + attribution. */
model DecisionRecordTask {
  /** The `human-task` step id. */
  stepId: string;

  /** The routed assignee/queue (or escalation queue) attributed to the resolution. */
  assignee: string;

  /** How the Task settled — `resolved` by signal or `escalated` on SLA exhaustion. */
  resolution: Ichiflow.Flow.TaskResolution;

  /** The value written to the Task's `out` (the reviewer's outcome, or the `onTimeout` auto-decide). */
  value: float64;
}

/**
 * The assembled DecisionRecord for one Case — the stitched causal chain plus the orphan verdict that
 * proves its completeness (doc 13 §2.g: `orphans: [...]`, chain complete iff empty).
 */
model DecisionRecord {
  /** The Case's global `case_id` — the stitch key (ADR-0011). */
  caseId: string;

  /** The ordered flow **event history** the record is stitched from (doc 04 §5.1). */
  events: Ichiflow.Flow.CaseEvent[];

  /** The fired **Decision** traces (doc 03 §2). */
  decisions: DecisionRecordDecision[];

  /** The **Task** resolutions with attribution (doc 04 §5.2). */
  tasks: DecisionRecordTask[];

  /** The Case's final outcome — the terminal blackboard (variable name → value). */
  outcome: Record<float64>;

  /** Events that did **not** stitch into the chain (doc 13 §2.g). A complete chain has none. */
  orphans: string[];

  /** True iff the causal chain stitches end-to-end with no orphan (the completeness verdict). */
  chainComplete: boolean;
}

/**
 * One committed **DecisionRecord case fixture** (build plan 3.4, harness-first). Pairs a `FlowResult`
 * (the interpreter output — the assembly source) with the pinned assembled record the pure assembler
 * must produce, including the expected `orphans`. Negative fixtures inject a gap (a Task-lifecycle
 * event with no `task.created`, a `human-task` with no terminal event) to prove the detector flags it.
 */
model DecisionRecordCase {
  /** Human-readable case name; doubles as intent documentation. */
  name: string;

  /** The interpreter output the DecisionRecord is assembled from. */
  result: Ichiflow.Flow.FlowResult;

  expect: DecisionRecordExpectation;
}

/** The pinned expected observations of assembling a DecisionRecord case fixture. */
model DecisionRecordExpectation {
  /** Whether the causal chain must stitch end-to-end (a complete chain has no orphan). */
  chainComplete: boolean;

  /** The exact set of orphan-event descriptors the detector must report (order-insensitive). */
  orphans: string[];

  /** The expected number of stitched fired-Decision traces. */
  @minValue(0)
  decisions: int32;

  /** The expected number of stitched Task resolutions. */
  @minValue(0)
  tasks: int32;
}
