import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  VERIFY_VERSION,
  type CheckResult,
  type Progress,
  type Verdict,
  type VerdictEnvelope,
  type VerdictSummary,
} from "./types.js";

const require = createRequire(import.meta.url);
// ajv-formats is CJS whose module.exports is the plugin function; load it via require to sidestep
// ESM default-interop ambiguity across the CJS/ESM boundary.
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

/**
 * Resolve the directory of the generated JSON Schema bundle for the verdict envelope, produced by
 * `@ichiflow/schemas` from the TypeSpec source. This is the contract of record the CLI validates
 * its own output against — the meta-harness's self-reference.
 */
export function generatedSchemaDir(): string {
  const entry = require.resolve("@ichiflow/schemas/verdict-envelope");
  return dirname(entry);
}

let cachedValidator: ValidateFunction | undefined;

/** Compile (once) the Ajv validator for the verdict envelope from the generated schemas. */
export function envelopeValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  const dir = generatedSchemaDir();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const schema = JSON.parse(readFileSync(join(dir, file), "utf8"));
    ajv.addSchema(schema);
  }
  const validate = ajv.getSchema("VerdictEnvelope.json");
  if (!validate) throw new Error("VerdictEnvelope.json schema not found in generated schemas");
  cachedValidator = validate;
  return validate;
}

export interface EnvelopeValidation {
  valid: boolean;
  errors: string[];
}

/** Validate an object against the generated verdict-envelope schema. */
export function validateEnvelope(value: unknown): EnvelopeValidation {
  const validate = envelopeValidator();
  const valid = validate(value) as boolean;
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
  );
  return { valid, errors };
}

/** Assemble a well-formed envelope from a scope's check results. */
export function buildEnvelope(args: {
  scope: string;
  seed: string;
  ranAt: string;
  checks: CheckResult[];
  progress?: Progress;
}): VerdictEnvelope {
  const summary = summarize(args.checks);
  const verdict: Verdict = summary.failed > 0 ? "fail" : "pass";
  const progress: Progress = args.progress ?? {
    conformance: { green: summary.passed, total: summary.checks - summary.skipped },
  };
  return {
    verifyVersion: VERIFY_VERSION,
    scope: args.scope,
    ranAt: args.ranAt,
    seed: args.seed,
    verdict,
    summary,
    progress,
    checks: args.checks,
    flaky: false,
  };
}

function summarize(checks: CheckResult[]): VerdictSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const c of checks) {
    if (c.status === "pass") passed++;
    else if (c.status === "fail") failed++;
    else skipped++;
  }
  return { checks: checks.length, passed, failed, skipped };
}
