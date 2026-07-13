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

/**
 * A **correlation family**: a class of Case events that must stitch back to an originating event of the
 * same family for the same `stepId`. The orphan detector runs the same two rules per family (doc 13
 * §2.g): every `lifecycle` event correlates to an `originated` event, and every `originated` event
 * reaches a `terminal` one. Keeping the families independent is what lets a `document.*` lifecycle event
 * only correlate to a `document.allocated` (never to a `task.created`), so a family's events never
 * cross-stitch. `originatedLabel`/`terminalLabel` shape the orphan descriptors the fixtures pin.
 */
interface CorrelationFamily {
  originated: Set<string>;
  lifecycle: Set<string>;
  terminal: Set<string>;
  originatedLabel: string;
  terminalLabel: string;
}

/**
 * The **Task + delegation** family (build plan 3.3 / 5.2). `human-task` originates `task.created`;
 * `external-task` (doc 04 §2.8) originates `external.submitted` and reuses the pausable-clock `sla.*`
 * events, adding the delegation lifecycle: `external.responded` / `external.deduped` (Idempotent
 * Receiver) / `external.dlq` + `case.flagged` (malformed → surfaced, not stuck) / `external.timeout` /
 * `external.escalated`. A submit always reaches a terminal `external.responded|escalated`.
 */
const TASK_FAMILY: CorrelationFamily = {
  originated: new Set(["task.created", "external.submitted"]),
  lifecycle: new Set([
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
  ]),
  terminal: new Set([
    "task.resolved",
    "task.escalated",
    "external.responded",
    "external.escalated",
  ]),
  originatedLabel: "task.created",
  terminalLabel: "terminal resolution",
};

/**
 * The **issuance** family (build plan 5.4 — issuance events stitched; doc 05 §issuance, doc 08 §5). An
 * `issue-document` step originates `document.allocated` (the number-allocation anchor) and runs the
 * lifecycle `document.issued` / `document.delivered` and — for the `offer` acceptance facet —
 * `document.accepted` / `document.declined`, plus the post-issue transitions `document.superseded` /
 * `document.revoked`. A `document.delivered` (emitted on every issue) or an accept/decline is terminal,
 * so an issued Document that never delivers or an accept with no allocation is an orphan.
 */
const ISSUANCE_FAMILY: CorrelationFamily = {
  originated: new Set(["document.allocated"]),
  lifecycle: new Set([
    "document.issued",
    "document.delivered",
    "document.accepted",
    "document.declined",
    "document.superseded",
    "document.revoked",
  ]),
  terminal: new Set(["document.delivered", "document.accepted", "document.declined"]),
  originatedLabel: "document.allocated",
  terminalLabel: "document delivery/decision",
};

/**
 * The **notification / adapter-call** family (build plan 5.4 — adapter-call events stitched; doc 05
 * §4.2). An outbound notification delivery (email/SMS over an Adapter, `packages/notifications`)
 * originates `notify.requested` and settles at `notify.sent` (delivered), `notify.deduped` (Idempotent
 * Receiver) or `notify.dlq` (quarantined after bounded attempts) — each a terminal disposition. A
 * delivery disposition with no originating request is an orphan.
 */
const NOTIFY_FAMILY: CorrelationFamily = {
  originated: new Set(["notify.requested"]),
  lifecycle: new Set(["notify.sent", "notify.deduped", "notify.dlq"]),
  terminal: new Set(["notify.sent", "notify.deduped", "notify.dlq"]),
  originatedLabel: "notify.requested",
  terminalLabel: "delivery disposition",
};

/** All correlation families the orphan detector stitches, in stitch order (doc 13 §2.g). */
const FAMILIES: CorrelationFamily[] = [TASK_FAMILY, ISSUANCE_FAMILY, NOTIFY_FAMILY];

/**
 * Assemble the per-Case DecisionRecord (build plan 3.4 / 5.4; ADR-0011, doc 13 §2.g) as a **pure,
 * deterministic** projection of a `FlowResult`: stitch the flow event history + fired-Decision traces
 * + Task resolutions, keyed by `case_id`, and run the **orphan-event detector** over every correlation
 * family (§`FAMILIES`). A chain is complete iff, for each family, every lifecycle event stitches back to
 * an originating event for the same step, and every originating event reaches a terminal one:
 *   - **Task + delegation** (3.3/5.2): a `task.assigned|sla.*|task.resolved|…|external.*` with no
 *     originating `task.created`/`external.submitted` is an orphan; a Task/submit with no terminal
 *     resolution is a dangling orphan.
 *   - **Issuance** (5.4): a `document.issued|delivered|accepted|declined|…` with no originating
 *     `document.allocated` is an orphan; an allocated Document that never reaches a
 *     delivery/accept/decline is a dangling orphan.
 *   - **Notification / adapter-call** (5.4): a `notify.sent|deduped|dlq` with no originating
 *     `notify.requested` is an orphan.
 * The completeness harness tightened here (build plan 5.4) to stitch adapter-call + issuance events; it
 * reaches full green in the operational spine (Phase 7, why-answer).
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
  for (const family of FAMILIES) {
    const originatedSteps = new Set(
      result.events.filter((e) => family.originated.has(e.type)).map((e) => e.stepId),
    );
    const terminalSteps = new Set(
      result.events.filter((e) => family.terminal.has(e.type)).map((e) => e.stepId),
    );

    for (const e of result.events) {
      if (
        family.lifecycle.has(e.type) &&
        (e.stepId === undefined || !originatedSteps.has(e.stepId))
      ) {
        orphans.push(
          `${e.type}@seq:${e.seq} for step ${e.stepId ?? "?"} has no originating ${family.originatedLabel}`,
        );
      }
    }
    for (const stepId of originatedSteps) {
      if (!terminalSteps.has(stepId)) {
        orphans.push(
          `${family.originatedLabel} for step ${stepId ?? "?"} has no ${family.terminalLabel}`,
        );
      }
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
