/**
 * TypeScript view of the canonical Flow DSL (build plan 3.1–3.2). The authored source of record is
 * `schemas/flow.tsp` → the emitted `Flow.json` JSON Schema; these types mirror it so the interpreter
 * consumes DSL-validated documents. The interpreter carries a named-variable **blackboard**; each step
 * reads `in` vars and writes its `out` var (doc 04 §2). The step set is closed by design (doc 04 §2.3).
 */
export type Vars = Record<string, number>;

export interface ComputeStep {
  id: string;
  type: "compute";
  /** Versioned code-activity ref `<lang>://<module>/<Name>@<semver>` (doc 04 §2.6). */
  ref: string;
  in: string[];
  out: string;
}

export interface DecisionEvalStep {
  id: string;
  type: "decision-eval";
  decision: string;
  in: string[];
  out: string;
}

export interface HumanTaskStep {
  id: string;
  type: "human-task";
  /** Static assignee/queue; fallback when no `assignmentDecision` routes the Task (doc 04 §5.3). */
  assignee?: string;
  /** DecisionModel routing the assignee/queue — assignment-as-Decision (§5.3). */
  assignmentDecision?: string;
  /** Blackboard vars fed, in order, to the assignment Decision. */
  assignIn?: string[];
  /** Pausable SLA budget (ms); paused intervals are excluded from accounting (§5.7). */
  slaMs: number;
  out: string;
  /** Auto-decide fallback written to `out` when the SLA budget is exhausted (escalation, §5.2). */
  onTimeout: number;
  /** Supervisor queue the Task escalates to on SLA expiry; defaults to `supervisor` (§5.2). */
  escalationQueue?: string;
}

export interface TimerStep {
  id: string;
  type: "timer";
  durationMs: number;
}

export type FlowStep = ComputeStep | DecisionEvalStep | HumanTaskStep | TimerStep;

export interface Flow {
  id: string;
  schemaVersion: "flow/v1";
  input: { vars: Vars };
  steps: FlowStep[];
}

/** What a scripted signal does to a `human-task` step (doc 04 §5.2/§5.7). */
export type SignalAction = "resolve" | "pause" | "resume";

/** A scripted signal delivered to a `human-task` step during interpretation (correlated by `stepId`). */
export interface FlowSignal {
  afterMs: number;
  stepId: string;
  /** `resolve` (default), or `pause`/`resume` the pausable SLA clock (§5.7). */
  action?: SignalAction;
  /** Resolution value (required for `resolve`; ignored for pause/resume). */
  value?: number;
}

/** A conformance vector — a DSL-valid Flow (+ optional signals) paired with the observations it must produce. */
export interface FlowConformanceVector {
  name: string;
  flow: Flow;
  signals?: FlowSignal[];
  /** `events` optionally pins the Case/Task event-history type sequence (§5.1/§5.2). */
  expect: { vars: Vars; steps: number; slaMs: number; events?: string[] };
}
