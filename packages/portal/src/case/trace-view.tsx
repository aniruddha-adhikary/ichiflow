import type { JSX } from "react";
import type { DecisionRecord } from "@ichiflow/flow/dist/decisionrecord.js";

/**
 * The **decision-trace view** (doc 07 §5). Renders the assembled `DecisionRecord` from packages/flow
 * (ADR-0011): the ordered event history plus the stitched Decisions and Task resolutions, and the
 * chain-complete / orphan verdict that proves the trace is whole (doc 13 §2.g). Read-only audit spine.
 */

/** Stable node ids the harness asserts against — one per event, fired Decision, and Task resolution. */
export function traceNodeIds(record: DecisionRecord): string[] {
  return [
    ...record.events.map((e) => `event:${e.seq}:${e.type}`),
    ...record.decisions.map((d) => `decision:${d.stepId}`),
    ...record.tasks.map((t) => `task:${t.stepId}`),
  ];
}

export interface TraceViewProps {
  record: DecisionRecord;
}

export function TraceView(props: TraceViewProps): JSX.Element {
  const { record } = props;
  return (
    <section data-testid="decision-trace" data-case-id={record.caseId}>
      <h3>Decision trace — {record.caseId}</h3>
      <span data-testid="chain-complete" data-chain-complete={record.chainComplete}>
        {record.chainComplete ? "chain complete" : `orphans: ${record.orphans.join(", ")}`}
      </span>
      <ol data-testid="trace-nodes">
        {record.events.map((e) => (
          <li
            key={`event:${e.seq}`}
            data-trace-node={`event:${e.seq}:${e.type}`}
            data-node-kind="event"
          >
            {e.type}
            {e.stepId ? ` · ${e.stepId}` : ""}
          </li>
        ))}
        {record.decisions.map((d) => (
          <li
            key={`decision:${d.stepId}`}
            data-trace-node={`decision:${d.stepId}`}
            data-node-kind="decision"
          >
            {d.decision} → {d.outcomeType} ({d.value})
          </li>
        ))}
        {record.tasks.map((t) => (
          <li key={`task:${t.stepId}`} data-trace-node={`task:${t.stepId}`} data-node-kind="task">
            {t.stepId}: {t.resolution} by {t.assignee} ({t.value})
          </li>
        ))}
      </ol>
    </section>
  );
}
