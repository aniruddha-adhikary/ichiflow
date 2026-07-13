/**
 * TypeScript view of the canonical Flow DSL (build plan 3.1). The authored source of record is
 * `schemas/flow.tsp` → the emitted `Flow.json` JSON Schema; these types mirror it so the interpreter
 * consumes DSL-validated documents. The step set is closed by design (doc 04 §2.3); Phase 3.1 ships
 * the two kinds the interpreter executes deterministically — `compute` and `timer`.
 */
export type ComputeOp = "double" | "inc" | "identity";

export interface ComputeStep {
  id: string;
  type: "compute";
  op: ComputeOp;
}

/** An SLA/timer step. Duration is in ms so the DSL stays parse-free and thus deterministic. */
export interface TimerStep {
  id: string;
  type: "timer";
  durationMs: number;
}

export type FlowStep = ComputeStep | TimerStep;

export interface Flow {
  id: string;
  schemaVersion: "flow/v1";
  input: { value: number };
  steps: FlowStep[];
}

/** A conformance vector — a DSL-valid Flow paired with the interpreter result it must produce. */
export interface FlowConformanceVector {
  name: string;
  flow: Flow;
  expect: { result: number; steps: number; slaMs: number };
}
