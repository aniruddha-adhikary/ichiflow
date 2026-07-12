import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import { checkReferentialIntegrity, type CodeSetDoc } from "../reference-data.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const FIXTURES_REL = "schemas/reference-data/fixtures";
const CODESET_SCHEMA = "CodeSet.json";

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  const dir = generatedSchemaDir();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    ajv.addSchema(JSON.parse(readFileSync(join(dir, file), "utf8")));
  }
  return ajv;
}

/**
 * reference-data — build plan chunk 1.4 (ADR-0025). Validates the committed CodeSet fixtures against
 * the emitted `CodeSet` contract, then enforces cross-CodeSet referential integrity: every `codeRef`
 * must resolve to a live row whose effective window covers the referencing row's (bitemporal, §9.4).
 * A dangling or out-of-window reference is a failed check — reference data cannot be released broken.
 */
export const referenceDataScope: Scope = {
  id: "reference-data",
  description:
    "CodeSet reference data: fixtures conform to the emitted contract and every cross-CodeSet codeRef resolves to a live, effective-window-covering row.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const fixturesDir = join(repoRoot, FIXTURES_REL);

    if (!existsSync(fixturesDir)) {
      return [fail("reference-data.fixtures.present", { diff: `missing ${FIXTURES_REL}` })];
    }

    const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".codeset.json"));
    checks.push(
      assert("reference-data.fixtures.present", files.length > 0, {
        diff: `no *.codeset.json fixtures in ${FIXTURES_REL}`,
      }),
    );
    if (files.length === 0) return checks;

    const ajv = buildAjv();
    const validate = ajv.getSchema(CODESET_SCHEMA);
    if (!validate) {
      return [
        fail("reference-data.schema.present", {
          diff: `emitted ${CODESET_SCHEMA} not found; run pnpm schema:build`,
        }),
      ];
    }

    const sets: CodeSetDoc[] = [];
    for (const file of files) {
      const doc = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as CodeSetDoc;
      const valid = validate(doc);
      checks.push(
        assert(`reference-data.schema.${file}`, valid === true, {
          expected: `${file} conforms to ${CODESET_SCHEMA}`,
          actual: valid ? "valid" : ajv.errorsText(validate.errors),
        }),
      );
      sets.push(doc);
    }

    const { checks: refChecks, edges } = checkReferentialIntegrity(sets);
    for (const r of refChecks) {
      checks.push(
        assert(`reference-data.coderef.resolves.${r.id}`, r.resolves, {
          expected: `${r.from} → ${r.target} resolves to a live row`,
          actual: r.resolveDetail ?? "unresolved",
        }),
      );
      if (r.resolves) {
        checks.push(
          assert(`reference-data.coderef.effective.${r.id}`, r.effectiveCovered === true, {
            expected: `${r.from} → ${r.target} covered by target effective window`,
            actual: r.effectiveDetail ?? "not covered",
          }),
        );
      }
    }

    const dangling = refChecks.filter((r) => !r.resolves).length;
    checks.push(
      assert("reference-data.graph.no-dangling", dangling === 0, {
        expected: "0 dangling codeRefs across the dependency graph",
        actual: `${dangling} dangling of ${edges.length} edge(s)`,
      }),
    );

    return checks;
  },
};
