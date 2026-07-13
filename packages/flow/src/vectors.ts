import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FlowConformanceVector } from "./dsl.js";

/** The committed conformance-vector fixtures (contract of record; also validated against the DSL schema by the flow-layer scope). */
export const VECTORS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "schemas",
  "flow",
  "vectors",
);

export function loadVectors(): FlowConformanceVector[] {
  return readdirSync(VECTORS_DIR)
    .filter((f) => f.endsWith(".vector.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(VECTORS_DIR, f), "utf8")) as FlowConformanceVector);
}
