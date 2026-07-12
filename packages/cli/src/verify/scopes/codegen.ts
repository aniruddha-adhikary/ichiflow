import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { assert, fail, pass } from "../check.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const OPENAPI_REL = "schemas/generated/openapi3/openapi.yaml";
const TS_TYPES_REL = "packages/contracts-ts/src/gen/types.gen.ts";
const KT_MODELS_REL = "core/generated/src/main/kotlin/ai/ichiflow/contracts/models";
const CANONICAL_MODEL = "IchiflowVerifyVerdictEnvelope";

interface OpenApiDoc {
  components?: { schemas?: Record<string, unknown> };
}

/** Both generators strip non-alphanumerics from a component name (e.g. `Ichiflow.Verify.X` → `IchiflowVerifyX`). */
function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "");
}

/**
 * codegen — build plan chunk 1.2 (ADR-0006). The canonical OpenAPI 3.1 document is the single source
 * for generated edges: TypeScript types (hey-api) and Kotlin models (Fabrikt). This scope asserts
 * both generated trees exist and *cover the whole contract* — every component schema maps to a
 * TypeScript type and a Kotlin model file — so neither generator silently drops a model. Byte-level
 * reproducibility is gated separately (`pnpm codegen:drift` for TS, `./gradlew checkModelsUpToDate`
 * for Kotlin); round-trip fidelity is proven by the per-language unit tests.
 */
export const codegenScope: Scope = {
  id: "codegen",
  description:
    "Generated TypeScript (hey-api) and Kotlin (Fabrikt) contract edges exist and cover every OpenAPI component schema.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];

    const openApiPath = join(repoRoot, OPENAPI_REL);
    const tsTypesPath = join(repoRoot, TS_TYPES_REL);
    const ktModelsDir = join(repoRoot, KT_MODELS_REL);

    if (!existsSync(openApiPath)) {
      checks.push(fail("codegen.openapi.present", { diff: `missing ${OPENAPI_REL}` }));
      return checks;
    }

    const tsPresent = existsSync(tsTypesPath);
    checks.push(
      assert("codegen.ts.present", tsPresent, {
        diff: `missing generated TS types ${TS_TYPES_REL}`,
      }),
    );
    const ktPresent = existsSync(ktModelsDir);
    checks.push(
      assert("codegen.kotlin.present", ktPresent, {
        diff: `missing generated Kotlin models ${KT_MODELS_REL}`,
      }),
    );
    if (!tsPresent || !ktPresent) return checks;

    const doc = parseYaml(readFileSync(openApiPath, "utf8")) as OpenApiDoc;
    const components = Object.keys(doc.components?.schemas ?? {}).map(sanitize);

    const tsSource = readFileSync(tsTypesPath, "utf8");
    const tsMissing = components.filter((name) => !tsSource.includes(`export type ${name} `));
    checks.push(
      assert("codegen.ts.covers-contract", tsMissing.length === 0, {
        expected: "every OpenAPI component schema has a generated TS type",
        actual: tsMissing.length > 0 ? `missing: ${tsMissing.join(", ")}` : "all present",
      }),
    );

    const ktFiles = new Set(readdirSync(ktModelsDir).map((f) => f.replace(/\.kt$/, "")));
    const ktMissing = components.filter((name) => !ktFiles.has(name));
    checks.push(
      assert("codegen.kotlin.covers-contract", ktMissing.length === 0, {
        expected: "every OpenAPI component schema has a generated Kotlin model",
        actual: ktMissing.length > 0 ? `missing: ${ktMissing.join(", ")}` : "all present",
      }),
    );

    const canonicalInBoth =
      tsSource.includes(`export type ${CANONICAL_MODEL} `) && ktFiles.has(CANONICAL_MODEL);
    checks.push(
      canonicalInBoth
        ? pass("codegen.canonical-model-parity")
        : fail("codegen.canonical-model-parity", {
            diff: `${CANONICAL_MODEL} must be generated in both TS and Kotlin`,
          }),
    );

    return checks;
  },
};
