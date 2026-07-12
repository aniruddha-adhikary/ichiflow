import { runCrossLanguageVectors } from "../cross-language-vectors.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const CORPUS_REL = "schemas/spike/corpus.json";
const JVM_RESULTS_REL = "core/build/spike-results.json";

/**
 * schema-fidelity-spike — build plan chunk 1.0 (riskiest bet #5, ADR-0006). Validates a hard probe
 * corpus with two independent validators — Ajv and networknt on the JVM (results read from
 * `core/build/spike-results.json`, produced by `pnpm spike:jvm`). A vector passes only when BOTH
 * validators match the expected verdict AND agree with each other. Any disagreement is a failed
 * check: the "one schema, many languages" premise does not hold for that construct as emitted.
 */
export const schemaFidelitySpikeScope: Scope = {
  id: "schema-fidelity-spike",
  description:
    "Cross-language JSON Schema fidelity: Ajv (TS) and networknt (JVM) must agree with each other and the expected verdict on a hard probe corpus.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    return runCrossLanguageVectors({
      repoRoot,
      corpusRel: CORPUS_REL,
      jvmResultsRel: JVM_RESULTS_REL,
      idPrefix: "spike",
      jvmCommand: "pnpm spike:jvm",
    });
  },
};
