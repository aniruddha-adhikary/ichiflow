import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

type Verdict = "accept" | "reject";

interface Vector {
  id: string;
  schema: string;
  expect: Verdict;
  instance: unknown;
}

interface Corpus {
  vectors: Vector[];
}

interface JvmResults {
  results: Record<string, Verdict>;
}

const CORPUS_REL = "schemas/spike/corpus.json";
const JVM_RESULTS_REL = "core/build/spike-results.json";

/**
 * Build an Ajv 2020-12 validator loaded with every emitted schema (so cross-file `$ref`s like
 * `Email.json` resolve) and with format assertion ON — matching the JVM side's config so the two
 * validators are configured to make the *same* accept/reject decisions.
 */
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
 * schema-fidelity-spike — build plan chunk 1.0 (riskiest bet #5, ADR-0006). Validates a hard probe
 * corpus with two independent validators — Ajv (here) and networknt on the JVM (results read from
 * `core/build/spike-results.json`, produced by `pnpm spike:jvm`). A vector passes only when BOTH
 * validators match the expected verdict AND agree with each other. Any disagreement is a failed
 * check: the "one schema, many languages" premise does not hold for that construct as emitted.
 */
export const schemaFidelitySpikeScope: Scope = {
  id: "schema-fidelity-spike",
  description:
    "Cross-language JSON Schema fidelity: Ajv (TS) and networknt (JVM) must agree with each other and the expected verdict on a hard probe corpus.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];

    const corpusPath = join(repoRoot, CORPUS_REL);
    if (!existsSync(corpusPath)) {
      return [fail("spike.corpus-present", { diff: `missing probe corpus at ${CORPUS_REL}` })];
    }
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;

    const ajv = buildAjv();
    const tsResults = new Map<string, Verdict>();
    for (const v of corpus.vectors) {
      const validate = ajv.getSchema(v.schema);
      if (!validate) {
        checks.push(
          fail(`spike.ts.${v.id}`, { diff: `schema ${v.schema} not found in emitted set` }),
        );
        continue;
      }
      const result: Verdict = validate(v.instance) ? "accept" : "reject";
      tsResults.set(v.id, result);
      checks.push(
        assert(`spike.ts.${v.id}`, result === v.expect, { expected: v.expect, actual: result }),
      );
    }

    const jvmPath = join(repoRoot, JVM_RESULTS_REL);
    if (!existsSync(jvmPath)) {
      checks.push(
        fail("spike.jvm-results-present", {
          diff: `missing ${JVM_RESULTS_REL}; run \`pnpm spike:jvm\` to build and run the networknt validator`,
        }),
      );
      return checks;
    }

    const jvm = JSON.parse(readFileSync(jvmPath, "utf8")) as JvmResults;
    for (const v of corpus.vectors) {
      const jvmResult = jvm.results[v.id];
      checks.push(
        assert(`spike.jvm.${v.id}`, jvmResult === v.expect, {
          expected: v.expect,
          actual: jvmResult ?? "missing",
        }),
      );
      const tsResult = tsResults.get(v.id);
      checks.push(
        assert(`spike.agree.${v.id}`, tsResult !== undefined && tsResult === jvmResult, {
          expected: `ts=${tsResult ?? "missing"}`,
          actual: `jvm=${jvmResult ?? "missing"}`,
        }),
      );
    }

    return checks;
  },
};
