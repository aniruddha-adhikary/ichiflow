import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, fail } from "../check.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const RESULTS_REL = "core/build/decision-projection-results.json";
const JVM_COMMAND = "cd core && ./gradlew runDecisionSpike";

interface VectorResult {
  id: string;
  expect: string | null;
  reference: string | null;
  compiled: string | null;
  match: boolean;
  referenceErrors: boolean;
  compiledErrors: boolean;
}

interface Results {
  engine: string;
  specVersion: string;
  decision: string;
  vectors: VectorResult[];
}

/** Numeric-tolerant equality so FEEL BigDecimal scale (`50` vs `50.0`) is not a spurious mismatch. */
function valueMatches(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
}

/**
 * decision-projection-spike — build plan 2.0 (ADR-0001/0002/0027), the DMN-projection feasibility
 * gate. Consumes the KIE/Drools execution results (`cd core && ./gradlew runDecisionSpike`) where the
 * `decision-source` fixture is compiled to DMN 1.6 and run alongside the hand-authored reference. Per
 * vector it asserts: neither model errored, the compiled projection matches the reference, and both
 * match the expected outcome. This is the proof that the hard boxed-expression kinds (BKM FEEL
 * functions, boxed contexts, invocations) project and execute correctly before the full compiler.
 */
export const decisionProjectionSpikeScope: Scope = {
  id: "decision-projection-spike",
  description:
    "Compiled decision-source → DMN 1.6 executes identically to the hand-authored reference on KIE/Drools across every input vector (hard boxed-expression kinds).",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      return [
        fail("decision-projection-spike.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${JVM_COMMAND}\` to compile and execute on KIE`,
        }),
      ];
    }

    const results = JSON.parse(readFileSync(resultsPath, "utf8")) as Results;
    const checks: CheckResult[] = [];

    checks.push(
      assert("decision-projection-spike.engine", results.engine.startsWith("kie-dmn:"), {
        expected: "kie-dmn:<version>",
        actual: results.engine,
      }),
    );

    for (const v of results.vectors) {
      checks.push(
        assert(
          `decision-projection-spike.no-errors.${v.id}`,
          !v.referenceErrors && !v.compiledErrors,
          {
            expected: "no DMN errors on reference or compiled",
            actual: `reference=${v.referenceErrors}, compiled=${v.compiledErrors}`,
          },
        ),
      );
      checks.push(
        assert(`decision-projection-spike.match.${v.id}`, v.match, {
          expected: `compiled == reference (${v.reference})`,
          actual: `compiled=${v.compiled}`,
        }),
      );
      checks.push(
        assert(`decision-projection-spike.expected.${v.id}`, valueMatches(v.reference, v.expect), {
          expected: v.expect ?? "(none)",
          actual: v.reference,
        }),
      );
    }

    return checks;
  },
};
