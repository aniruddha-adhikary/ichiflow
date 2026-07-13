import { describe, expect, it } from "vitest";
import { CODE_ACTIVITIES, runCodeActivity, runDecision } from "../src/activities.js";

/**
 * The unified code-activity contract (doc 04 §2.6) is unit-testable in isolation — no Temporal, no
 * flow. These assert the boundary the `compute` step depends on: versioned-ref dispatch, purity
 * (same input → same output, no observable side effect), and rejection of unknown refs / non-finite I/O.
 */
describe("Phase 3.2 — code-activity contract (purity + boundary)", () => {
  it("dispatches on the versioned ref and is pure (deterministic, side-effect-free)", () => {
    expect(runCodeActivity("ts://flow-kit/Double@1.0.0", [21])).toBe(42);
    expect(runCodeActivity("ts://flow-kit/Double@1.0.0", [21])).toBe(42);
    expect(runCodeActivity("ts://flow-kit/Sum@1.0.0", [1, 2, 3])).toBe(6);
  });

  it("rejects an unknown ref rather than silently no-op'ing", () => {
    expect(() => runCodeActivity("ts://flow-kit/Missing@9.9.9", [1])).toThrow(
      /unknown code-activity ref/,
    );
  });

  it("rejects non-finite input and output at the boundary", () => {
    expect(() => runCodeActivity("ts://flow-kit/Double@1.0.0", [Number.NaN])).toThrow(
      /non-finite input/,
    );
    expect(() => runCodeActivity("ts://flow-kit/Double@1.0.0", [Number.POSITIVE_INFINITY])).toThrow(
      /non-finite/,
    );
  });

  it("keys every registered activity by a versioned <lang>://<module>/<Name>@<semver> ref", () => {
    const re = /^(kt|ts|py):\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9]+\.[0-9]+\.[0-9]+$/;
    for (const ref of Object.keys(CODE_ACTIVITIES)) expect(ref, ref).toMatch(re);
  });

  it("evaluates decisions to a typed outcome on both threshold branches", () => {
    expect(runDecision("threshold-approval", [75])).toEqual({ outcomeType: "APPROVE", value: 1 });
    expect(runDecision("threshold-approval", [10])).toEqual({ outcomeType: "DECLINE", value: 0 });
    expect(() => runDecision("nope", [1])).toThrow(/unknown decision/);
  });

  it("routes a human-task assignee as a Decision — the outcome IS the queue (§5.3)", () => {
    // "assignment routing is itself a Decision": the outcomeType a human-task's assignmentDecision
    // yields is the routed assignee/queue the interpreter records on task.assigned.
    expect(runDecision("assignment-by-amount", [1500]).outcomeType).toBe("underwriting-tier2");
    expect(runDecision("assignment-by-amount", [200]).outcomeType).toBe("underwriting-tier1");
  });
});
