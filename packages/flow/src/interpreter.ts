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

const { compute, decisionEval, createTask, issueDocument, acceptDocument, submitExternalTask } =
  proxyActivities<typeof activities>({
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

/** Accept/decline (or pause/resume) an offer-type `issue-document`, correlated by step id. */
export const documentSignal =
  defineSignal<[{ stepId: string; action: "accept" | "decline" | "pause" | "resume" }]>(
    "documentSignal",
  );

/**
 * Deliver a **correlated inbound reply** to an `external-task` step (doc 04 §2.8, doc 05 §11.1) — the
 * machine analog of `taskSignal.resolve`, standing in for the mock external system's response (no live
 * system). The reply is buffered per step and routed by `correlationId` against the id the interpreter
 * injected on submit; `(correlationId, messageId)` is the Idempotent-Receiver dedup key. A `malformed`
 * reply is a schema-invalid response the delegation quarantines to the DLQ and surfaces on the Case.
 */
export const replySignal = defineSignal<
  [
    {
      stepId: string;
      correlationId: string;
      messageId: string;
      value?: number;
      malformed?: boolean;
    },
  ]
>("replySignal");

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
  referenceNumber?: string;
  documentStatus?: "issued" | "accepted" | "declined";
  verificationHash?: string;
}

/** A Case/Task event-history entry (doc 04 §5.1/§5.2) — the ordered facts the DecisionRecord will key by `case_id`. */
export interface CaseEvent {
  seq: number;
  type: string;
  stepId?: string;
  assignee?: string;
  referenceNumber?: string;
  documentStatus?: string;
  verificationHash?: string;
}

/** The correlation id injected onto one `external-task`'s outbound submit (doc 05 §11.1) — the key a reply must carry. */
export interface CaseCorrelation {
  stepId: string;
  correlationId: string;
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
  /** The correlation id injected on each `external-task` submit (doc 04 §2.8), in step order. */
  correlations: CaseCorrelation[];
}

/** One buffered inbound reply awaiting its `external-task` step. */
interface BufferedReply {
  correlationId: string;
  messageId: string;
  value?: number;
  malformed?: boolean;
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
 *   - `external-task` (§2.8) is the machine analog: submit through the outbound Adapter with an injected
 *     correlation id (§11.1), then race the *same* pausable SLA against a **correlated** inbound reply —
 *     dedupe duplicates on `(correlationId, messageId)`, DLQ + surface a malformed reply (never hang),
 *     resume on a valid reply, escalate on budget exhaustion;
 *   - `timer` is a durable wait the test env fast-forwards.
 * Every step appends a typed trace entry, and the Case/Task lifecycle appends ordered `events`.
 * `Date.now()` is Temporal's replay-safe workflow clock (not wall-clock), so pausable-SLA accounting
 * stays deterministic under replay and time-skip.
 */
export async function interpret(flow: Flow): Promise<FlowResult> {
  const vars: Vars = { ...flow.input.vars };
  const trace: TraceEntry[] = [];
  const events: CaseEvent[] = [];
  const correlations: CaseCorrelation[] = [];
  const caseId = workflowInfo().workflowId;
  let slaMs = 0;
  let seq = 0;
  const emit = (
    type: string,
    extra?: {
      stepId?: string;
      assignee?: string;
      referenceNumber?: string;
      documentStatus?: string;
      verificationHash?: string;
    },
  ): void => {
    events.push({ seq: seq++, type, ...extra });
  };

  // Buffer task signals by step id so early/late/duplicate deliveries correlate deterministically on replay.
  const resolved = new Map<string, number>();
  const paused = new Set<string>();
  const documentResolutions = new Map<string, "accept" | "decline">();
  setHandler(taskSignal, ({ stepId, action = "resolve", value }) => {
    if (action === "pause") paused.add(stepId);
    else if (action === "resume") paused.delete(stepId);
    else resolved.set(stepId, value ?? 0);
  });
  setHandler(documentSignal, ({ stepId, action }) => {
    if (action === "pause") paused.add(stepId);
    else if (action === "resume") paused.delete(stepId);
    else documentResolutions.set(stepId, action);
  });

  // Buffer external-task replies per step; the queue is drained in delivery order so dedup/DLQ is
  // deterministic under replay regardless of when the mock external system delivers them.
  const replyQueues = new Map<string, BufferedReply[]>();
  const pendingReplies = (stepId: string): boolean => (replyQueues.get(stepId)?.length ?? 0) > 0;
  setHandler(replySignal, ({ stepId, correlationId, messageId, value, malformed }) => {
    const q = replyQueues.get(stepId) ?? [];
    q.push({ correlationId, messageId, value, malformed });
    replyQueues.set(stepId, q);
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
      case "issue-document": {
        const snapshot = Object.fromEntries(
          Object.entries(step.binding).map(([field, variable]) => [field, vars[variable]!]),
        );
        const issued = await issueDocument({
          caseId,
          stepId: step.id,
          template: step.template,
          snapshot,
          numberAllocation: step.numberAllocation,
          acceptance: step.lifecycle.acceptance,
          delivery: step.delivery,
          issuedAt: new Date(Date.now()).toISOString(),
        });
        for (const type of issued.events) {
          emit(type, {
            stepId: step.id,
            referenceNumber: issued.referenceNumber,
            documentStatus: issued.status,
            verificationHash: issued.verificationHash,
          });
        }

        let documentStatus: "issued" | "accepted" | "declined" = "issued";
        if (step.lifecycle.acceptance === "offer") {
          const budget = step.lifecycle.slaMs ?? 0;
          let remaining = budget;
          slaMs += budget;
          for (;;) {
            if (documentResolutions.has(step.id)) break;
            if (paused.has(step.id)) {
              emit("sla.paused", { stepId: step.id });
              await condition(() => !paused.has(step.id) || documentResolutions.has(step.id));
              if (!documentResolutions.has(step.id)) emit("sla.resumed", { stepId: step.id });
              continue;
            }
            const startedAt = Date.now();
            const met = await condition(
              () => documentResolutions.has(step.id) || paused.has(step.id),
              remaining,
            );
            remaining = Math.max(0, remaining - (Date.now() - startedAt));
            if (!met) {
              documentResolutions.set(step.id, "decline");
              break;
            }
          }
          const resolution = documentResolutions.get(step.id)!;
          if (resolution === "accept") {
            await acceptDocument({ referenceNumber: issued.referenceNumber });
            documentStatus = "accepted";
            emit("document.accepted", {
              stepId: step.id,
              referenceNumber: issued.referenceNumber,
              documentStatus,
              verificationHash: issued.verificationHash,
            });
          } else {
            documentStatus = "declined";
            emit("document.declined", {
              stepId: step.id,
              referenceNumber: issued.referenceNumber,
              documentStatus,
              verificationHash: issued.verificationHash,
            });
          }
        }

        trace.push({
          stepId: step.id,
          type: step.type,
          referenceNumber: issued.referenceNumber,
          documentStatus,
          verificationHash: issued.verificationHash,
        });
        break;
      }
      case "external-task": {
        // §2.8 delegation — the machine analog of `human-task`: submit through the outbound Adapter,
        // inject a deterministic correlation id (§11.1), then await a correlated reply against the
        // *same* pausable SLA + escalation machinery (§5.7/§5.2), deduping on (correlationId, messageId).
        const provider = step.provider ?? "external";
        const correlationId = `${caseId}/${step.id}`;
        correlations.push({ stepId: step.id, correlationId });
        await submitExternalTask({
          stepId: step.id,
          requestRef: step.requestRef,
          correlationId,
          provider,
          args: read(step.in),
        });
        emit("external.submitted", { stepId: step.id, assignee: provider });

        const seen = new Set<string>(); // (correlationId '/' messageId) — Idempotent Receiver (§11.1)
        let responded: number | undefined;
        const drain = (): void => {
          const q = replyQueues.get(step.id) ?? [];
          while (q.length > 0) {
            const r = q.shift()!;
            // §11.1 correlation contract — a reply correlates only when it carries the injected id.
            if (r.correlationId !== correlationId) {
              emit("external.dlq", { stepId: step.id });
              emit("case.flagged", { stepId: step.id });
              continue;
            }
            const dedupKey = `${r.correlationId}/${r.messageId}`;
            if (seen.has(dedupKey)) {
              emit("external.deduped", { stepId: step.id }); // duplicate correlated reply — deduped once
              continue;
            }
            seen.add(dedupKey);
            if (r.malformed) {
              // schema-invalid reply → DLQ + Case surfacing, never a stuck flow (§2.8 taxonomy).
              emit("external.dlq", { stepId: step.id });
              emit("case.flagged", { stepId: step.id });
              continue;
            }
            if (responded === undefined) {
              responded = r.value ?? 0;
              emit("external.responded", { stepId: step.id });
            } else {
              // single mode — the response already resolved; a further distinct reply is deduped.
              emit("external.deduped", { stepId: step.id });
            }
          }
          replyQueues.set(step.id, q);
        };

        let remaining = step.slaMs;
        let escalated = false;
        for (;;) {
          // §5.7 — while the pausable clock is stopped (`awaiting-applicant`) the delegation neither
          // consumes replies nor burns budget; drain only runs on an active clock, so a reply buffered
          // during the pause is applied deterministically on resume (not raced in ahead of the pause).
          if (paused.has(step.id)) {
            emit("sla.paused", { stepId: step.id });
            await condition(() => !paused.has(step.id));
            emit("sla.resumed", { stepId: step.id });
            continue;
          }
          drain();
          if (responded !== undefined) break;
          // §5.7 pausable SLA — race the correlated reply (or a pause) against the remaining budget
          // (mirrors the `human-task` await-signal loop). `condition` cancels the budget timer when a
          // reply arrives first; on budget exhaustion it fires → escalation.
          const startedAt = Date.now();
          const met = await condition(
            () => pendingReplies(step.id) || paused.has(step.id),
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
          emit("external.timeout", { stepId: step.id });
          emit("external.escalated", { stepId: step.id, assignee: escQueue });
          trace.push({
            stepId: step.id,
            type: step.type,
            out: step.out,
            value: step.onTimeout,
            resolution: "escalated",
            assignee: escQueue,
          });
        } else {
          // Resolving cancels the pending budget timer; yield one instant tick so that cancellation
          // settles in its own workflow task and never shares an activation with a subsequent workflow
          // completion (the SDK's timer state machine rejects cancel-and-complete in one activation).
          // The escalation path needs no such tick — there the budget timer *fires*, which is terminal.
          // Time-skip collapses the tick to 0ms, and it is not counted against the SLA budget.
          await sleep(1);
          vars[step.out] = responded!;
          trace.push({
            stepId: step.id,
            type: step.type,
            out: step.out,
            value: responded!,
            resolution: "resolved",
            assignee: provider,
          });
        }
        break;
      }
    }
  }

  emit("case.resolved");

  return {
    flowId: flow.id,
    caseId,
    steps: flow.steps.length,
    vars,
    slaMs,
    trace,
    events,
    correlations,
  };
}
