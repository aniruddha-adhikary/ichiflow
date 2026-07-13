import type { JsonSchema, UiElement, UiSchema } from "./types.js";

export interface DanglingScope {
  pointer: string;
  file: string;
  hint: string;
}

/** Depth-first collect of every `Control` node (the placed fields) in a layout tree, in render order. */
export function collectControls(root: UiElement): UiElement[] {
  const out: UiElement[] = [];
  const walk = (el: UiElement): void => {
    if (el.type === "Control") out.push(el);
    for (const child of el.elements ?? []) walk(child);
  };
  walk(root);
  return out;
}

/**
 * Resolve a uischema `Control` scope (a JSON Pointer like `#/properties/amount`) against the data
 * schema — the resolution model of doc 07 §2. A scope resolves iff its pointer segments walk to a real
 * node; a node that is itself a `$ref` (e.g. an enum reference) counts as resolved, since the field is
 * correctly placed — the ref target's validity is a separate schema concern, not a scope drift. Returns
 * `undefined` for a dangling pointer (a renamed/removed field).
 */
export function resolveScope(scope: string, dataSchema: JsonSchema): unknown {
  if (!scope.startsWith("#")) return undefined;
  const segments = scope
    .slice(1)
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: unknown = dataSchema;
  for (const seg of segments) {
    if (typeof node !== "object" || node === null) return undefined;
    const rec = node as Record<string, unknown>;
    if (!(seg in rec)) return undefined;
    node = rec[seg];
  }
  return node;
}

/**
 * The **uischema-scope drift lint** (doc 07 §3, doc 13 §2.e): every `Control.scope` must resolve
 * against the current data schema. A renamed/removed field orphans its pointer; each dangling scope is
 * returned with a fix-it hint naming the pointer and the offending file. An empty result = clean.
 */
export function lintScopes(ui: UiSchema, dataSchema: JsonSchema, file: string): DanglingScope[] {
  const dangling: DanglingScope[] = [];
  for (const control of collectControls(ui.layout)) {
    const scope = control.scope;
    if (typeof scope !== "string") {
      dangling.push({
        pointer: "(missing)",
        file,
        hint: `a Control has no scope in ${file}`,
      });
      continue;
    }
    if (resolveScope(scope, dataSchema) === undefined) {
      dangling.push({
        pointer: scope,
        file,
        hint: `scope '${scope}' does not resolve against data schema '${ui.dataSchema.id}' — rename or remove the Control in ${file}`,
      });
    }
  }
  return dangling;
}
