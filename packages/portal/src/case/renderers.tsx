import {
  isControl,
  rankWith,
  uiTypeIs,
  type ControlProps,
  type JsonFormsRendererRegistryEntry,
  type Layout,
  type LayoutProps,
  type UISchemaElement,
} from "@jsonforms/core";
import {
  JsonFormsDispatch,
  withJsonFormsControlProps,
  withJsonFormsLayoutProps,
} from "@jsonforms/react";
import type { JSX } from "react";
import type { FieldState } from "../types.js";

/**
 * A minimal JSON Forms renderer set (doc 07 §4/§11) — deliberately just the two renderers the interim
 * action-form uischema needs: a vertical layout and a field control. The control renders the
 * ichiflow-unique **PDP-shaped states** (doc 07 §11.2): `hidden` (a "why is this hidden?" affordance,
 * no input) and `read-only` (a disabled input), alongside the ordinary editable state. State is driven
 * by `uischema.options.entitlement`, computed per principal from the PDP (see entitlements.ts).
 */

interface EntitlementOptions {
  entitlement?: FieldState;
  why?: string;
  multi?: boolean;
}

function fieldName(scope: string | undefined): string {
  if (!scope) return "";
  return scope.split("/").pop() ?? "";
}

function FieldControlRenderer(props: ControlProps): JSX.Element {
  const { data, handleChange, path, label, uischema, enabled } = props;
  const options = (uischema.options ?? {}) as EntitlementOptions;
  const entitlement: FieldState = options.entitlement ?? "editable";
  const field = fieldName((uischema as { scope?: string }).scope) || path;

  if (entitlement === "hidden") {
    return (
      <div data-field={field} data-field-state="hidden">
        <span className="field-label">{label}</span>
        <button
          type="button"
          data-testid={`why-${field}`}
          title={options.why ?? "Hidden by policy"}
          aria-label={`Why is ${label} hidden?`}
        >
          Hidden by policy — why?
        </button>
      </div>
    );
  }

  const readOnly = entitlement === "read-only" || enabled === false;
  return (
    <div data-field={field} data-field-state={readOnly ? "read-only" : "editable"}>
      <label htmlFor={`field-${field}`}>{label}</label>
      <input
        id={`field-${field}`}
        data-testid={`field-${field}`}
        disabled={readOnly}
        value={data === undefined || data === null ? "" : String(data)}
        onChange={(e) => handleChange(path, e.target.value)}
      />
    </div>
  );
}

function VerticalLayoutRenderer(props: LayoutProps): JSX.Element {
  const { uischema, schema, path, renderers, cells, enabled } = props;
  const layout = uischema as Layout;
  return (
    <div data-testid="action-form-layout">
      {layout.elements.map((child: UISchemaElement, index: number) => (
        <JsonFormsDispatch
          key={index}
          uischema={child}
          schema={schema}
          path={path}
          enabled={enabled}
          renderers={renderers}
          cells={cells}
        />
      ))}
    </div>
  );
}

export const FieldControl = withJsonFormsControlProps(FieldControlRenderer);
export const VerticalLayout = withJsonFormsLayoutProps(VerticalLayoutRenderer);

export const portalRenderers: JsonFormsRendererRegistryEntry[] = [
  { tester: rankWith(2, uiTypeIs("VerticalLayout")), renderer: VerticalLayout },
  { tester: rankWith(3, isControl), renderer: FieldControl },
];
