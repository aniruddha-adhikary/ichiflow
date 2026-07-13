import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import type { Flow, Vars } from "./dsl.js";
import type { activities } from "./activities.js";

const { compute, decisionEval, createTask } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

/**
 * Act on a `human-task`, correlated by step id (doc 04 §5.2 await-signal, §5.7 pausable clock):
 *   - `resolve` writes `value` to the Task's `out` and completes it;
 *   - `pause` / `resume` stop and restart the pausable SLA clock (`awaiting-applicant`).
 * Handlers are idempotent so retried/duplicate deliveries settle once.
 */
export const taskSignal =
  defineSignal<[{ stepId: string; action?: "resolve" | "pause" | "resume"; value?: number }]>(
    "taskSignal",
  );

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
  assignee?: string;
}

/** A Case/Task event-history entry (doc 04 §5.1/§5.2) — the ordered facts the DecisionRecord will key by `case_id`. */
export interface CaseEvent {
  seq: number;
  type: string;
  stepId?: string;
  assignee?: string;
}

export interface FlowResult {
  flowId: string;
  /** The Case's global `case_id` (doc 04 §5.1) — here the durable Temporal workflow id. */
  caseId: string;
  steps: number;
  vars: Vars;
  slaMs: number;
  trace: TraceEntry[];
  /** The Case/Task event history in order (doc 04 §5.1). */
  events: CaseEvent[];
}

/**
 * The generic flow interpreter — one workflow that executes *any* flow's ordered steps over a
 * named-variable blackboard (doc 04 §2), wrapped by the first-party Case/Task module (doc 04 §5). All
 * non-determinism is delegated to activities or Temporal primitives, so the workflow body is pure and
 * replays identically (Phase 3.0's property):
 *   - `compute` / `decision-eval` dispatch to activities (the boundary), reading `in` vars, writing `out`;
 *   - `human-task` creates a Task whose assignee is *routed by a Decision* (§5.3), then races an
 *     await-signal against a **pausable** SLA timer (§5.7) — resolve on signal, escalate on budget
 *     exhaustion to a supervisor queue (§5.2);
 *   - `timer` is a durable wait the test env fast-forwards.
 * Every step appends a typed trace entry, and the Case/Task lifecycle appends ordered `events`.
 * `Date.now()` is Temporal's replay-safe workflow clock (not wall-clock), so pausable-SLA accounting
 * stays deterministic under replay and time-skip.
 */
export async function interpret(flow: Flow): Promise<FlowResult> {
  const vars: Vars = { ...flow.input.vars };
  const trace: TraceEntry[] = [];
  const events: CaseEvent[] = [];
  const caseId = workflowInfo().workflowId;
  let slaMs = 0;
  let seq = 0;
  const emit = (type: string, extra?: { stepId?: string; assignee?: string }): void => {
    events.push({ seq: seq++, type, ...extra });
  };

  // Buffer task signals by step id so early/late/duplicate deliveries correlate deterministically on replay.
  const resolved = new Map<string, number>();
  const paused = new Set<string>();
  setHandler(taskSignal, ({ stepId, action = "resolve", value }) => {
    if (action === "pause") paused.add(stepId);
    else if (action === "resume") paused.delete(stepId);
    else resolved.set(stepId, value ?? 0);
  });

  const read = (names: string[]): number[] => names.map((n) => vars[n]!);

  emit("case.created");

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
        // §5.3 — assignment routing is itself a Decision; else fall back to the static label.
        let assignee = step.assignee ?? "unassigned";
        if (step.assignmentDecision) {
          const routed = await decisionEval({
            decision: step.assignmentDecision,
            args: read(step.assignIn ?? []),
          });
          assignee = routed.outcomeType;
        }
        await createTask({ stepId: step.id, assignee });
        emit("task.created", { stepId: step.id });
        emit("task.assigned", { stepId: step.id, assignee });

        // §5.7 — pausable SLA: consume the budget only while the clock runs; a `pause` signal
        // (awaiting-applicant) stops it and `resume` restarts it, excluding the paused interval.
        let remaining = step.slaMs;
        let escalated = false;
        for (;;) {
          if (resolved.has(step.id)) break;
          if (paused.has(step.id)) {
            emit("sla.paused", { stepId: step.id });
            await condition(() => !paused.has(step.id) || resolved.has(step.id));
            if (!resolved.has(step.id)) emit("sla.resumed", { stepId: step.id });
            continue;
          }
          const startedAt = Date.now();
          const met = await condition(
            () => resolved.has(step.id) || paused.has(step.id),
            remaining,
          );
          remaining = Math.max(0, remaining - (Date.now() - startedAt));
          if (!met) {
            escalated = true;
            break;
          }
        }

        if (escalated) {
          slaMs += step.slaMs;
          const escQueue = step.escalationQueue ?? "supervisor";
          vars[step.out] = step.onTimeout;
          emit("task.escalated", { stepId: step.id, assignee: escQueue });
          trace.push({
            stepId: step.id,
            type: step.type,
            out: step.out,
            value: step.onTimeout,
            resolution: "escalated",
            assignee: escQueue,
          });
        } else {
          const value = resolved.get(step.id)!;
          vars[step.out] = value;
          emit("task.resolved", { stepId: step.id });
          trace.push({
            stepId: step.id,
            type: step.type,
            out: step.out,
            value,
            resolution: "resolved",
            assignee,
          });
        }
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

  emit("case.resolved");

  return { flowId: flow.id, caseId, steps: flow.steps.length, vars, slaMs, trace, events };
}
