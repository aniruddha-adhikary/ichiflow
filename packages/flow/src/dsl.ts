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
  assignee?: string;
  slaMs: number;
  out: string;
  /** Written to `out` when the SLA fires before a resolution signal (escalation path). */
  onTimeout: number;
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

/** A scripted resolution signal delivered to a `human-task` step during interpretation (correlated by `stepId`). */
export interface FlowSignal {
  afterMs: number;
  stepId: string;
  value: number;
}

/** A conformance vector — a DSL-valid Flow (+ optional resolution signals) paired with the final blackboard it must produce. */
export interface FlowConformanceVector {
  name: string;
  flow: Flow;
  signals?: FlowSignal[];
  expect: { vars: Vars; steps: number; slaMs: number };
}
