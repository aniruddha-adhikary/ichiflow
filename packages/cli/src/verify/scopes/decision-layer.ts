import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const RESULTS_REL = "core/build/decision-tck-results.json";
const JVM_COMMAND = "cd core && ./gradlew runDecisionTck";
const COVERAGE_REL = "core/build/projection-coverage-results.json";
const COVERAGE_COMMAND = "cd core && ./gradlew runProjectionCoverage";
const TRACE_REL = "core/build/decision-trace-results.json";
const TRACE_COMMAND = "cd core && ./gradlew runDecisionTrace";
const TRACE_SCHEMA = "DecisionTrace.json";
const SCENARIO_REL = "core/build/scenario-coverage-results.json";
const SCENARIO_COMMAND = "cd core && ./gradlew runScenarioCoverage";
const FEEL_REL = "core/build/feel-vector-results.json";
const FEEL_COMMAND = "cd core && ./gradlew runFeelVectors";

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

interface ConstructResult {
  construct: string;
  decision: string;
  kind: string | null;
  expect: string | null;
  actual: string | null;
  errors: boolean;
  covered: boolean;
  message?: string;
}

interface CoverageResults {
  engine: string;
  engineVersion: string;
  suite: string;
  constructs: ConstructResult[];
}

interface TraceEntry {
  construct: string;
  trace: {
    model?: { engine?: string; engineVersion?: string; capabilities?: string[] };
    inputSnapshot?: Record<string, unknown>;
    firedDecisions?: unknown[];
    outputs?: Record<string, unknown>;
  };
}

interface TraceResults {
  engine: string;
  engineVersion: string;
  traces: TraceEntry[];
}

interface ScenarioCase {
  scenario: string;
  name: string;
  pass: boolean;
  detail: string;
}

interface ScenarioResults {
  decisionModel: string;
  coverageThreshold: number;
  coverage: number;
  coveredRows: number;
  totalRows: number;
  cases: ScenarioCase[];
}

interface FeelVectorResult {
  id: string;
  expect: string;
  actual: string | null;
  green: boolean;
}

interface FeelResults {
  engine: string;
  engineVersion: string;
  vectors: FeelVectorResult[];
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

    checks.push(...coverageChecks(repoRoot));
    checks.push(...traceShapeChecks(repoRoot));
    checks.push(...scenarioChecks(repoRoot));
    checks.push(...feelVectorChecks(repoRoot));

    return checks;
  },
};

/**
 * Scenario-suite + rule/row coverage (build plan 2.4, doc 03 §6). Runs the DecisionModel's governed
 * `Harness` on the reference engine: every business-readable case must produce its full typed
 * `Outcome` (`scenarios_pass == total`), and the suite must meet the model's declared rule/row
 * coverage threshold (`coverage_met`) — the governance signal a released model must satisfy.
 */
function scenarioChecks(repoRoot: string): CheckResult[] {
  const scenarioPath = join(repoRoot, SCENARIO_REL);
  if (!existsSync(scenarioPath)) {
    return [
      fail("decision-layer.scenarios-present", {
        diff: `missing ${SCENARIO_REL}; run \`${SCENARIO_COMMAND}\` to run the scenario suite on the SPI engine`,
      }),
    ];
  }

  const results = JSON.parse(readFileSync(scenarioPath, "utf8")) as ScenarioResults;
  const checks: CheckResult[] = [];
  let pass = 0;
  for (const c of results.cases) {
    if (c.pass) pass += 1;
    checks.push(
      assert(`decision-layer.scenario.${slug(c.scenario)}.${slug(c.name)}`, c.pass, {
        expected: "case produces its expected typed Outcome",
        actual: c.detail,
      }),
    );
  }

  checks.push({
    id: "decision-layer.scenarios-pass",
    status: pass === results.cases.length ? "pass" : "fail",
    metric: "scenarios_pass",
    value: pass,
    threshold: results.cases.length,
  });

  const coveragePct = Math.round(results.coverage * 100);
  const thresholdPct = Math.round(results.coverageThreshold * 100);
  checks.push({
    id: "decision-layer.coverage-met",
    status: results.coverage >= results.coverageThreshold ? "pass" : "fail",
    metric: "rule_row_coverage_pct",
    value: coveragePct,
    threshold: thresholdPct,
  });

  return checks;
}

/**
 * FEEL semantics-vector conformance (build plan 2.4; doc 13 §2.b). Each frozen interchange-ambiguity
 * vector must still evaluate to its pinned result on the reference engine (`feel_vectors_green ==
 * total`) — a KIE bump that silently shifts list-sort ordering or decimal rounding fails here.
 */
