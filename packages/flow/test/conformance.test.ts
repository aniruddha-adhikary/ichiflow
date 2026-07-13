import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runConformance, type ConformanceResult } from "../src/conformance.js";
import { loadVectors } from "../src/vectors.js";

const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), "../src/interpreter.ts");

describe("Phase 3.1 — flow-layer conformance", () => {
  let result: ConformanceResult;

  it("interprets every committed conformance vector on the time-skipping test env", async () => {
    result = await runConformance({ workflowsPath, vectors: loadVectors() });
    expect(result.vectors.length).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it("hits each vector's pinned oracle (result, steps, SLA, fast-forward)", () => {
    for (const v of result.vectors) {
      expect(v.correct, `${v.flowId} result`).toBe(true);
      expect(v.stepsMatch, `${v.flowId} steps`).toBe(true);
      expect(v.slaMatch, `${v.flowId} slaMs`).toBe(true);
      expect(v.fastForwarded, `${v.flowId} fast-forward`).toBe(true);
    }
    expect(result.vectorsGreen).toBe(result.vectors.length);
  });

  it("replays every vector's history twice with no determinism violation", () => {
    expect(result.determinismClean).toBe(true);
    for (const v of result.vectors) expect(v.replays.map((r) => r.ok)).toEqual([true, true]);
  });
});
