/**
 * TypeScript mirrors of the TypeSpec-authored uischema contract (schemas/ui.tsp → UiSchema.json, the
 * contract of record) plus the minimal JSON-Schema-2020-12 shape the generator/lint walk. The emitted
 * JSON Schema — not these types — is the boundary the harness validates against.
 */

export type UiElementType = "VerticalLayout" | "HorizontalLayout" | "Group" | "Control";

export interface UiControlOptions {
  format?: string;
  readOnly?: boolean;
  multi?: boolean;
}

export interface UiElement {
  type: UiElementType;
  scope?: string;
  label?: string;
  options?: UiControlOptions;
  elements?: UiElement[];
}

export interface DataSchemaRef {
  id: string;
  version: string;
}

export interface UiSchema {
  dataSchema: DataSchemaRef;
  layout: UiElement;
}

/** The minimal JSON Schema 2020-12 shape the generator + lint need (a subset — not a full model). */
export interface JsonSchema {
  $id?: string;
  $schema?: string;
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  anyOf?: JsonSchema[];
  const?: unknown;
  format?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
}

/** A resolver over the emitted schema bundle: `$id` (filename) → schema. */
export type SchemaBundle = Record<string, JsonSchema>;

/** The renderer kind a control resolves to — the tester-priority outcome (doc 07 §2/§4). */
export type RendererKind = "text" | "multiline" | "number" | "enum" | "boolean";

/** The four PDP-shaped states every placed control must have a story for (doc 07 §11.2). */
export const PDP_STATES = ["hidden", "read-only", "error", "validation-failed"] as const;
export type PdpState = (typeof PDP_STATES)[number];
