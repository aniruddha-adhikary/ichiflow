/**
 * Minimal flow-JSON DSL for the Phase 3.0 determinism spike (ADR-0004). Deliberately tiny — the
 * canonical TypeSpec DSL schema and the full step set arrive in Phase 3.1/3.2. What matters here is
 * that a *generic* interpreter walks an ordered, declarative step list, so determinism is proven on
 * the interpretation pattern rather than a single hand-written workflow.
 */
export type ComputeOp = "double" | "inc" | "identity";

export interface ComputeStep {
  id: string;
  type: "compute";
  op: ComputeOp;
}

/** An SLA/timer step. Duration is expressed in ms so the interpreter stays parse-free and thus deterministic. */
export interface SlaStep {
  id: string;
  type: "sla";
  durationMs: number;
}

export type FlowStep = ComputeStep | SlaStep;

export interface Flow {
  id: string;
  input: { value: number };
  steps: FlowStep[];
}
