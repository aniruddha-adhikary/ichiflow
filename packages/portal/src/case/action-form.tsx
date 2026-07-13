import { useState, type JSX } from "react";
import { JsonForms } from "@jsonforms/react";
import type { UISchemaElement } from "@jsonforms/core";
import { portalRenderers } from "./renderers.js";
import type { CaseRecord, FieldEntitlement } from "../types.js";

/**
 * The Case **action form** (doc 07 §7). Its submit does not mutate Case state directly — it emits a
 * **Flow signal** (doc 04 §5.2, BRIEF §2) correlated to the Case's active `human-task` step, which the
 * interpreter resolves. Field render states come from the PDP (doc 07 §6/§11): the interim uischema is
 * personalised per principal by stamping each Control's `options.entitlement`.
 */

/** A Flow signal payload (mirrors `schemas/flow.tsp` `FlowSignal` → emitted `FlowSignal.json`). */
export interface FlowSignalPayload {
  afterMs: number;
  stepId: string;
  action: "resolve" | "pause" | "resume";
  value: number;
}

/** Build the Flow signal the action form emits — a pure, deterministic function of form data. */
export function buildSignal(
  caseRecord: CaseRecord,
  data: Record<string, unknown>,
): FlowSignalPayload {
  const raw = data.decision;
  const value = typeof raw === "number" ? raw : Number(raw ?? 0);
  return {
    afterMs: 0,
    stepId: caseRecord.activeStep,
    action: "resolve",
    value: Number.isFinite(value) ? value : 0,
  };
}

/** Stamp per-principal entitlements onto a copy of the interim uischema's Controls. */
export function personaliseUiSchema(
  uischema: Record<string, unknown>,
  entitlements: FieldEntitlement[],
): UISchemaElement {
  const byField = new Map(entitlements.map((e) => [e.field, e]));
  const elements = Array.isArray(uischema.elements) ? uischema.elements : [];
  const stamped = elements.map((el) => {
    const element = el as { type?: string; scope?: string; options?: Record<string, unknown> };
    if (element.type !== "Control" || typeof element.scope !== "string") return element;
    const field = element.scope.split("/").pop() ?? "";
    const ent = byField.get(field);
    if (!ent) return element;
    return {
      ...element,
      options: { ...(element.options ?? {}), entitlement: ent.state, why: ent.reason },
    };
  });
  return { ...uischema, elements: stamped } as unknown as UISchemaElement;
}

export interface ActionFormProps {
  schema: Record<string, unknown>;
  uischema: Record<string, unknown>;
  caseRecord: CaseRecord;
  entitlements: FieldEntitlement[];
  /** Seeded initial form data — deterministic (no live input needed to reach a stable signal). */
  initialData: Record<string, unknown>;
  onSignal: (signal: FlowSignalPayload) => void;
}

export function ActionForm(props: ActionFormProps): JSX.Element {
  const { schema, uischema, caseRecord, entitlements, initialData, onSignal } = props;
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const personalised = personaliseUiSchema(uischema, entitlements);
  // JSON Forms compiles the schema with Ajv (draft-07 default); drop the 2020-12 `$schema` dialect
  // pointer so it uses its bundled meta-schema. The keywords we use are draft-07 compatible.
  const formSchema: Record<string, unknown> = { ...schema };
  delete formSchema.$schema;

  return (
    <section data-testid="action-form">
      <JsonForms
        schema={formSchema}
        uischema={personalised}
        data={data}
        renderers={portalRenderers}
        cells={[]}
        onChange={({ data: next }) => setData(next as Record<string, unknown>)}
      />
      <button
        type="button"
        data-testid="action-submit"
        onClick={() => onSignal(buildSignal(caseRecord, data))}
      >
        Submit decision (signal the Flow)
      </button>
    </section>
  );
}
