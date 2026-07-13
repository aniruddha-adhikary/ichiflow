import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnvelope, validateEnvelope } from "../src/verify/envelope.js";
import { deriveSeed, pass } from "../src/verify/check.js";
import { runScope, runVerify } from "../src/verify/runner.js";
import { selfCheckScope } from "../src/verify/scopes/self-check.js";
import { schemaFidelitySpikeScope } from "../src/verify/scopes/schema-fidelity-spike.js";
import { schemaPipelineScope } from "../src/verify/scopes/schema-pipeline.js";
import { codegenScope } from "../src/verify/scopes/codegen.js";
import { contractVectorsScope } from "../src/verify/scopes/contract-vectors.js";
import { referenceDataScope } from "../src/verify/scopes/reference-data.js";
import { decisionLayerScope } from "../src/verify/scopes/decision-layer.js";
import { codeQualityScope } from "../src/verify/scopes/code-quality.js";
import {
  checkReferentialIntegrity,
  windowCovers,
  type CodeSetDoc,
} from "../src/verify/reference-data.js";
import { contractGateScope } from "../src/verify/scopes/contract-gate.js";
import { interpreterDeterminismSpikeScope } from "../src/verify/scopes/interpreter-determinism-spike.js";
import { flowLayerScope } from "../src/verify/scopes/flow-layer.js";
import { readScopeLedger } from "../src/verify/ledger.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

describe("verdict envelope", () => {
  it("builds a valid envelope that satisfies its own generated schema", () => {
    const env = buildEnvelope({
      scope: "unit",
      seed: deriveSeed("x"),
      ranAt: "2026-07-12T00:00:00.000Z",
      checks: [pass("a"), pass("b")],
    });
    expect(env.verdict).toBe("pass");
    expect(env.summary).toEqual({ checks: 2, passed: 2, failed: 0, skipped: 0 });
    expect(validateEnvelope(env).valid).toBe(true);
  });

  it("marks fail when any check fails", () => {
    const env = buildEnvelope({
      scope: "unit",
      seed: deriveSeed("x"),
      ranAt: "2026-07-12T00:00:00.000Z",
      checks: [pass("a"), { id: "b", status: "fail", diff: "nope" }],
    });
    expect(env.verdict).toBe("fail");
    expect(env.summary.failed).toBe(1);
  });

  it("rejects a malformed envelope (negative test)", () => {
    const bad = { verifyVersion: "1", scope: "x", flaky: "no" };
    expect(validateEnvelope(bad).valid).toBe(false);
  });
});

describe("self-check meta-harness", () => {
  it("is fully green", async () => {
    const env = await runScope(selfCheckScope, { repoRoot });
    expect(env.verdict).toBe("pass");
    expect(env.summary.failed).toBe(0);
    expect(env.summary.checks).toBeGreaterThanOrEqual(5);
    expect(env.flaky).toBe(false);
  });

  it("is deterministic — same seed across runs", async () => {
    const a = await runScope(selfCheckScope, { repoRoot });
    const b = await runScope(selfCheckScope, { repoRoot });
    expect(a.seed).toBe(b.seed);
    expect(a.checks.map((c) => c.id)).toEqual(b.checks.map((c) => c.id));
  });
});

describe("schema-fidelity-spike (Ajv side)", () => {
  it("matches every expected accept/reject verdict via Ajv", async () => {
    const checks = await schemaFidelitySpikeScope.run({ repoRoot, seed: deriveSeed("spike") });
    const tsChecks = checks.filter((c) => c.id.startsWith("spike.ts."));
    expect(tsChecks.length).toBeGreaterThanOrEqual(20);
    const tsFailures = tsChecks.filter((c) => c.status !== "pass");
    expect(tsFailures).toEqual([]);
  });
});

