import type { JSX } from "react";
import type { DecisionRecord } from "@ichiflow/flow/dist/decisionrecord.js";
import type { CaseRecord, FieldEntitlement } from "../types.js";
import { ActionForm, type ActionFormProps, type FlowSignalPayload } from "./action-form.js";
import { ObligationChecklist } from "./obligations.js";
import { TraceView } from "./trace-view.js";

/**
 * The Case / **review view** (doc 07 §5): decision trace + action form (which signals the Flow, not a
 * direct mutation) + obligation checklist, with field render states driven by the PDP (doc 07 §6/§11).
 */

export interface CaseViewProps {
  caseRecord: CaseRecord;
  record: DecisionRecord;
  schema: Record<string, unknown>;
  uischema: Record<string, unknown>;
  entitlements: FieldEntitlement[];
  initialData: Record<string, unknown>;
  onSignal: (signal: FlowSignalPayload) => void;
}

export function CaseView(props: CaseViewProps): JSX.Element {
  const { caseRecord, record, schema, uischema, entitlements, initialData, onSignal } = props;
  const formProps: ActionFormProps = {
    schema,
    uischema,
    caseRecord,
    entitlements,
    initialData,
    onSignal,
  };
  return (
    <main data-testid="case-view" data-case-id={caseRecord.caseId}>
      <h1>{caseRecord.title}</h1>
      <TraceView record={record} />
      <ActionForm {...formProps} />
      <ObligationChecklist obligations={caseRecord.obligations} />
    </main>
  );
}
