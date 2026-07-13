import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The canonical **uischema** contracts (build plan 4.5 ◆; ADR-0024, doc 07 §2/§3, doc 13 §2.e). A
 * uischema is a **JSON Forms layout tree** that is authored/generated **independently** of the data
 * schema it targets — the resolution model (doc 07 §2) walks the layout, and every `Control` carries a
 * JSON-Pointer `scope` into the data schema. The single residual weakness of the stock JSON Forms
 * model is that a renamed/removed field **orphans** its scope pointer; ichiflow closes that with the
 * mandatory drift lint (doc 07 §3) gated by the `ui` verify scope.
 *
 * This schema fixes the *shape* of a uischema document. Two design points worth calling out:
 *
 *   - **Provenance is recorded on the document** (doc 07 §2 rule 2): a uischema records the `$id` and a
 *     content `version` of the data schema it targets, so drift between the generated-once baseline and
 *     an evolving data schema is detectable, not silent.
 *   - **The layout tree is stock JSON Forms** (`VerticalLayout` / `HorizontalLayout` / `Group` /
 *     `Control`), so a Portal (Phase 4.4) can consume `layout` directly through `@jsonforms/*`. Groups
 *     and layouts nest `elements`; a `Control` binds a `scope` (JSON Pointer) plus optional label and
 *     renderer `options`.
 *
 * The emitted JSON Schema is the contract of record; the generator (`@ichiflow/uischema`) emits the
 * default baseline uischema from an emitted data schema, and the UI harness validates committed
 * uischema documents against `UiSchema.json` at the boundary (like every other vector DSL).
 */
@jsonSchema
namespace Ichiflow.UI;

/** The JSON Forms element kinds the v1 generator + harness support (doc 07 §2). */
union UiElementType {
  verticalLayout: "VerticalLayout",
  horizontalLayout: "HorizontalLayout",
  group: "Group",
  control: "Control",
}

/**
 * Renderer options on a `Control` — the small, typed subset the baseline generator emits and the
 * renderer registry (doc 07 §4) understands. Kept closed (no free-form map) so the emitted contract
 * stays a stable boundary the harness can validate.
 */
model UiControlOptions {
  /** A renderer hint mirroring the data schema's `format` (e.g. `currency`), driving tester priority. */
  format?: string;

  /** Render the control read-only regardless of PDP state (a design-time affordance, doc 07 §11.2). */
  readOnly?: boolean;

  /** Multi-line text affordance for long string fields. */
  multi?: boolean;
}

/**
 * One node of the JSON Forms layout tree (doc 07 §2). A layout/group node nests `elements`; a
 * `Control` node binds a `scope` (a JSON Pointer into the data schema, e.g. `#/properties/amount`)
 * plus an optional `label` and renderer `options`. Exactly the fields for the variant in play are set.
 */
model UiElement {
  type: UiElementType;

  /** For a `Control`: the JSON Pointer into the data schema this control renders (doc 07 §3 lint). */
  scope?: string;

  /** Human label for a `Control` or the heading of a `Group`. */
  label?: string;

  /** Renderer options for a `Control`. */
  options?: UiControlOptions;

  /** For a layout/group: the child elements, in render order. */
  elements?: UiElement[];
}

/**
 * The data schema a uischema targets, by `$id` and a content `version` (doc 07 §2 rule 2). `version`
 * is a deterministic content digest (`sha256:…`) of the emitted data schema, so the harness can detect
 * when the generated-once baseline has drifted from an evolved data schema and must be regenerated.
 */
model DataSchemaRef {
  /** The `$id` of the emitted data JSON Schema this uischema targets (e.g. `LoanApplication.json`). */
  id: string;

  /** A deterministic content digest of the target data schema (`sha256:<hex>`) — the drift signal. */
  version: string;
}

/**
 * A committed **uischema document** (build plan 4.5): the JSON Forms `layout` tree plus the
 * `dataSchema` provenance it targets. The generated baseline is a `VerticalLayout` over all fields
 * (doc 07 §3 rule 1); designer overrides are versioned documents of the same shape (rule 2).
 */
model UiSchema {
  /** Provenance: the data schema `$id` + content version this document targets (doc 07 §2 rule 2). */
  dataSchema: DataSchemaRef;

  /** The JSON Forms layout tree root (a `VerticalLayout` for the generated baseline). */
  layout: UiElement;
}
