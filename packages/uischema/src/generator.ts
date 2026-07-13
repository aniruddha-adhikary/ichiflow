import { deref } from "./schema-io.js";
import type { JsonSchema, SchemaBundle, UiElement, UiSchema } from "./types.js";

/** Humanize a property name into a stable default label (`productCode` → `Product Code`). */
export function humanize(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * The **generated-once baseline uischema** (doc 07 §3 rule 1): a `VerticalLayout` with one `Control`
 * per data-schema property, in the schema's declared order, each scoped by a JSON Pointer with a
 * humanized label and a `format` option mirrored from the data schema. Deterministic — the layout is a
 * pure function of the data schema, no wall-clock or RNG — so it is safe to commit as the starting
 * point a designer (or Portal, Phase 4.4) then overrides.
 */
export function generateBaseline(
  dataSchemaId: string,
  bundle: SchemaBundle,
  version: string,
): UiSchema {
  const root = bundle[dataSchemaId];
  if (!root) throw new Error(`data schema ${dataSchemaId} not found in bundle`);
  const props: Record<string, JsonSchema> = root.properties ?? {};

  const elements: UiElement[] = Object.keys(props).map((name) => {
    const control: UiElement = {
      type: "Control",
      scope: `#/properties/${name}`,
      label: humanize(name),
    };
    const format = props[name]!.format ?? deref(props[name]!, bundle).format;
    if (format) control.options = { format };
    return control;
  });

  return {
    dataSchema: { id: dataSchemaId, version },
    layout: { type: "VerticalLayout", elements },
  };
}
