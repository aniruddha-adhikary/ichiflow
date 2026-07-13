import { createRequire } from "node:module";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { activities } from "./activities.js";
import type { FlowConformanceVector, Vars } from "./dsl.js";
import { ensureRuntime } from "./runtime.js";

const require = createRequire(import.meta.url);
const SDK_VERSION: string = (require("@temporalio/worker/package.json") as { version: string })
  .version;

interface TraceEntry {
  stepId: string;
  type: string;
}

export interface ReplayOutcome {
  attempt: number;
  ok: boolean;
  error: string | null;
}

export interface VectorOutcome {
  name: string;
  flowId: string;
  vars: Vars;
  expectedVars: Vars;
  varsMatch: boolean;
  expectedSteps: number;
  steps: number;
  stepsMatch: boolean;
  expectedSlaMs: number;
  slaMs: number;
  slaMatch: boolean;
  /** One typed trace entry per executed step (doc 04 §2.6) — proves every declared step ran, in order. */
  traceStepIds: string[];
  traceComplete: boolean;
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
  vars: Vars;
  slaMs: number;
  trace: TraceEntry[];
}

function shallowEqualVars(a: Vars, b: Vars): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => Object.is(a[k], b[k]));
}

/**
 * The flow-layer conformance harness (build plan 3.1–3.2 exit criterion). Runs the *same* generic
 * interpreter over every committed conformance vector on one time-skipping test env: it delivers each
 * vector's scripted resolution signals at their declared test-clock offsets (so `human-task` steps take
 * the resolve path) or lets the SLA fire (the escalation path), then checks the final blackboard, step
 * count, scheduled SLA, and a complete per-step trace against the vector's independently-pinned oracle,
 * and replays the history twice for determinism. One generic workflow satisfying every vector — no
 * per-flow code — is the whole layer's correctness claim (doc 04 §2).
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

        // Deliver scripted resolutions at their declared offsets; time-skip advances the clock between them.
        let clock = 0;
        for (const sig of [...(vector.signals ?? [])].sort((a, b) => a.afterMs - b.afterMs)) {
          if (sig.afterMs > clock) {
            await env.sleep(sig.afterMs - clock);
            clock = sig.afterMs;
          }
          await handle.signal("resolveTask", { stepId: sig.stepId, value: sig.value });
        }

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

        const traceStepIds = ret.trace.map((t) => t.stepId);
        outcomes.push({
          name: vector.name,
          flowId: vector.flow.id,
          vars: ret.vars,
          expectedVars: vector.expect.vars,
          varsMatch: shallowEqualVars(ret.vars, vector.expect.vars),
          expectedSteps: vector.expect.steps,
          steps: ret.steps,
          stepsMatch: ret.steps === vector.expect.steps,
          expectedSlaMs: vector.expect.slaMs,
          slaMs: ret.slaMs,
          slaMatch: ret.slaMs === vector.expect.slaMs,
          traceStepIds,
          traceComplete:
            traceStepIds.length === vector.flow.steps.length &&
            traceStepIds.every((id, i) => id === vector.flow.steps[i]?.id),
          replays,
          replayClean: replays.every((r) => r.ok),
          // No scheduled wait ⇒ nothing to fast-forward (trivially satisfied); otherwise require a 1000× collapse.
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
    vectorsGreen: outcomes.filter(
      (o) => o.varsMatch && o.stepsMatch && o.slaMatch && o.traceComplete && o.fastForwarded,
    ).length,
    determinismClean: outcomes.every((o) => o.replayClean),
  };
}
