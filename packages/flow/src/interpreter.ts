import { proxyActivities, sleep } from "@temporalio/workflow";
import type { Flow } from "./dsl.js";
import type { activities } from "./activities.js";

const { compute } = proxyActivities<typeof activities>({ startToCloseTimeout: "1 minute" });

export interface FlowResult {
  flowId: string;
  steps: number;
  result: number;
  slaMs: number;
}

/**
 * The generic flow interpreter — one workflow that executes *any* flow's ordered steps. `compute`
 * steps go through an activity (the boundary for non-deterministic/IO work); `sla` steps are Temporal
 * timers, which the test env fast-forwards. Because all wall-clock and IO are delegated, the workflow
 * body itself is pure and replays identically — the property Phase 3.0 exists to prove.
 */
export async function interpret(flow: Flow): Promise<FlowResult> {
  let value = flow.input.value;
  let slaMs = 0;
  for (const step of flow.steps) {
    if (step.type === "compute") {
      const { result } = await compute({ op: step.op, value });
      value = result;
    } else {
      await sleep(step.durationMs);
      slaMs += step.durationMs;
    }
  }
  return { flowId: flow.id, steps: flow.steps.length, result: value, slaMs };
}
