import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { assert, fail, pass } from "../check.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const OPENAPI_REL = "schemas/generated/openapi3/openapi.yaml";
const JSON_SCHEMA_REL = "schemas/generated/json-schema";
// The canonical model reused across both emitted artifacts (ADR-0006): its presence in the OpenAPI
// components AND as a standalone JSON Schema is what "one schema, many artifacts" means concretely.
const CANONICAL_MODEL = "VerdictEnvelope";

interface OpenApiDoc {
  openapi?: string;
  paths?: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
}

/** Collect every `$ref` string anywhere in the document. */
function collectRefs(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") out.push(value);
      else collectRefs(value, out);
    }
  }
}

/** Resolve a local `#/a/b/c` JSON pointer against the document root; undefined if unresolved. */
function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!cur || typeof cur !== "object" || !(seg in (cur as Record<string, unknown>))) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * schema-pipeline — build plan chunk 1.1 (ADR-0006). Guards the emitted contract artifacts: the
 * canonical model is authored once in TypeSpec and emitted to both JSON Schema 2020-12 and
 * OpenAPI 3.1. This scope asserts both artifacts exist, the OpenAPI is genuinely 3.1, the canonical
 * model appears in both, and every local `$ref` in the OpenAPI resolves. Drift (regenerate-and-diff)
 * is a separate build-level gate (`pnpm schema:drift`); this scope validates the committed output.
 */
export const schemaPipelineScope: Scope = {
  id: "schema-pipeline",
  description:
    "Emitted contract artifacts (OpenAPI 3.1 + JSON Schema 2020-12) exist, are well-formed, reuse the canonical model, and have resolvable refs.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];

    const jsonSchemaPath = join(repoRoot, JSON_SCHEMA_REL, `${CANONICAL_MODEL}.json`);
    checks.push(
      assert(`schema-pipeline.json-schema.${CANONICAL_MODEL}`, existsSync(jsonSchemaPath), {
        diff: `missing emitted JSON Schema ${JSON_SCHEMA_REL}/${CANONICAL_MODEL}.json`,
      }),
    );

    const openApiPath = join(repoRoot, OPENAPI_REL);
    if (!existsSync(openApiPath)) {
      checks.push(fail("schema-pipeline.openapi.present", { diff: `missing ${OPENAPI_REL}` }));
      return checks;
    }
    checks.push(pass("schema-pipeline.openapi.present"));

    const doc = parseYaml(readFileSync(openApiPath, "utf8")) as OpenApiDoc;

    checks.push(
      assert("schema-pipeline.openapi.version-3.1", doc.openapi === "3.1.0", {
        expected: "3.1.0",
        actual: doc.openapi ?? "missing",
      }),
    );

    const pathCount = doc.paths ? Object.keys(doc.paths).length : 0;
    checks.push(
      assert("schema-pipeline.openapi.has-paths", pathCount > 0, {
        diff: "OpenAPI document declares no paths",
      }),
    );

    const schemas = doc.components?.schemas ?? {};
    const reusesCanonical = Object.keys(schemas).some((name) => name.endsWith(CANONICAL_MODEL));
    checks.push(
      assert("schema-pipeline.openapi.reuses-canonical-model", reusesCanonical, {
        diff: `OpenAPI components.schemas has no ${CANONICAL_MODEL} — the artifacts are not derived from one model`,
      }),
    );

    const refs: string[] = [];
    collectRefs(doc, refs);
    const unresolved = [...new Set(refs)].filter((ref) => resolvePointer(doc, ref) === undefined);
    checks.push(
      assert("schema-pipeline.openapi.refs-resolve", unresolved.length === 0, {
        expected: "all $refs resolve",
        actual: unresolved.length > 0 ? unresolved.join(", ") : "all resolved",
      }),
    );

    return checks;
  },
};
