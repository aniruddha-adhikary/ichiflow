import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, fail } from "../check.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const RESULTS_REL = "core/build/decision-tck-results.json";
const JVM_COMMAND = "cd core && ./gradlew runDecisionTck";

interface Capabilities {
  engineId: string;
  engineVersion: string;
  dmnSpecVersions: string[];
  feel: boolean;
  decisionTable: boolean;
  businessKnowledgeModel: boolean;
  context: boolean;
  invocation: boolean;
}

interface CaseResult {
  id: string;
  model: string;
  decision: string;
  kind: string | null;
  expect: string | null;
  actual: string | null;
  errors: boolean;
}

interface Results {
  engine: string;
  engineVersion: string;
  suite: string;
  capabilities: Capabilities;
  cases: CaseResult[];
}

/** Numeric-tolerant equality for `kind: "number"` cases so FEEL scale (`80` vs `80.0`) is not a mismatch. */
function valueMatches(kind: string | null, expect: string | null, actual: string | null): boolean {
  if (expect === null || actual === null) return false;
  if (expect === actual) return true;
  if (kind !== "number") return false;
  const e = Number(expect);
  const a = Number(actual);
  return !Number.isNaN(e) && !Number.isNaN(a) && e === a;
}

/**
 * The capability descriptor the reference engine (Drools) must advertise to be considered a
 * conformant DMN 1.6 decision engine behind the SPI. Asserted structurally so a silent capability
 * regression (e.g. a future engine that drops boxed-context support) fails the harness.
 */
const EXPECTED_CAPS: Array<[keyof Capabilities, boolean]> = [
  ["feel", true],
  ["decisionTable", true],
  ["businessKnowledgeModel", true],
  ["context", true],
  ["invocation", true],
];

/**
 * decision-layer — build plan 2.1 (ADR-0002). The Decision Engine SPI conformance gate: runs the
 * curated DMN-TCK subset (decision tables w/ UNIQUE hit policy, FEEL built-ins, BKM + invocation +
 * boxed context) through the reference engine (Drools 10.2.0) behind the engine-neutral SPI, and
 * asserts every case matches its expected outcome (`tck_cases_green == total`) with no evaluation
 * errors. It also asserts the engine's published capability descriptor — so the SPI's promise of an
 * interchangeable, capability-declared engine is machine-checked, not assumed. Run
 * `cd core && ./gradlew runDecisionTck` first to produce the results artifact.
 */
export const decisionLayerScope: Scope = {
  id: "decision-layer",
  description:
    "DMN-TCK subset conformance on the Decision Engine SPI reference engine (Drools) + capability-descriptor conformance.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      return [
        fail("decision-layer.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${JVM_COMMAND}\` to execute the TCK subset on the SPI engine`,
        }),
      ];
    }

    const results = JSON.parse(readFileSync(resultsPath, "utf8")) as Results;
    const checks: CheckResult[] = [];
    const caps = results.capabilities;

    checks.push(
      assert("decision-layer.engine", results.engine === "drools", {
        expected: "drools",
        actual: results.engine,
      }),
    );
    checks.push(
      assert("decision-layer.capability.dmn-1.6", caps.dmnSpecVersions.includes("20240513"), {
        expected: "dmnSpecVersions includes 20240513 (DMN 1.6)",
        actual: caps.dmnSpecVersions.join(","),
      }),
    );
    for (const [key, want] of EXPECTED_CAPS) {
      checks.push(
        assert(`decision-layer.capability.${key}`, caps[key] === want, {
          expected: `${key}=${want}`,
          actual: `${key}=${String(caps[key])}`,
        }),
      );
    }

    let green = 0;
    for (const c of results.cases) {
      const ok = !c.errors && valueMatches(c.kind, c.expect, c.actual);
      if (ok) green += 1;
      checks.push(
        assert(`decision-layer.tck.${c.id}`, ok, {
          expected: `${c.decision} = ${c.expect ?? "(none)"} (no errors)`,
          actual: c.errors ? `errored` : (c.actual ?? "(none)"),
        }),
      );
    }

    checks.push({
      id: "decision-layer.tck-cases-green",
      status: green === results.cases.length ? "pass" : "fail",
      metric: "tck_cases_green",
      value: green,
      threshold: results.cases.length,
    });

    return checks;
  },
};
