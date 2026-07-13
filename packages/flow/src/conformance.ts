import { createRequire } from "node:module";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { activities } from "./activities.js";
import type { FlowConformanceVector } from "./dsl.js";
import { ensureRuntime } from "./runtime.js";

const require = createRequire(import.meta.url);
const SDK_VERSION: string = (require("@temporalio/worker/package.json") as { version: string })
  .version;

export interface ReplayOutcome {
  attempt: number;
  ok: boolean;
  error: string | null;
}

export interface VectorOutcome {
  name: string;
  flowId: string;
  expected: number;
  result: number;
  correct: boolean;
  expectedSteps: number;
  steps: number;
  stepsMatch: boolean;
  expectedSlaMs: number;
  slaMs: number;
  slaMatch: boolean;
  replays: ReplayOutcome[];
  replayClean: boolean;
  fastForwarded: boolean;
}

export interface ConformanceResult {
  sdk: string;
  sdkVersion: string;
  vectors: VectorOutcome[];
  vectorsGreen: number;
  determinismClean: boolean;
}

interface WorkflowReturn {
  flowId: string;
  steps: number;
  result: number;
  slaMs: number;
}

/**
 * The Phase 3.1 conformance harness (build plan 3.1 exit criterion). Runs the *same* generic
 * interpreter over every committed conformance vector on one time-skipping test env, checking each
 * against its independently-pinned oracle (`expect`) and replaying its history twice for determinism.
 * A single generic workflow satisfying every vector — no per-flow code — is the whole layer's
 * correctness claim (doc 04 §2). All timing non-determinism is captured here so the verify scope
 * stays a pure read of the verdict artifact.
 */
export async function runConformance(opts: {
  workflowsPath: string;
  vectors: FlowConformanceVector[];
}): Promise<ConformanceResult> {
  const { workflowsPath, vectors } = opts;
  ensureRuntime();
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const outcomes: VectorOutcome[] = [];
  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "flow-conformance",
      workflowsPath,
      activities,
    });

    await worker.runUntil(async () => {
      for (const vector of vectors) {
        const t0 = Date.now();
        const handle = await env.client.workflow.start("interpret", {
          args: [vector.flow],
          workflowId: `conformance-${vector.flow.id}`,
          taskQueue: "flow-conformance",
        });
        const ret = (await handle.result()) as WorkflowReturn;
        const wallMs = Date.now() - t0;
        const history = await handle.fetchHistory();

        const replays: ReplayOutcome[] = [];
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await Worker.runReplayHistory({ workflowsPath }, history);
            replays.push({ attempt, ok: true, error: null });
          } catch (err) {
            replays.push({
              attempt,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        outcomes.push({
          name: vector.name,
          flowId: vector.flow.id,
          expected: vector.expect.result,
          result: ret.result,
          correct: ret.result === vector.expect.result,
          expectedSteps: vector.expect.steps,
          steps: ret.steps,
          stepsMatch: ret.steps === vector.expect.steps,
          expectedSlaMs: vector.expect.slaMs,
          slaMs: ret.slaMs,
          slaMatch: ret.slaMs === vector.expect.slaMs,
          replays,
          replayClean: replays.every((r) => r.ok),
          // No timer ⇒ nothing to fast-forward (trivially satisfied); otherwise require a 1000× collapse.
          fastForwarded: vector.expect.slaMs === 0 || wallMs < vector.expect.slaMs / 1000,
        });
      }
    });
  } finally {
    await env.teardown();
  }

  return {
    sdk: "@temporalio",
    sdkVersion: SDK_VERSION,
    vectors: outcomes,
    vectorsGreen: outcomes.filter((o) => o.correct && o.stepsMatch && o.slaMatch && o.fastForwarded)
      .length,
    determinismClean: outcomes.every((o) => o.replayClean),
  };
}
