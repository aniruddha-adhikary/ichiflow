import { runCrossLanguageVectors } from "../cross-language-vectors.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const CORPUS_REL = "schemas/vectors/contract-corpus.json";
const JVM_RESULTS_REL = "core/build/contract-vector-results.json";

/**
 * contract-vectors — build plan chunk 1.3 (ADR-0006). Where `schema-fidelity-spike` probes synthetic
 * worst-case constructs, this scope pins the accept/reject behaviour of the *real* emitted contract
 * (VerdictEnvelope and its members) across both validators. Ajv (TS) and networknt (JVM, results
 * from `pnpm vectors:jvm`) must match the expected verdict and agree with each other on every
 * vector — so a change that makes the two languages disagree about the contract fails the build.
 */
export const contractVectorsScope: Scope = {
  id: "contract-vectors",
  description:
    "Cross-language validation vectors for the real emitted contract: Ajv (TS) and networknt (JVM) must agree with each other and the expected verdict.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    return runCrossLanguageVectors({
      repoRoot,
      corpusRel: CORPUS_REL,
      jvmResultsRel: JVM_RESULTS_REL,
      idPrefix: "contract",
      jvmCommand: "pnpm vectors:jvm",
    });
  },
};
