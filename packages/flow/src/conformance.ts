import { createRequire } from "node:module";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { activities } from "./activities.js";
import { assembleDecisionRecord } from "./decisionrecord.js";
import type { FlowConformanceVector, Vars } from "./dsl.js";
import type {
  CaseCorrelation,
  CaseEvent as InterpreterCaseEvent,
  TraceEntry,
} from "./interpreter.js";
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
  /** The Case's `case_id` (doc 04 §5.1) and its ordered Case/Task event-history types (§5.2). */
  caseId: string;
  events: string[];
  expectedEvents: string[] | null;
  eventsMatch: boolean;
  /** DecisionRecord completeness on the current flow sources (build plan 3.4, doc 13 §2.g) — every real vector stitches with no orphan. */
  chainComplete: boolean;
  orphans: string[];
  replays: ReplayOutcome[];
  replayClean: boolean;
  fastForwarded: boolean;
  /** True iff this flow exercises the `external-task` delegation step (build plan 5.2, doc 04 §2.8). */
  delegation: boolean;
  /** The correlation ids the interpreter injected on each `external-task` submit (doc 05 §11.1). */
  correlations: CaseCorrelation[];
  expectedCorrelations: CaseCorrelation[] | null;
  correlationsMatch: boolean;
}

export interface ConformanceResult {
  sdk: string;
  sdkVersion: string;
  vectors: VectorOutcome[];
  vectorsGreen: number;
  /** Delegation (`external-task`) vectors that hit their full oracle — the build plan 5.2 gate (`delegation_vectors_green == total`). */
  delegationVectorsGreen: number;
  delegationVectorsTotal: number;
  determinismClean: boolean;
}

interface WorkflowReturn {
  flowId: string;
  caseId: string;
  steps: number;
  vars: Vars;
  slaMs: number;
  trace: TraceEntry[];
  events: InterpreterCaseEvent[];
  correlations: CaseCorrelation[];
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

        // Deliver scripted `human-task` signals (resolve / pause / resume) and `external-task` correlated
        // replies at their declared offsets, merged on one timeline; time-skip advances the clock between
        // them so pausable-SLA windows and month-long budgets verify in ms. A stable sort keeps signals
        // before replies (and replies in authored order) at an equal offset, so dedup is deterministic.
        type Delivery = { afterMs: number; send: () => Promise<void> };
        const deliveries: Delivery[] = [
          ...(vector.signals ?? []).map((sig) => ({
            afterMs: sig.afterMs,
            send: () =>
              handle.signal("taskSignal", {
                stepId: sig.stepId,
                action: sig.action ?? "resolve",
                value: sig.value,
              }),
          })),
          ...(vector.replies ?? []).map((reply) => ({
            afterMs: reply.afterMs,
            send: () =>
              handle.signal("replySignal", {
                stepId: reply.stepId,
                correlationId: reply.correlationId,
                messageId: reply.messageId,
                value: reply.value,
                malformed: reply.malformed,
              }),
          })),
        ];
        let clock = 0;
        for (const delivery of [...deliveries].sort((a, b) => a.afterMs - b.afterMs)) {
          if (delivery.afterMs > clock) {
            await env.sleep(delivery.afterMs - clock);
            clock = delivery.afterMs;
          }
          await delivery.send();
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
        const events = ret.events.map((e) => e.type);
        const expectedEvents = vector.expect.events ?? null;
        const correlations = ret.correlations ?? [];
        const expectedCorrelations = vector.expect.correlations ?? null;
        const delegation = vector.flow.steps.some((s) => s.type === "external-task");
        // Assemble the per-Case DecisionRecord from the real interpreter output and run the orphan
        // detector — completeness on current sources (build plan 3.4 §2.c / doc 13 §2.g).
        const record = assembleDecisionRecord(ret);
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
          caseId: ret.caseId,
          events,
          expectedEvents,
          eventsMatch:
            expectedEvents === null ||
            (events.length === expectedEvents.length &&
              events.every((t, i) => t === expectedEvents[i])),
          chainComplete: record.chainComplete,
          orphans: record.orphans,
          replays,
          replayClean: replays.every((r) => r.ok),
          // No scheduled wait ⇒ nothing to fast-forward (trivially satisfied); otherwise require a 1000× collapse.
          fastForwarded: vector.expect.slaMs === 0 || wallMs < vector.expect.slaMs / 1000,
          delegation,
          correlations,
          expectedCorrelations,
          correlationsMatch:
            expectedCorrelations === null ||
            (correlations.length === expectedCorrelations.length &&
              correlations.every(
                (c, i) =>
                  c.stepId === expectedCorrelations[i]?.stepId &&
                  c.correlationId === expectedCorrelations[i]?.correlationId,
              )),
        });
      }
    });
  } finally {
    await env.teardown();
  }

  const isGreen = (o: VectorOutcome): boolean =>
    o.varsMatch &&
    o.stepsMatch &&
    o.slaMatch &&
    o.traceComplete &&
    o.eventsMatch &&
    o.correlationsMatch &&
    o.fastForwarded;

  return {
    sdk: "@temporalio",
    sdkVersion: SDK_VERSION,
    vectors: outcomes,
    vectorsGreen: outcomes.filter(isGreen).length,
    delegationVectorsGreen: outcomes.filter((o) => o.delegation && isGreen(o)).length,
    delegationVectorsTotal: outcomes.filter((o) => o.delegation).length,
    determinismClean: outcomes.every((o) => o.replayClean),
  };
}