function feelVectorChecks(repoRoot: string): CheckResult[] {
  const feelPath = join(repoRoot, FEEL_REL);
  if (!existsSync(feelPath)) {
    return [
      fail("decision-layer.feel-vectors-present", {
        diff: `missing ${FEEL_REL}; run \`${FEEL_COMMAND}\` to evaluate the FEEL semantics vectors`,
      }),
    ];
  }

  const results = JSON.parse(readFileSync(feelPath, "utf8")) as FeelResults;
  const checks: CheckResult[] = [];
  let green = 0;
  for (const v of results.vectors) {
    if (v.green) green += 1;
    checks.push(
      assert(`decision-layer.feel.${v.id}`, v.green, {
        expected: v.expect,
        actual: v.actual ?? "(none)",
      }),
    );
  }

  checks.push({
    id: "decision-layer.feel-vectors-green",
    status: green === results.vectors.length ? "pass" : "fail",
    metric: "feel_vectors_green",
    value: green,
    threshold: results.vectors.length,
  });

  return checks;
}

/** Stable check-id token from a human-readable name. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
 * Trace-shape conformance (build plan 2.3, doc 03 §7): every `evaluate` must emit a valid
 * `DecisionTrace`. Validates each emitted trace against the frozen `DecisionTrace` JSON Schema and
 * asserts the DecisionRecord-critical fields are populated (model identity, input snapshot, fired
 * decisions). A malformed or absent trace is a failed check — the why API depends on this contract.
 */
function traceShapeChecks(repoRoot: string): CheckResult[] {
  const tracePath = join(repoRoot, TRACE_REL);
  if (!existsSync(tracePath)) {
    return [
      fail("decision-layer.trace-present", {
        diff: `missing ${TRACE_REL}; run \`${TRACE_COMMAND}\` to emit DecisionTrace objects`,
      }),
    ];
  }

  const ajv = buildAjv();
  const validate = ajv.getSchema(TRACE_SCHEMA);
  if (!validate) {
    return [
      fail("decision-layer.trace-schema-present", {
        diff: `emitted ${TRACE_SCHEMA} not found; run pnpm --filter @ichiflow/schemas build`,
      }),
    ];
  }

  const results = JSON.parse(readFileSync(tracePath, "utf8")) as TraceResults;
  const checks: CheckResult[] = [];
  let valid = 0;
  for (const entry of results.traces) {
    const t = entry.trace;
    const schemaValid = validate(t) === true;
    const fieldsPopulated =
      !!t.model?.engine &&
      !!t.model?.engineVersion &&
      (t.model?.capabilities?.length ?? 0) > 0 &&
      !!t.inputSnapshot &&
      (t.firedDecisions?.length ?? 0) > 0 &&
      !!t.outputs;
    const ok = schemaValid && fieldsPopulated;
    if (ok) valid += 1;
    checks.push(
      assert(`decision-layer.trace-shape.${entry.construct}`, ok, {
        expected: `valid DecisionTrace with model identity, input snapshot, fired decisions`,
        actual: schemaValid
          ? "schema-valid but a required field is empty"
          : ajv.errorsText(validate.errors),
      }),
    );
  }

  checks.push({
    id: "decision-layer.traces-valid",
    status: valid === results.traces.length ? "pass" : "fail",
    metric: "traces_valid",
    value: valid,
    threshold: results.traces.length,
  });

  return checks;
}

/**
 * Projection-coverage checks (build plan 2.2): every construct in the DMN feature matrix must
 * project one-way to DMN 1.6 and execute correctly on the reference engine. Asserts each construct is
 * covered plus the aggregate `constructs_covered == total`.
 */
function coverageChecks(repoRoot: string): CheckResult[] {
  const coveragePath = join(repoRoot, COVERAGE_REL);
  if (!existsSync(coveragePath)) {
    return [
      fail("decision-layer.coverage-present", {
        diff: `missing ${COVERAGE_REL}; run \`${COVERAGE_COMMAND}\` to project the feature matrix on the SPI engine`,
      }),
    ];
  }

  const coverage = JSON.parse(readFileSync(coveragePath, "utf8")) as CoverageResults;
  const checks: CheckResult[] = [];
  let covered = 0;
  for (const c of coverage.constructs) {
    if (c.covered) covered += 1;
    checks.push(
      assert(`decision-layer.projection.${c.construct}`, c.covered, {
        expected: `${c.decision} = ${c.expect ?? "(none)"} (projects + executes)`,
        actual: c.message ?? (c.errors ? "errored" : (c.actual ?? "(none)")),
      }),
    );
  }

  checks.push({
    id: "decision-layer.constructs-covered",
    status: covered === coverage.constructs.length ? "pass" : "fail",
    metric: "constructs_covered",
    value: covered,
    threshold: coverage.constructs.length,
  });

  return checks;
}
