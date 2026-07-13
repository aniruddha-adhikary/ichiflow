import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { JsonSchema, RendererKind, SchemaBundle } from "./types.js";

/** Load every emitted JSON Schema in a directory into a bundle keyed by file name (its `$id`). */
export function loadSchemaBundle(generatedDir: string): SchemaBundle {
  const bundle: SchemaBundle = {};
  for (const file of readdirSync(generatedDir).sort()) {
    if (!file.endsWith(".json")) continue;
    bundle[file] = JSON.parse(readFileSync(join(generatedDir, file), "utf8")) as JsonSchema;
  }
  return bundle;
}

/**
 * A deterministic content version for a data schema (`sha256:<hex>`), recorded as provenance on the
 * generated uischema (doc 07 §2 rule 2). Derived from the exact emitted bytes — never wall-clock — so
 * it is a stable drift signal, not a timestamp.
 */
export function schemaVersion(generatedDir: string, schemaId: string): string {
  const raw = readFileSync(join(generatedDir, schemaId), "utf8");
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

/** Follow a single `$ref` (a sibling `$id` file name) in the bundle, or return the schema unchanged. */
export function deref(schema: JsonSchema, bundle: SchemaBundle): JsonSchema {
  let cur = schema;
  const seen = new Set<string>();
  while (cur.$ref) {
    if (seen.has(cur.$ref)) break;
    seen.add(cur.$ref);
    const target = bundle[cur.$ref];
    if (!target) break;
    cur = target;
  }
  return cur;
}

/** Extract the enum values a (possibly `$ref`/`anyOf`-const) schema constrains to, if any. */
export function enumValues(schema: JsonSchema, bundle: SchemaBundle): string[] | undefined {
  const resolved = deref(schema, bundle);
  if (Array.isArray(resolved.enum)) return resolved.enum.map(String);
  if (Array.isArray(resolved.anyOf)) {
    const consts = resolved.anyOf
      .map((s) => s.const)
      .filter((c): c is string | number | boolean => c !== undefined);
    if (consts.length === resolved.anyOf.length && consts.length > 0) return consts.map(String);
  }
  return undefined;
}

/** Classify a property schema to the renderer kind the baseline generator/registry picks (doc 07 §2). */
export function rendererFor(
  schema: JsonSchema,
  bundle: SchemaBundle,
  options?: { multi?: boolean },
): RendererKind {
  if (enumValues(schema, bundle)) return "enum";
  const resolved = deref(schema, bundle);
  const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
  if (type === "boolean") return "boolean";
  if (type === "number" || type === "integer") return "number";
  if (options?.multi) return "multiline";
  return "text";
}
