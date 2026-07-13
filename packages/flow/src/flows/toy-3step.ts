import type { Flow } from "../dsl.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Phase 3.0 toy flow: compute → 30-day SLA timer → compute. The month-long timer is the whole
 * point — under the time-skipping test env it must fast-forward to milliseconds, and the two compute
 * steps around it make the interpreted result a deterministic function of the input (21·2 + 1 = 43).
 */
export const toy3Step: Flow = {
  id: "toy-3step",
  schemaVersion: "flow/v1",
  input: { vars: { x: 21 } },
  steps: [
    { id: "s1", type: "compute", ref: "ts://flow-kit/Double@1.0.0", in: ["x"], out: "x" },
    { id: "s2", type: "timer", durationMs: 30 * DAY_MS },
    { id: "s3", type: "compute", ref: "ts://flow-kit/Increment@1.0.0", in: ["x"], out: "x" },
  ],
};

/** The blackboard variable the toy's result is read from (21·2 + 1 = 43). */
export const TOY_RESULT_VAR = "x";