describe("schema-pipeline", () => {
  it("passes on the committed OpenAPI 3.1 + JSON Schema artifacts", async () => {
    const checks = await schemaPipelineScope.run({ repoRoot, seed: deriveSeed("pipeline") });
    const failures = checks.filter((c) => c.status !== "pass");
    expect(failures).toEqual([]);
    expect(checks.some((c) => c.id === "schema-pipeline.openapi.version-3.1")).toBe(true);
  });
});

describe("contract-gate", () => {
  const seed = deriveSeed("contract-gate");

  function withResults(results: unknown, fn: (root: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), "ichiflow-contract-"));
    try {
      mkdirSync(join(root, ".ichiflow"), { recursive: true });
      writeFileSync(join(root, ".ichiflow", "contract-diff.json"), JSON.stringify(results));
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("passes when the results file has no breaking changes", () => {
    withResults({ tool: "oasdiff", breakingChanges: [] }, (root) => {
      const checks = contractGateScope.run({ repoRoot: root, seed });
      expect(checks).toEqual([{ id: "contract-gate.no-breaking-changes", status: "pass" }]);
    });
  });

  it("fails when the results file lists breaking changes", () => {
    withResults(
      {
        tool: "oasdiff",
        breakingChanges: [
          {
            id: "api-path-removed-without-deprecation",
            text: "api path removed",
            operation: "GET",
            path: "/verify/{scope}",
            level: 3,
          },
        ],
      },
      (root) => {
        const checks = contractGateScope.run({ repoRoot: root, seed });
        const gate = checks.find((c) => c.id === "contract-gate.no-breaking-changes");
        expect(gate?.status).toBe("fail");
        expect(gate?.actual).toBe("1 breaking change(s)");
        expect(String(gate?.diff)).toContain("api-path-removed-without-deprecation");
      },
    );
  });

  it("fails with an actionable diff when the results file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ichiflow-contract-missing-"));
    try {
      const checks = contractGateScope.run({ repoRoot: root, seed });
      expect(checks).toHaveLength(1);
      expect(checks[0].id).toBe("contract-gate.results-present");
      expect(checks[0].status).toBe("fail");
      expect(String(checks[0].diff)).toContain("pnpm contract:diff");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("contract-vectors (Ajv side)", () => {
  it("matches every expected accept/reject verdict on the real contract via Ajv", async () => {
    const checks = await contractVectorsScope.run({ repoRoot, seed: deriveSeed("contract") });
    const tsChecks = checks.filter((c) => c.id.startsWith("contract.ts."));
    expect(tsChecks.length).toBeGreaterThanOrEqual(15);
    expect(tsChecks.filter((c) => c.status !== "pass")).toEqual([]);
  });
});

describe("reference-data scope", () => {
  it("passes on the committed CodeSet fixtures (schema + referential integrity)", async () => {
    const checks = await referenceDataScope.run({ repoRoot, seed: deriveSeed("reference-data") });
    expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(checks.some((c) => c.id === "reference-data.graph.no-dangling")).toBe(true);
  });
});

describe("referential-integrity engine", () => {
  const countries = (rows: CodeSetDoc["rows"]): CodeSetDoc => ({
    kind: "CodeSet",
    metadata: {
      id: "countries",
      version: "1.0.0",
      governanceState: "released",
      effective: { from: "2026-01-01", to: null },
    },
    rows,
  });
  const referrer = (
    ref: { code: string; codeSet: string },
    effective = { from: "2026-08-01", to: null } as const,
  ): CodeSetDoc => ({
    kind: "CodeSet",
    metadata: { id: "natures", version: "1.0.0", governanceState: "released", effective },
    rows: [{ code: "N1", codeRefs: { country: ref } }],
  });

  it("resolves a live, in-window reference", () => {
    const { checks } = checkReferentialIntegrity([
      countries([{ code: "XA" }]),
      referrer({ code: "XA", codeSet: "countries@1.0.0" }),
    ]);
    const c = checks.find((x) => x.from.includes("natures"))!;
    expect(c.resolves).toBe(true);
    expect(c.effectiveCovered).toBe(true);
  });

  it("flags a dangling reference to a missing code", () => {
    const { checks } = checkReferentialIntegrity([
      countries([{ code: "XA" }]),
      referrer({ code: "NOPE", codeSet: "countries@1.0.0" }),
    ]);
    expect(checks[0].resolves).toBe(false);
    expect(checks[0].effectiveCovered).toBeNull();
  });

  it("refuses a reference to a deprecated (non-live) row", () => {
    const { checks } = checkReferentialIntegrity([
      countries([{ code: "XA", deprecated: true }]),
      referrer({ code: "XA", codeSet: "countries@1.0.0" }),
    ]);
    expect(checks[0].resolves).toBe(false);
    expect(checks[0].resolveDetail).toContain("deprecated");
  });

  it("flags a reference whose window is not covered by the target", () => {
    const { checks } = checkReferentialIntegrity([
      countries([{ code: "XA", effective: { from: "2027-01-01", to: null } }]),
      referrer({ code: "XA", codeSet: "countries@1.0.0" }, { from: "2026-08-01", to: null }),
    ]);
    expect(checks[0].resolves).toBe(true);
    expect(checks[0].effectiveCovered).toBe(false);
  });

  it("windowCovers is bitemporal (open-ended target covers, bounded target does not)", () => {
    expect(windowCovers({ from: "2026-01-01", to: null }, { from: "2026-08-01", to: null })).toBe(
      true,
    );
    expect(
      windowCovers({ from: "2026-01-01", to: "2026-12-31" }, { from: "2026-08-01", to: null }),
    ).toBe(false);
    expect(
      windowCovers(
        { from: "2026-01-01", to: "2026-12-31" },
        { from: "2026-08-01", to: "2026-10-01" },
      ),
    ).toBe(true);
  });
});

describe("codegen", () => {
  it("confirms both generated edges cover every OpenAPI component schema", async () => {
    const checks = await codegenScope.run({ repoRoot, seed: deriveSeed("codegen") });
    const failures = checks.filter((c) => c.status !== "pass");
    expect(failures).toEqual([]);
    expect(checks.some((c) => c.id === "codegen.ts.covers-contract")).toBe(true);
    expect(checks.some((c) => c.id === "codegen.kotlin.covers-contract")).toBe(true);
    expect(checks.some((c) => c.id === "codegen.canonical-model-parity")).toBe(true);
  });
});

describe("decision-layer scope (DMN-TCK subset conformance)", () => {
  const goodCaps = {
    engineId: "drools",
    engineVersion: "10.2.0",
    dmnSpecVersions: ["20240513"],
    feel: true,
    decisionTable: true,
    businessKnowledgeModel: true,
    context: true,
    invocation: true,
  };
  const writeResults = (root: string, body: unknown) => {
    const p = join(root, "core/build/decision-tck-results.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(body));
  };
  const writeCoverage = (root: string, body: unknown) => {
    const p = join(root, "core/build/projection-coverage-results.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(body));
  };
  const writeTrace = (root: string, body: unknown) => {
    const p = join(root, "core/build/decision-trace-results.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(body));
  };
  const writeScenario = (root: string, body: unknown) => {
    const p = join(root, "core/build/scenario-coverage-results.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(body));
  };
  const writeFeel = (root: string, body: unknown) => {
    const p = join(root, "core/build/feel-vector-results.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(body));
  };
  const validTrace = {
    model: {
      id: "literal",
      engine: "drools",
      engineVersion: "10.2.0",
      capabilities: ["feel", "decisionTable"],
    },
    inputSnapshot: { N: 21 },
    firedDecisions: [
      { decisionId: "decResult", decisionName: "Result", result: 42, succeeded: true },
    ],
    intermediateValues: {},
    outputs: { Result: 42 },
    referenceData: [],
    authorityAttribution: {},
    hasErrors: false,
    messages: [],
  };
  const goodTrace = {
    engine: "drools",
    engineVersion: "10.2.0",
    traces: [{ construct: "literalExpression", trace: validTrace }],
  };
  const goodScenario = {
    decisionModel: "loan-eligibility@3.2.0",
    coverageThreshold: 0.8,
    coverage: 1.0,
    coveredRows: 5,
    totalRows: 5,
    cases: [
      { scenario: "S", name: "low DTI -> approve", pass: true, detail: "ok" },
      { scenario: "S", name: "high DTI -> deny", pass: true, detail: "ok" },
    ],
  };
  const goodFeel = {
    engine: "drools",
    engineVersion: "10.2.0",
    vectors: [
      { id: "sort-ascending", expect: "[1, 2, 3]", actual: "[1, 2, 3]", green: true },
      { id: "decimal-half-even", expect: "0.12", actual: "0.12", green: true },
    ],
  };
  const goodCoverage = {
    engine: "drools",
    engineVersion: "10.2.0",
    suite: "cov",
    constructs: [
      {
        construct: "literalExpression",
        decision: "R",
        kind: "number",
        expect: "42",
        actual: "42",
        errors: false,
        covered: true,
      },
      {
        construct: "relation",
        decision: "Rows",
        kind: "list",
        expect: "[{a=1}]",
        actual: "[{a=1}]",
        errors: false,
        covered: true,
      },
    ],
  };

  it("passes when every TCK case matches and capabilities conform", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      writeResults(tmp, {
        engine: "drools",
        engineVersion: "10.2.0",
        suite: "s",
        capabilities: goodCaps,
        cases: [
          {
            id: "a",
            model: "m",
            decision: "D",
            kind: "string",
            expect: "A",
            actual: "A",
            errors: false,
          },
          {
            id: "b",
            model: "m",
            decision: "D",
            kind: "number",
            expect: "80",
            actual: "80.0",
            errors: false,
          },
        ],
      });
      writeCoverage(tmp, goodCoverage);
      writeTrace(tmp, goodTrace);
      writeScenario(tmp, goodScenario);
      writeFeel(tmp, goodFeel);
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const green = checks.find((c) => c.id === "decision-layer.tck-cases-green")!;
      expect(green.value).toBe(2);
      expect(green.threshold).toBe(2);
      const covered = checks.find((c) => c.id === "decision-layer.constructs-covered")!;
      expect(covered.value).toBe(2);
      expect(covered.threshold).toBe(2);
      const traces = checks.find((c) => c.id === "decision-layer.traces-valid")!;
      expect(traces.value).toBe(1);
      expect(traces.threshold).toBe(1);
      const scenarios = checks.find((c) => c.id === "decision-layer.scenarios-pass")!;
      expect(scenarios.value).toBe(2);
      expect(scenarios.threshold).toBe(2);
      const coverageMet = checks.find((c) => c.id === "decision-layer.coverage-met")!;
      expect(coverageMet.value).toBe(100);
      expect(coverageMet.threshold).toBe(80);
      const feel = checks.find((c) => c.id === "decision-layer.feel-vectors-green")!;
      expect(feel.value).toBe(2);
      expect(feel.threshold).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails the uncovered construct and the constructs-covered aggregate", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      writeResults(tmp, {
        engine: "drools",
        engineVersion: "10.2.0",
        suite: "s",
        capabilities: goodCaps,
        cases: [],
      });
      writeCoverage(tmp, {
        ...goodCoverage,
        constructs: [
          goodCoverage.constructs[0],
          {
            construct: "relation",
            decision: "Rows",
            kind: "list",
            expect: "[{a=1}]",
            actual: null,
            errors: true,
            covered: false,
            message: "RuntimeException: boom",
          },
        ],
      });
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("decision-layer.projection.relation");
      expect(failed).toContain("decision-layer.constructs-covered");
      expect(failed).not.toContain("decision-layer.projection.literalExpression");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the projection-coverage artifact is missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      writeResults(tmp, {
        engine: "drools",
        engineVersion: "10.2.0",
        suite: "s",
        capabilities: goodCaps,
        cases: [],
      });
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const present = checks.find((c) => c.id === "decision-layer.coverage-present")!;
      expect(present.status).toBe("fail");
      expect(String(present.diff)).toContain("runProjectionCoverage");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a case whose result mismatches or errors, and a missing capability", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      writeResults(tmp, {
        engine: "drools",
        engineVersion: "10.2.0",
        suite: "s",
        capabilities: { ...goodCaps, invocation: false },
        cases: [
          {
            id: "wrong",
            model: "m",
            decision: "D",
            kind: "string",
            expect: "A",
            actual: "B",
            errors: false,
          },
          {
            id: "errored",
            model: "m",
            decision: "D",
            kind: "string",
            expect: "A",
            actual: null,
            errors: true,
          },
        ],
      });
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("decision-layer.capability.invocation");
      expect(failed).toContain("decision-layer.tck.wrong");
      expect(failed).toContain("decision-layer.tck.errored");
      expect(failed).toContain("decision-layer.tck-cases-green");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly with an actionable message when the artifact is missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      expect(checks).toHaveLength(1);
      expect(checks[0].id).toBe("decision-layer.results-present");
      expect(String(checks[0].diff)).toContain("runDecisionTck");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  const seedForTrace = (root: string) => {
    writeResults(root, {
      engine: "drools",
      engineVersion: "10.2.0",
      suite: "s",
      capabilities: goodCaps,
      cases: [],
    });
    writeCoverage(root, { ...goodCoverage, constructs: [] });
  };

  it("passes trace-shape and the traces-valid aggregate when every emitted trace is well-formed", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      writeTrace(tmp, goodTrace);
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const shape = checks.find((c) => c.id === "decision-layer.trace-shape.literalExpression")!;
      expect(shape.status).toBe("pass");
      const agg = checks.find((c) => c.id === "decision-layer.traces-valid")!;
      expect(agg.status).toBe("pass");
      expect(agg.value).toBe(1);
      expect(agg.threshold).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a schema-invalid trace (missing model identity) and the traces-valid aggregate", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      const noModel: Partial<typeof validTrace> = { ...validTrace };
      delete noModel.model;
      writeTrace(tmp, {
        engine: "drools",
        engineVersion: "10.2.0",
        traces: [{ construct: "literalExpression", trace: noModel }],
      });
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("decision-layer.trace-shape.literalExpression");
      expect(failed).toContain("decision-layer.traces-valid");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a schema-valid trace that is missing DecisionRecord-critical fields (no fired decisions)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      writeTrace(tmp, {
        engine: "drools",
        engineVersion: "10.2.0",
        traces: [{ construct: "empty", trace: { ...validTrace, firedDecisions: [] } }],
      });
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const shape = checks.find((c) => c.id === "decision-layer.trace-shape.empty")!;
      expect(shape.status).toBe("fail");
      expect(String(shape.actual)).toContain("required field is empty");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the decision-trace artifact is missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const present = checks.find((c) => c.id === "decision-layer.trace-present")!;
      expect(present.status).toBe("fail");
      expect(String(present.diff)).toContain("runDecisionTrace");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes scenarios-pass and the coverage gate when the suite is green and coverage is met", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      writeScenario(tmp, goodScenario);
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const pass = checks.find((c) => c.id === "decision-layer.scenarios-pass")!;
      expect(pass.status).toBe("pass");
      expect(pass.value).toBe(2);
      const cov = checks.find((c) => c.id === "decision-layer.coverage-met")!;
      expect(cov.status).toBe("pass");
      expect(cov.value).toBe(100);
      expect(cov.threshold).toBe(80);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a failing scenario case and the scenarios-pass aggregate", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      writeScenario(tmp, {
        ...goodScenario,
        cases: [
          {
            scenario: "S",
            name: "wrong outcome",
            pass: false,
            detail: "type expected deny, got approve",
          },
        ],
      });
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("decision-layer.scenario.s.wrong-outcome");
      expect(failed).toContain("decision-layer.scenarios-pass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails the coverage gate when coverage is below the declared threshold", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      writeScenario(tmp, { ...goodScenario, coverage: 0.6, coveredRows: 3 });
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const cov = checks.find((c) => c.id === "decision-layer.coverage-met")!;
      expect(cov.status).toBe("fail");
      expect(cov.value).toBe(60);
      expect(cov.threshold).toBe(80);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the scenario-coverage artifact is missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const present = checks.find((c) => c.id === "decision-layer.scenarios-present")!;
      expect(present.status).toBe("fail");
      expect(String(present.diff)).toContain("runScenarioCoverage");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes feel-vectors-green when every vector matches its pin", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      writeFeel(tmp, goodFeel);
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const agg = checks.find((c) => c.id === "decision-layer.feel-vectors-green")!;
      expect(agg.status).toBe("pass");
      expect(agg.value).toBe(2);
      expect(agg.threshold).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a drifted FEEL vector and the feel-vectors-green aggregate", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      writeFeel(tmp, {
        ...goodFeel,
        vectors: [{ id: "sort-ascending", expect: "[1, 2, 3]", actual: "[3, 2, 1]", green: false }],
      });
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("decision-layer.feel.sort-ascending");
      expect(failed).toContain("decision-layer.feel-vectors-green");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the FEEL-vector artifact is missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dl-"));
    try {
      seedForTrace(tmp);
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      const present = checks.find((c) => c.id === "decision-layer.feel-vectors-present")!;
      expect(present.status).toBe("fail");
      expect(String(present.diff)).toContain("runFeelVectors");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("code-quality scope (detekt + ArchUnit gate)", () => {
  const seedRepo = (
    root: string,
    opts: { detektFindings?: number; archViolation?: boolean; wired?: boolean },
  ) => {
    const gradle =
      opts.wired === false
        ? 'plugins { kotlin("jvm") }'
        : 'plugins { id("io.gitlab.arturbosch.detekt") }\ndependencies { testImplementation("com.tngtech.archunit:archunit-junit5:1.3.0") }';
    const gradlePath = join(root, "core/build.gradle.kts");
    mkdirSync(dirname(gradlePath), { recursive: true });
    writeFileSync(gradlePath, gradle);

    const sarifPath = join(root, "core/build/reports/detekt/detekt.sarif");
    mkdirSync(dirname(sarifPath), { recursive: true });
    const results = Array.from({ length: opts.detektFindings ?? 0 }, (_, i) => ({
      ruleId: `Rule${i}`,
      message: { text: "finding" },
      locations: [
        { physicalLocation: { artifactLocation: { uri: "X.kt" }, region: { startLine: i } } },
      ],
    }));
    writeFileSync(sarifPath, JSON.stringify({ runs: [{ results }] }));

    const archPath = join(root, "core/build/arch-rules-results.json");
    writeFileSync(
      archPath,
      JSON.stringify({
        suite: "archunit",
        rules: 1,
        results: [
          {
            id: "spi.boundary.kie-confined-to-spi",
            passed: !opts.archViolation,
            violations: opts.archViolation ? ["v"] : [],
          },
        ],
      }),
    );
  };

  it("passes with zero detekt findings and all ArchUnit rules green", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-cq-"));
    try {
      seedRepo(tmp, {});
      const checks = await codeQualityScope.run({ repoRoot: tmp, seed: deriveSeed("cq") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      expect(checks.some((c) => c.id === "code-quality.detekt.zero-findings")).toBe(true);
      expect(
        checks.some((c) => c.id === "code-quality.archunit.spi.boundary.kie-confined-to-spi"),
      ).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails on detekt findings, an ArchUnit violation, or unwired gates", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-cq-"));
    try {
      seedRepo(tmp, { detektFindings: 2, archViolation: true, wired: false });
      const checks = await codeQualityScope.run({ repoRoot: tmp, seed: deriveSeed("cq") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("code-quality.detekt.zero-findings");
      expect(failed).toContain("code-quality.archunit.spi.boundary.kie-confined-to-spi");
      expect(failed).toContain("code-quality.wiring.detekt-plugin");
      expect(failed).toContain("code-quality.wiring.archunit-dep");
      const detekt = checks.find((c) => c.id === "code-quality.detekt.zero-findings")!;
      expect(detekt.value).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("full verify", () => {
  it("runs every registered scope and writes the ledger", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-ledger-"));
    try {
      // Point at a scratch repoRoot so ledger writes are isolated; agent-kit checks will fail there,
      // which is expected — we assert the ledger machinery, not agent-kit greenness here.
      const result = await runVerify({ repoRoot, writeLedger: false });
      expect(result.envelopes.length).toBeGreaterThanOrEqual(2);
      const selfCheck = result.envelopes.find((e) => e.scope === "self-check");
      expect(selfCheck?.verdict).toBe("pass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes and reads back a ledger entry", async () => {
    await runScope(selfCheckScope, { repoRoot, writeLedger: true });
    const ledger = readScopeLedger(repoRoot, "self-check");
    expect(ledger?.latest.scope).toBe("self-check");
    expect(ledger?.history.length).toBeGreaterThanOrEqual(1);
  });
});

describe("interpreter-determinism-spike scope (Phase 3.0)", () => {
  const goodSpike = {
    sdk: "@temporalio",
    sdkVersion: "1.11.7",
    flowId: "toy-3step",
    steps: 3,
    expected: 43,
    result: 43,
    resultCorrect: true,
    secondResult: 43,
    resultsIdentical: true,
    replays: [
      { attempt: 1, ok: true, error: null },
      { attempt: 2, ok: true, error: null },
    ],
    replayClean: true,
    historyEvents: 22,
    sla: { scheduledMs: 2592000000, wallMs: 102, fastForwarded: true },
  };
  const write = (root: string, body: unknown) => {
    const p = join(root, "packages/flow/build/interpreter-spike-results.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(body));
  };

  it("passes when replay is clean, result is stable, and the SLA timer fast-forwards", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flow-"));
    try {
      write(tmp, goodSpike);
      const checks = interpreterDeterminismSpikeScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const clean = checks.find((c) => c.id === "interpreter-determinism-spike.replay-clean")!;
      expect(clean.value).toBe(2);
      expect(clean.threshold).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a determinism violation on replay and the replay-clean aggregate", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flow-"));
    try {
      write(tmp, {
        ...goodSpike,
        replayClean: false,
        replays: [
          { attempt: 1, ok: true, error: null },
          { attempt: 2, ok: false, error: "DeterminismViolationError: command mismatch" },
        ],
      });
      const checks = interpreterDeterminismSpikeScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("interpreter-determinism-spike.replay-clean.2");
      expect(failed).toContain("interpreter-determinism-spike.replay-clean");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when the SLA timer did not fast-forward", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flow-"));
    try {
      write(tmp, {
        ...goodSpike,
        sla: { scheduledMs: 2592000000, wallMs: 2592000000, fastForwarded: false },
      });
      const checks = interpreterDeterminismSpikeScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const ff = checks.find((c) => c.id === "interpreter-determinism-spike.sla-fast-forwarded")!;
      expect(ff.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a drifted result and an unpinned SDK", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flow-"));
    try {
      write(tmp, {
        ...goodSpike,
        sdkVersion: "1.10.0",
        result: 99,
        resultCorrect: false,
        secondResult: 43,
        resultsIdentical: false,
      });
      const checks = interpreterDeterminismSpikeScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("interpreter-determinism-spike.sdk-pinned");
      expect(failed).toContain("interpreter-determinism-spike.result-correct");
      expect(failed).toContain("interpreter-determinism-spike.results-identical");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the spike artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flow-"));
    try {
      const checks = interpreterDeterminismSpikeScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const present = checks.find((c) => c.id === "interpreter-determinism-spike.results-present")!;
      expect(present.status).toBe("fail");
      expect(String(present.diff)).toContain("determinism harness");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("flow-layer scope (Phase 3.1)", () => {
  const validVector = {
    name: "vec-a",
    flow: {
      id: "vec-a",
      schemaVersion: "flow/v1",
      input: { value: 21 },
      steps: [
        { id: "s1", type: "compute", op: "double" },
        { id: "s2", type: "timer", durationMs: 2592000000 },
        { id: "s3", type: "compute", op: "inc" },
      ],
    },
    expect: { result: 43, steps: 3, slaMs: 2592000000 },
  };
  const outcome = {
    name: "vec-a",
    flowId: "vec-a",
    expected: 43,
    result: 43,
    correct: true,
    expectedSteps: 3,
    steps: 3,
    stepsMatch: true,
    expectedSlaMs: 2592000000,
    slaMs: 2592000000,
    slaMatch: true,
    replays: [
      { attempt: 1, ok: true, error: null },
      { attempt: 2, ok: true, error: null },
    ],
    replayClean: true,
    fastForwarded: true,
  };
  const conformance = {
    sdk: "@temporalio",
    sdkVersion: "1.11.7",
    vectors: [outcome],
    vectorsGreen: 1,
    determinismClean: true,
  };
  const setup = (root: string, opts: { vectors?: unknown[]; results?: unknown | null } = {}) => {
    const vdir = join(root, "schemas/flow/vectors");
    mkdirSync(vdir, { recursive: true });
    const vectors = opts.vectors ?? [validVector];
    vectors.forEach((v, i) => writeFileSync(join(vdir, `v${i}.vector.json`), JSON.stringify(v)));
    if (opts.results !== null) {
      const rp = join(root, "packages/flow/build/flow-conformance-results.json");
      mkdirSync(dirname(rp), { recursive: true });
      writeFileSync(rp, JSON.stringify(opts.results ?? conformance));
    }
  };

  it("passes when vectors are DSL-valid and each interprets to its oracle with clean replay", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp);
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const green = checks.find((c) => c.id === "flow-layer.vectors-green")!;
      expect(green.value).toBe(1);
      expect(green.threshold).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects an ill-formed vector (unknown compute op) via the DSL schema", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      const bad = {
        ...validVector,
        flow: { ...validVector.flow, steps: [{ id: "s1", type: "compute", op: "triple" }] },
      };
      setup(tmp, { vectors: [bad] });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      expect(
        checks.some((c) => c.id.startsWith("flow-layer.dsl-valid.") && c.status === "fail"),
      ).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the conformance artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp, { results: null });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const present = checks.find((c) => c.id === "flow-layer.conformance-present")!;
      expect(present.status).toBe("fail");
      expect(String(present.diff)).toContain("conformance harness");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when a committed vector is not covered by the artifact (stale verdict)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp, {
        vectors: [
          validVector,
          { ...validVector, name: "vec-b", flow: { ...validVector.flow, id: "vec-b" } },
        ],
      });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const covered = checks.find((c) => c.id === "flow-layer.vectors-covered")!;
      expect(covered.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a drifted result and a determinism violation", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp, {
        results: {
          ...conformance,
          vectorsGreen: 0,
          determinismClean: false,
          vectors: [
            {
              ...outcome,
              result: 99,
              correct: false,
              replayClean: false,
              replays: [
                { attempt: 1, ok: true, error: null },
                { attempt: 2, ok: false, error: "DeterminismViolationError" },
              ],
            },
          ],
        },
      });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("flow-layer.vector.vec-a");
      expect(failed).toContain("flow-layer.determinism.vec-a");
      expect(failed).toContain("flow-layer.vectors-green");
      expect(failed).toContain("flow-layer.determinism-clean");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
