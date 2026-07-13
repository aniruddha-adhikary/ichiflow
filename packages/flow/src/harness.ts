import { createRequire } from "node:module";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";
import { activities, applyCompute } from "./activities.js";
import type { Flow } from "./dsl.js";

const require = createRequire(import.meta.url);
const SDK_VERSION: string = (require("@temporalio/worker/package.json") as { version: string })
  .version;

export interface ReplayOutcome {
  attempt: number;
  ok: boolean;
  error: string | null;
}

export interface SpikeResult {
  sdk: string;
  sdkVersion: string;
  flowId: string;
  steps: number;
  expected: number;
  result: number;
  resultCorrect: boolean;
  secondResult: number;
  resultsIdentical: boolean;
  replays: ReplayOutcome[];
  replayClean: boolean;
  historyEvents: number;
  sla: { scheduledMs: number; wallMs: number; fastForwarded: boolean };
}

/** Fold the pure compute reference over the flow to get the answer the interpreter must produce. */
function expectedResult(flow: Flow): number {
  let value = flow.input.value;
  for (const step of flow.steps) {
    if (step.type === "compute") value = applyCompute(step.op, value);
  }
  return value;
}

function scheduledSlaMs(flow: Flow): number {
  return flow.steps.reduce((ms, s) => (s.type === "sla" ? ms + s.durationMs : ms), 0);
}

/**
 * The Phase 3.0 determinism harness (the riskiest-bet proof, doc 14 §6). Runs the generic interpreter
 * over a flow on the time-skipping test env, then replays the recorded history twice: a clean replay
 * (no `DeterminismViolation`) is the durable-execution correctness property. A second independent
 * execution proves the result is a stable function of the input, and the month-long SLA timer
 * completing in ms proves timers fast-forward. All non-determinism (wall-clock, replay) is captured
 * into a verdict artifact so the verify scope stays a pure read.
 */
export async function runInterpreterSpike(opts: {
  workflowsPath: string;
  flow: Flow;
}): Promise<SpikeResult> {
  const { workflowsPath, flow } = opts;
  Runtime.install({ logger: new DefaultLogger("WARN") });
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "flow-spike",
      workflowsPath,
      activities,
    });

    const t0 = Date.now();
    const run = await worker.runUntil(async () => {
      const h1 = await env.client.workflow.start("interpret", {
        args: [flow],
        workflowId: `spike-${flow.id}-1`,
        taskQueue: "flow-spike",
      });
      const first = (await h1.result()) as { result: number };
      const history = await h1.fetchHistory();

      const h2 = await env.client.workflow.start("interpret", {
        args: [flow],
        workflowId: `spike-${flow.id}-2`,
        taskQueue: "flow-spike",
      });
      const second = (await h2.result()) as { result: number };
      return { first, second, history };
    });
    const wallMs = Date.now() - t0;

    const replays: ReplayOutcome[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await Worker.runReplayHistory({ workflowsPath }, run.history);
        replays.push({ attempt, ok: true, error: null });
      } catch (err) {
        replays.push({
          attempt,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const expected = expectedResult(flow);
    const scheduledMs = scheduledSlaMs(flow);
    return {
      sdk: "@temporalio",
      sdkVersion: SDK_VERSION,
      flowId: flow.id,
      steps: flow.steps.length,
      expected,
      result: run.first.result,
      resultCorrect: run.first.result === expected,
      secondResult: run.second.result,
      resultsIdentical: run.first.result === run.second.result,
      replays,
      replayClean: replays.every((r) => r.ok),
      historyEvents: run.history.events?.length ?? 0,
      sla: {
        scheduledMs,
        wallMs,
        // Time-skipping collapses a 30-day timer to ms; a 1000× margin is a robust, non-flaky verdict.
        fastForwarded: scheduledMs > 0 && wallMs < scheduledMs / 1000,
      },
    };
  } finally {
    await env.teardown();
  }
}
