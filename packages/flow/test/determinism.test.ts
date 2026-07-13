import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toy3Step, TOY_RESULT_VAR } from "../src/flows/toy-3step.js";
import { runInterpreterSpike, type SpikeResult } from "../src/harness.js";

// The worker bundles the TypeScript workflow source directly (Temporal ships swc), so the test runs
// against src without a prior build step.
const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), "../src/interpreter.ts");

describe("Phase 3.0 — interpreter determinism spike", () => {
  let spike: SpikeResult;

  it("runs the generic interpreter over the toy 3-step flow on the time-skipping test env", async () => {
    spike = await runInterpreterSpike({ workflowsPath, flow: toy3Step, resultVar: TOY_RESULT_VAR });
    expect(spike.historyEvents).toBeGreaterThan(0);
  }, 120_000);

  it("computes the deterministic result (21·2 + 1 = 43)", () => {
    expect(spike.result).toBe(43);
    expect(spike.resultCorrect).toBe(true);
  });

  it("produces an identical result on an independent second execution", () => {
    expect(spike.resultsIdentical).toBe(true);
    expect(spike.secondResult).toBe(spike.result);
  });

  it("replays the recorded history twice with no determinism violation", () => {
    expect(spike.replayClean).toBe(true);
    expect(spike.replays.map((r) => r.ok)).toEqual([true, true]);
  });

  it("fast-forwards the 30-day SLA timer under time-skip", () => {
    expect(spike.sla.scheduledMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(spike.sla.fastForwarded).toBe(true);
  });
});
