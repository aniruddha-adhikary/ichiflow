import type { Flow } from "../dsl.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Phase 3.0 toy flow: compute → 30-day SLA timer → compute. The month-long timer is the whole
 * point — under the time-skipping test env it must fast-forward to milliseconds, and the two compute
 * steps around it make the interpreted result a deterministic function of the input (21·2 + 1 = 43).
 */
export const toy3Step: Flow = {
  id: "toy-3step",
  input: { value: 21 },
  steps: [
    { id: "s1", type: "compute", op: "double" },
    { id: "s2", type: "sla", durationMs: 30 * DAY_MS },
    { id: "s3", type: "compute", op: "inc" },
  ],
};
