import type { JSX } from "react";
import type { Pdp } from "../pdp/engine.js";
import type { Task } from "../types.js";

/**
 * The back-office **Task inbox** (doc 07 §5/§7). Rows are (1) **PDP-filtered** — a Task shows only if
 * the principal holds `can_view` on its Case, per the SAME relation model as the `authz` slice — and
 * (2) **SLA-ordered**, soonest-due first. `dueAtMs` is a seeded integer; ordering is a pure sort with
 * a `taskId` tiebreak, so it never depends on a live clock (determinism, doc 13 §3.6).
 */

/** The PDP-filtered, SLA-ordered rows a principal sees — the single source of inbox truth. */
export function inboxRows(pdp: Pdp, principal: string, tasks: readonly Task[]): Task[] {
  return tasks
    .filter((t) => pdp.check(principal, "can_view", t.caseId))
    .sort((a, b) => a.dueAtMs - b.dueAtMs || a.taskId.localeCompare(b.taskId));
}

export interface InboxProps {
  principal: string;
  rows: Task[];
  selectedTaskId?: string;
}

export function Inbox(props: InboxProps): JSX.Element {
  const { principal, rows, selectedTaskId } = props;
  return (
    <section data-testid="inbox" data-principal={principal}>
      <h2>Task inbox — {principal}</h2>
      <ol data-testid="inbox-rows">
        {rows.map((t) => (
          <li
            key={t.taskId}
            data-testid={`inbox-row-${t.taskId}`}
            data-task-id={t.taskId}
            data-case-id={t.caseId}
            data-due-at-ms={t.dueAtMs}
            aria-current={t.taskId === selectedTaskId ? "true" : undefined}
          >
            <span className="task-due">{t.dueAtMs}</span>
            <span className="task-title">{t.title}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
