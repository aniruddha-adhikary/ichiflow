import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runConformance, type ConformanceResult } from "../src/conformance.js";
import { loadVectors } from "../src/vectors.js";

const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), "../src/interpreter.ts");

describe("Phase 3.2–3.3 — flow-layer conformance (core step types + Case/Task)", () => {
  let result: ConformanceResult;

  it("interprets every committed conformance vector on the time-skipping test env", async () => {
    result = await runConformance({ workflowsPath, vectors: loadVectors() });
    expect(result.vectors.length).toBeGreaterThanOrEqual(9);
  }, 120_000);

  it("hits each vector's pinned oracle (blackboard, steps, SLA, trace, events, fast-forward)", () => {
    for (const v of result.vectors) {
      expect(v.varsMatch, `${v.flowId} vars`).toBe(true);
      expect(v.stepsMatch, `${v.flowId} steps`).toBe(true);
      expect(v.slaMatch, `${v.flowId} slaMs`).toBe(true);
      expect(v.traceComplete, `${v.flowId} trace`).toBe(true);
      expect(v.eventsMatch, `${v.flowId} events`).toBe(true);
      expect(v.caseId.length, `${v.flowId} case_id`).toBeGreaterThan(0);
      expect(v.fastForwarded, `${v.flowId} fast-forward`).toBe(true);
    }
    expect(result.vectorsGreen).toBe(result.vectors.length);
  });

  it("covers decision-eval, human-task resolve/escalate, and Case/Task (assignment, pausable SLA, escalation)", () => {
    const ids = result.vectors.map((v) => v.flowId);
    for (const id of [
      "decision-approve",
      "decision-decline",
      "human-task-resolved",
      "human-task-escalated",
      "mixed-full",
      "case-assignment",
      "case-pausable-sla",
      "case-escalation",
    ]) {
      expect(ids, `vector ${id} present`).toContain(id);
    }
  });

  it("pins the Case/Task event history for the pausable-SLA scenario (§5.7 clock-stop)", () => {
    const pausable = result.vectors.find((v) => v.flowId === "case-pausable-sla")!;
    expect(pausable.events).toEqual([
      "case.created",
      "task.created",
      "task.assigned",
      "sla.paused",
      "sla.resumed",
      "task.resolved",
      "case.resolved",
    ]);
  });

  it("assembles a complete DecisionRecord with no orphan for every real vector (3.4, doc 13 §2.g)", () => {
    for (const v of result.vectors) {
      expect(v.chainComplete, `${v.flowId} chain`).toBe(true);
      expect(v.orphans, `${v.flowId} orphans`).toEqual([]);
    }
  });

  it("replays every vector's history twice with no determinism violation", () => {
    expect(result.determinismClean).toBe(true);
    for (const v of result.vectors) expect(v.replays.map((r) => r.ok)).toEqual([true, true]);
  });
});
