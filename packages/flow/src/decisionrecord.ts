import type { CaseEvent, FlowResult, TraceEntry } from "./interpreter.js";

/** A fired Decision stitched into the chain (doc 03 §2) — the `decision-eval` steps' typed Outcomes. */
export interface DecisionRecordDecision {
  stepId: string;
  decision: string;
  outcomeType: string;
  value: number;
}

/** A Task resolution stitched into the chain (doc 04 §5.2) — a `human-task` / `external-task` outcome + attribution. */
export interface DecisionRecordTask {
  stepId: string;
  assignee: string;
  resolution: "resolved" | "escalated";
  value: number;
}

/**
 * The assembled DecisionRecord for one Case (ADR-0011, doc 08 §1): the stitched causal chain plus the
 * orphan verdict that proves its completeness.
 */
export interface DecisionRecord {
  caseId: string;
  events: CaseEvent[];
  decisions: DecisionRecordDecision[];
  tasks: DecisionRecordTask[];
  outcome: Record<string, number>;
  orphans: string[];
  chainComplete: boolean;
}

/** Events that originate a Task/delegation — the anchor a lifecycle event must correlate back to. */
const TASK_ORIGINATED = new Set(["task.created", "external.submitted"]);
/**
 * Lifecycle events (other than an originating event) that must correlate to an originating Task/delegation.
 * `external-task` (doc 04 §2.8) reuses the pausable-clock `sla.*` events and adds the delegation lifecycle:
 * `external.responded` / `external.deduped` (Idempotent Receiver) / `external.dlq` + `case.flagged`
 * (malformed → surfaced, not stuck) / `external.timeout` / `external.escalated`.
 */
const TASK_LIFECYCLE = new Set([
  "task.assigned",
  "sla.paused",
  "sla.resumed",
  "task.resolved",
  "task.escalated",
  "external.responded",
  "external.deduped",
  "external.dlq",
  "case.flagged",
  "external.timeout",
  "external.escalated",
]);
const TASK_TERMINAL = new Set([
  "task.resolved",
  "task.escalated",
  "external.responded",
  "external.escalated",
]);

/**
 * Assemble the per-Case DecisionRecord (build plan 3.4; ADR-0011, doc 13 §2.g) as a **pure,
 * deterministic** projection of a `FlowResult`: stitch the flow event history + fired-Decision traces
 * + Task resolutions, keyed by `case_id`, and run the **orphan-event detector**. On the current
 * Phase-3 sources a chain is complete iff:
 *   - every Task-lifecycle event (`task.assigned` / `sla.*` / `task.resolved|escalated`) has an
 *     originating `task.created` for the same step (a "signal with no originating Task" is an orphan);
 *   - every `task.created` reaches a terminal `task.resolved|escalated` (a dangling Task is an orphan).
 * The completeness harness tightens cross-phase as new event kinds (adapters, issuance) come online.
 */
export function assembleDecisionRecord(result: FlowResult): DecisionRecord {
  const decisions: DecisionRecordDecision[] = [];
  const tasks: DecisionRecordTask[] = [];

  for (const t of result.trace as TraceEntry[]) {
    if (t.type === "decision-eval") {
      decisions.push({
        stepId: t.stepId,
        decision: t.decision ?? "",
        outcomeType: t.outcomeType ?? "",
        value: t.value ?? 0,
      });
    } else if (t.type === "human-task" || t.type === "external-task") {
      tasks.push({
        stepId: t.stepId,
        assignee: t.assignee ?? "unassigned",
        resolution: t.resolution ?? "resolved",
        value: t.value ?? 0,
      });
    }
  }

  const orphans: string[] = [];
  const createdSteps = new Set(
    result.events.filter((e) => TASK_ORIGINATED.has(e.type)).map((e) => e.stepId),
  );
  const terminalSteps = new Set(
    result.events.filter((e) => TASK_TERMINAL.has(e.type)).map((e) => e.stepId),
  );

  for (const e of result.events) {
    if (TASK_LIFECYCLE.has(e.type) && (e.stepId === undefined || !createdSteps.has(e.stepId))) {
      orphans.push(
        `${e.type}@seq:${e.seq} for step ${e.stepId ?? "?"} has no originating task.created`,
      );
    }
  }
  for (const stepId of createdSteps) {
    if (!terminalSteps.has(stepId)) {
      orphans.push(`task.created for step ${stepId ?? "?"} has no terminal resolution`);
    }
  }

  return {
    caseId: result.caseId,
    events: result.events,
    decisions,
    tasks,
    outcome: result.vars,
    orphans,
    chainComplete: orphans.length === 0,
  };
}
