import { toDataPath } from "@jsonforms/core";
import { collectControls } from "./lint.js";
import { deref, enumValues, rendererFor } from "./schema-io.js";
import { PDP_STATES, type JsonSchema, type PdpState, type RendererKind } from "./types.js";
import type { SchemaBundle, UiSchema } from "./types.js";

export interface StorySpec {
  id: string;
  scope: string;
  dataPath: string;
  renderer: RendererKind;
  state: PdpState;
  label: string;
  value: string | boolean;
  enumOptions?: string[];
  message?: string;
}

/** The data path for a control scope, via JSON Forms' own `toDataPath` (the doc 07 §2 model). */
function dataPathOf(scope: string): string {
  const path = toDataPath(scope);
  return path.length > 0 ? path : "field";
}

/** A deterministic sample value per renderer kind — fixed, never randomized (doc 13 §2.e). */
function sampleValue(kind: RendererKind, enums?: string[]): string | boolean {
  switch (kind) {
    case "number":
      return "0";
    case "boolean":
      return false;
    case "enum":
      return enums && enums.length > 0 ? enums[0]! : "";
    case "multiline":
      return "Sample text";
    case "text":
    default:
      return "Sample";
  }
}

/** The per-state message a control shows in its error / validation-failed story (deterministic). */
function messageFor(
  state: PdpState,
  label: string,
  propSchema: JsonSchema,
  bundle: SchemaBundle,
): string | undefined {
  if (state === "error") return `${label} could not be loaded.`;
  if (state === "validation-failed") {
    const resolved = deref(propSchema, bundle);
    if (typeof resolved.minimum === "number")
      return `${label} must be at least ${resolved.minimum}.`;
    if (enumValues(propSchema, bundle)) return `${label} must be one of the allowed values.`;
    return `${label} is required.`;
  }
  return undefined;
}

/**
 * Build the full **story matrix** (doc 07 §11.2, doc 13 §2.e): one story per placed control × the four
 * PDP-shaped states. Stories are emitted in a stable order (control order, then the fixed state order)
 * so both the snapshot set and the coverage count are deterministic.
 */
export function buildStories(
  ui: UiSchema,
  dataSchemaId: string,
  bundle: SchemaBundle,
): StorySpec[] {
  const root = bundle[dataSchemaId];
  const props: Record<string, JsonSchema> = root?.properties ?? {};
  const stories: StorySpec[] = [];

  for (const control of collectControls(ui.layout)) {
    const scope = control.scope!;
    const dataPath = dataPathOf(scope);
    const propSchema = props[dataPath] ?? {};
    const enums = enumValues(propSchema, bundle);
    const renderer = rendererFor(propSchema, bundle, { multi: control.options?.multi });
    const label = control.label ?? dataPath;

    for (const state of PDP_STATES) {
      stories.push({
        id: `${dataPath}--${state}`,
        scope,
        dataPath,
        renderer,
        state,
        label,
        value: sampleValue(renderer, enums),
        ...(enums ? { enumOptions: enums } : {}),
        ...(messageFor(state, label, propSchema, bundle) !== undefined
          ? { message: messageFor(state, label, propSchema, bundle) }
          : {}),
      });
    }
  }

  return stories;
}
