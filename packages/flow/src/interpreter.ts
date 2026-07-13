import { condition, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow";
import type { Flow, Vars } from "./dsl.js";
import type { activities } from "./activities.js";

const { compute, decisionEval, createTask } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

/** Resolve a pending `human-task`, correlated by step id (doc 04 §5.2 await-signal). */
export const resolveTaskSignal = defineSignal<[{ stepId: string; value: number }]>("resolveTask");

/** A typed trace entry per executed step — the audit-spine material the DecisionRecord stitches (doc 04 §2.6). */
export interface TraceEntry {
  stepId: string;
  type: string;
  out?: string;
  value?: number;
  ref?: string;
  decision?: string;
  outcomeType?: string;
  resolution?: "resolved" | "escalated";
  durationMs?: number;
}

export interface FlowResult {
  flowId: string;
  steps: number;
  vars: Vars;
  slaMs: number;
  trace: TraceEntry[];
}

/**
 * The generic flow interpreter — one workflow that executes *any* flow's ordered steps over a
 * named-variable blackboard (doc 04 §2). All non-determinism is delegated to activities or Temporal
 * primitives, so the workflow body is pure and replays identically (Phase 3.0's property):
 *   - `compute` / `decision-eval` dispatch to activities (the boundary), reading `in` vars, writing `out`;
 *   - `human-task` races an await-signal against an SLA timer — resolve on signal, escalate on timeout;
 *   - `timer` is a durable wait the test env fast-forwards.
 * Every step appends a typed trace entry.
 */
export async function interpret(flow: Flow): Promise<FlowResult> {
  const vars: Vars = { ...flow.input.vars };
  const trace: TraceEntry[] = [];
  let slaMs = 0;

  // Buffer resolution signals by step id so an early/late signal correlates deterministically on replay.
  const resolved = new Map<string, number>();
  setHandler(resolveTaskSignal, ({ stepId, value }) => {
    resolved.set(stepId, value);
  });

  const read = (names: string[]): number[] => names.map((n) => vars[n]!);

  for (const step of flow.steps) {
    switch (step.type) {
      case "compute": {
        const { result } = await compute({ ref: step.ref, args: read(step.in) });
        vars[step.out] = result;
        trace.push({
          stepId: step.id,
          type: step.type,
          ref: step.ref,
          out: step.out,
          value: result,
        });
        break;
      }
      case "decision-eval": {
        const outcome = await decisionEval({ decision: step.decision, args: read(step.in) });
        vars[step.out] = outcome.value;
        trace.push({
          stepId: step.id,
          type: step.type,
          decision: step.decision,
          out: step.out,
          value: outcome.value,
          outcomeType: outcome.outcomeType,
        });
        break;
      }
      case "human-task": {
        await createTask({ stepId: step.id, assignee: step.assignee });
        const signalled = await condition(() => resolved.has(step.id), step.slaMs);
        const resolution = signalled ? "resolved" : "escalated";
        const value = signalled ? resolved.get(step.id)! : step.onTimeout;
        if (!signalled) slaMs += step.slaMs;
        vars[step.out] = value;
        trace.push({ stepId: step.id, type: step.type, out: step.out, value, resolution });
        break;
      }
      case "timer": {
        await sleep(step.durationMs);
        slaMs += step.durationMs;
        trace.push({ stepId: step.id, type: step.type, durationMs: step.durationMs });
        break;
      }
    }
  }

  return { flowId: flow.id, steps: flow.steps.length, vars, slaMs, trace };
}
