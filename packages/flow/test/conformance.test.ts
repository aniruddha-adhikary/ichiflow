import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runConformance, type ConformanceResult } from "../src/conformance.js";
import { loadVectors } from "../src/vectors.js";

const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), "../src/interpreter.ts");

describe("Phase 3.2 — flow-layer conformance (core step types)", () => {
  let result: ConformanceResult;

  it("interprets every committed conformance vector on the time-skipping test env", async () => {
    result = await runConformance({ workflowsPath, vectors: loadVectors() });
    expect(result.vectors.length).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it("hits each vector's pinned oracle (blackboard, steps, SLA, trace, fast-forward)", () => {
    for (const v of result.vectors) {
      expect(v.varsMatch, `${v.flowId} vars`).toBe(true);
      expect(v.stepsMatch, `${v.flowId} steps`).toBe(true);
      expect(v.slaMatch, `${v.flowId} slaMs`).toBe(true);
      expect(v.traceComplete, `${v.flowId} trace`).toBe(true);
      expect(v.fastForwarded, `${v.flowId} fast-forward`).toBe(true);
    }
    expect(result.vectorsGreen).toBe(result.vectors.length);
  });

  it("covers decision-eval (both branches) and human-task (resolve + escalate)", () => {
    const ids = result.vectors.map((v) => v.flowId);
    for (const id of [
      "decision-approve",
      "decision-decline",
      "human-task-resolved",
      "human-task-escalated",
      "mixed-full",
    ]) {
      expect(ids, `vector ${id} present`).toContain(id);
    }
  });

  it("replays every vector's history twice with no determinism violation", () => {
    expect(result.determinismClean).toBe(true);
    for (const v of result.vectors) expect(v.replays.map((r) => r.ok)).toEqual([true, true]);
  });
});
