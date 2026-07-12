import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "./check.js";
import { generatedSchemaDir } from "./envelope.js";
import type { CheckResult } from "./types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

export type Verdict = "accept" | "reject";

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

/**
 * Build an Ajv 2020-12 validator loaded with every emitted schema (so cross-file `$ref`s like
 * `Verdict.json` resolve) and with format assertion ON — matching the JVM side's config so the two
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

export interface CrossLanguageVectorsOptions {
  repoRoot: string;
  /** Repo-relative path to the vector corpus. */
  corpusRel: string;
  /** Repo-relative path to the networknt (JVM) results the corpus is cross-checked against. */
  jvmResultsRel: string;
  /** Check-id namespace, e.g. `spike` or `contract`. */
  idPrefix: string;
  /** The command that produces the JVM results, surfaced in the missing-results diff. */
  jvmCommand: string;
}

/**
 * The shared cross-language vector engine (build plan 1.0 + 1.3, ADR-0006). Validates a labelled
 * corpus with two independent validators — Ajv (here) and networknt on the JVM (results read from
 * disk) — and, per vector, asserts: (1) Ajv matches the expected verdict, (2) networknt matches it,
 * and (3) the two agree with each other. Any divergence is a failed check. This is the reusable
 * core behind both the `schema-fidelity-spike` and `contract-vectors` scopes.
 */
export function runCrossLanguageVectors(opts: CrossLanguageVectorsOptions): CheckResult[] {
  const { repoRoot, corpusRel, jvmResultsRel, idPrefix, jvmCommand } = opts;
  const checks: CheckResult[] = [];

  const corpusPath = join(repoRoot, corpusRel);
  if (!existsSync(corpusPath)) {
    return [fail(`${idPrefix}.corpus-present`, { diff: `missing vector corpus at ${corpusRel}` })];
  }
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;

  const ajv = buildAjv();
  const tsResults = new Map<string, Verdict>();
  for (const v of corpus.vectors) {
    const validate = ajv.getSchema(v.schema);
    if (!validate) {
      checks.push(
        fail(`${idPrefix}.ts.${v.id}`, { diff: `schema ${v.schema} not found in emitted set` }),
      );
      continue;
    }
    const result: Verdict = validate(v.instance) ? "accept" : "reject";
    tsResults.set(v.id, result);
    checks.push(
      assert(`${idPrefix}.ts.${v.id}`, result === v.expect, { expected: v.expect, actual: result }),
    );
  }

  const jvmPath = join(repoRoot, jvmResultsRel);
  if (!existsSync(jvmPath)) {
    checks.push(
      fail(`${idPrefix}.jvm-results-present`, {
        diff: `missing ${jvmResultsRel}; run \`${jvmCommand}\` to build and run the networknt validator`,
      }),
    );
    return checks;
  }

  const jvm = JSON.parse(readFileSync(jvmPath, "utf8")) as JvmResults;
  for (const v of corpus.vectors) {
    const jvmResult = jvm.results[v.id];
    checks.push(
      assert(`${idPrefix}.jvm.${v.id}`, jvmResult === v.expect, {
        expected: v.expect,
        actual: jvmResult ?? "missing",
      }),
    );
    const tsResult = tsResults.get(v.id);
    checks.push(
      assert(`${idPrefix}.agree.${v.id}`, tsResult !== undefined && tsResult === jvmResult, {
        expected: `ts=${tsResult ?? "missing"}`,
        actual: `jvm=${jvmResult ?? "missing"}`,
      }),
    );
  }

  return checks;
}
