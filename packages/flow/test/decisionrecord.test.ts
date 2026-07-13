import { describe, expect, it } from "vitest";
import { assembleDecisionRecord } from "../src/decisionrecord.js";
import type { FlowResult } from "../src/interpreter.js";

/**
 * The DecisionRecord assembler (build plan 3.4; ADR-0011, doc 13 §2.g) is a pure projection of a
 * FlowResult — unit-testable with no Temporal. These assert the stitch (decisions + tasks keyed by
 * case_id) and the orphan-event detector on the current Phase-3 sources.
 */
describe("Phase 3.4 — DecisionRecord assembly + orphan detector", () => {
  const base: FlowResult = {
    flowId: "f",
    caseId: "c-1",
    steps: 2,
    vars: { gate: 1, signoff: 5 },
    slaMs: 0,
    trace: [
      {
        stepId: "s1",
        type: "decision-eval",
        decision: "threshold-approval",
        out: "gate",
        value: 1,
        outcomeType: "APPROVE",
      },
      {
        stepId: "s2",
        type: "human-task",
        out: "signoff",
        value: 5,
        resolution: "resolved",
        assignee: "ops-queue",
      },
    ],
    events: [
      { seq: 0, type: "case.created" },
      { seq: 1, type: "task.created", stepId: "s2" },
      { seq: 2, type: "task.assigned", stepId: "s2", assignee: "ops-queue" },
      { seq: 3, type: "task.resolved", stepId: "s2" },
      { seq: 4, type: "case.resolved" },
    ],
  };

  it("stitches a gap-free chain keyed by case_id (decisions + tasks + outcome, no orphans)", () => {
    const r = assembleDecisionRecord(base);
    expect(r.caseId).toBe("c-1");
    expect(r.chainComplete).toBe(true);
    expect(r.orphans).toEqual([]);
    expect(r.decisions).toEqual([
      { stepId: "s1", decision: "threshold-approval", outcomeType: "APPROVE", value: 1 },
    ]);
    expect(r.tasks).toEqual([
      { stepId: "s2", assignee: "ops-queue", resolution: "resolved", value: 5 },
    ]);
    expect(r.outcome).toEqual({ gate: 1, signoff: 5 });
  });

  it("flags a Task-lifecycle event with no originating task.created as an orphan", () => {
    const r = assembleDecisionRecord({
      ...base,
      events: [
        { seq: 0, type: "case.created" },
        { seq: 1, type: "task.resolved", stepId: "ghost" },
        { seq: 2, type: "case.resolved" },
      ],
    });
    expect(r.chainComplete).toBe(false);
    expect(r.orphans).toContain(
      "task.resolved@seq:1 for step ghost has no originating task.created",
    );
  });

  it("flags a task.created with no terminal resolution as a dangling Task", () => {
    const r = assembleDecisionRecord({
      ...base,
      events: [
        { seq: 0, type: "case.created" },
        { seq: 1, type: "task.created", stepId: "pending" },
        { seq: 2, type: "case.resolved" },
      ],
    });
    expect(r.chainComplete).toBe(false);
    expect(r.orphans).toContain("task.created for step pending has no terminal resolution");
  });
});
