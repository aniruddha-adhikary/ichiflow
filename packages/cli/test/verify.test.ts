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
import { decisionRecordScope } from "../src/verify/scopes/decisionrecord.js";
import { entityStoreScope } from "../src/verify/scopes/entity-store.js";
import { entityApiScope } from "../src/verify/scopes/entity-api.js";
import { authzScope } from "../src/verify/scopes/authz.js";
import { uiScope } from "../src/verify/scopes/ui.js";
import { portalScope } from "../src/verify/scopes/portal.js";
import { adaptersScope } from "../src/verify/scopes/adapters.js";
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

describe("flow-layer scope (Phase 3.2)", () => {
  const validVector = {
    name: "vec-a",
    flow: {
      id: "vec-a",
      schemaVersion: "flow/v1",
      input: { vars: { x: 21 } },
      steps: [
        { id: "s1", type: "compute", ref: "ts://flow-kit/Double@1.0.0", in: ["x"], out: "x" },
        { id: "s2", type: "timer", durationMs: 2592000000 },
        { id: "s3", type: "compute", ref: "ts://flow-kit/Increment@1.0.0", in: ["x"], out: "x" },
      ],
    },
    expect: { vars: { x: 43 }, steps: 3, slaMs: 2592000000 },
  };
  const outcome = {
    name: "vec-a",
    flowId: "vec-a",
    vars: { x: 43 },
    expectedVars: { x: 43 },
    varsMatch: true,
    expectedSteps: 3,
    steps: 3,
    stepsMatch: true,
    expectedSlaMs: 2592000000,
    slaMs: 2592000000,
    slaMatch: true,
    traceStepIds: ["s1", "s2", "s3"],
    traceComplete: true,
    caseId: "conformance-vec-a",
    events: ["case.created", "case.resolved"],
    expectedEvents: null,
    eventsMatch: true,
    chainComplete: true,
    orphans: [],
    replays: [
      { attempt: 1, ok: true, error: null },
      { attempt: 2, ok: true, error: null },
    ],
    replayClean: true,
    fastForwarded: true,
    delegation: false,
    correlations: [],
    expectedCorrelations: null,
    correlationsMatch: true,
  };
  const delegationOutcome = {
    ...outcome,
    name: "vec-d",
    flowId: "vec-d",
    traceStepIds: ["screen"],
    expectedSteps: 1,
    steps: 1,
    delegation: true,
    correlations: [{ stepId: "screen", correlationId: "conformance-vec-d/screen" }],
    expectedCorrelations: [{ stepId: "screen", correlationId: "conformance-vec-d/screen" }],
    correlationsMatch: true,
  };
  const conformance = {
    sdk: "@temporalio",
    sdkVersion: "1.11.7",
    vectors: [outcome],
    vectorsGreen: 1,
    delegationVectorsGreen: 0,
    delegationVectorsTotal: 0,
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

  it("rejects an ill-formed vector (malformed unversioned code-activity ref) via the DSL schema", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      const bad = {
        ...validVector,
        flow: {
          ...validVector.flow,
          steps: [{ id: "s1", type: "compute", ref: "ts://flow-kit/Double", in: ["x"], out: "x" }],
        },
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
              vars: { x: 99 },
              varsMatch: false,
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

  it("fails a vector whose Case/Task event history diverges from the pinned sequence (§5.2)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp, {
        results: {
          ...conformance,
          vectorsGreen: 0,
          vectors: [
            {
              ...outcome,
              expectedEvents: ["case.created", "task.created", "task.resolved", "case.resolved"],
              events: ["case.created", "task.created", "task.escalated", "case.resolved"],
              eventsMatch: false,
            },
          ],
        },
      });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("flow-layer.vector.vec-a");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a vector with an empty case_id (a Case must carry a global case_id, §5.1)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp, {
        results: { ...conformance, vectors: [{ ...outcome, caseId: "" }] },
      });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const caseId = checks.find((c) => c.id === "flow-layer.case-id.vec-a")!;
      expect(caseId.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a vector whose assembled DecisionRecord has an orphan event (3.4 real-source completeness)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp, {
        results: {
          ...conformance,
          vectors: [
            {
              ...outcome,
              chainComplete: false,
              orphans: ["task.resolved@seq:3 for step s3 has no originating task.created"],
            },
          ],
        },
      });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const dr = checks.find((c) => c.id === "flow-layer.decisionrecord.vec-a")!;
      expect(dr.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("gates the external-task delegation family (delegation_vectors_green == total, Phase 5.2)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp, {
        results: {
          ...conformance,
          vectors: [outcome, delegationOutcome],
          vectorsGreen: 2,
          delegationVectorsGreen: 1,
          delegationVectorsTotal: 1,
        },
      });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const gate = checks.find((c) => c.id === "flow-layer.delegation-vectors-green")!;
      expect(gate.status).toBe("pass");
      expect(gate.metric).toBe("delegation_vectors_green");
      expect(gate.value).toBe(1);
      expect(gate.threshold).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails the delegation gate when a delegation vector misses its correlation oracle (Phase 5.2)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-flowlayer-"));
    try {
      setup(tmp, {
        results: {
          ...conformance,
          vectors: [{ ...delegationOutcome, correlationsMatch: false }],
          vectorsGreen: 0,
          delegationVectorsGreen: 0,
          delegationVectorsTotal: 1,
        },
      });
      const checks = flowLayerScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("flow-layer.vector.vec-d");
      expect(failed).toContain("flow-layer.delegation-vectors-green");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("decisionrecord scope (Phase 3.4)", () => {
  const validCase = {
    name: "case-a",
    result: {
      flowId: "case-a",
      caseId: "case-a-1",
      steps: 1,
      vars: { approved: 5 },
      slaMs: 0,
      trace: [
        {
          stepId: "review",
          type: "human-task",
          out: "approved",
          value: 5,
          resolution: "resolved",
          assignee: "ops-queue",
        },
      ],
      events: [
        { seq: 0, type: "case.created" },
        { seq: 1, type: "task.created", stepId: "review" },
        { seq: 2, type: "task.assigned", stepId: "review", assignee: "ops-queue" },
        { seq: 3, type: "task.resolved", stepId: "review" },
        { seq: 4, type: "case.resolved" },
      ],
    },
    expect: { chainComplete: true, orphans: [], decisions: 0, tasks: 1 },
  };
  const cleanOutcome = {
    name: "case-a",
    caseId: "case-a-1",
    chainComplete: true,
    expectedChainComplete: true,
    orphans: [],
    expectedOrphans: [],
    orphansMatch: true,
    decisions: 0,
    expectedDecisions: 0,
    tasks: 1,
    expectedTasks: 1,
    ok: true,
  };
  const orphanOutcome = {
    name: "case-b",
    caseId: "case-b-1",
    chainComplete: false,
    expectedChainComplete: false,
    orphans: ["task.resolved@seq:2 for step ghost has no originating task.created"],
    expectedOrphans: ["task.resolved@seq:2 for step ghost has no originating task.created"],
    orphansMatch: true,
    decisions: 0,
    expectedDecisions: 0,
    tasks: 1,
    expectedTasks: 1,
    ok: true,
  };
  const results = { cases: [cleanOutcome, orphanOutcome], casesGreen: 2, chainsComplete: 1 };
  const setup = (root: string, opts: { cases?: unknown[]; results?: unknown | null } = {}) => {
    const cdir = join(root, "schemas/decisionrecord/cases");
    mkdirSync(cdir, { recursive: true });
    const cases = opts.cases ?? [validCase];
    cases.forEach((c, i) => writeFileSync(join(cdir, `c${i}.case.json`), JSON.stringify(c)));
    if (opts.results !== null) {
      const rp = join(root, "packages/flow/build/decisionrecord-results.json");
      mkdirSync(dirname(rp), { recursive: true });
      writeFileSync(rp, JSON.stringify(opts.results ?? results));
    }
  };

  it("passes when cases are DSL-valid and each assembles to its pinned chain/orphan oracle", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dr-"));
    try {
      setup(tmp);
      const checks = decisionRecordScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const green = checks.find((c) => c.id === "decisionrecord.cases-green")!;
      expect(green.value).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects an ill-formed case fixture via the DecisionRecordCase schema", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dr-"));
    try {
      const bad = { ...validCase, result: { ...validCase.result, caseId: 123 } };
      setup(tmp, { cases: [bad] });
      const checks = decisionRecordScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      expect(
        checks.some((c) => c.id.startsWith("decisionrecord.dsl-valid.") && c.status === "fail"),
      ).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when a case's assembled orphans diverge from its pinned oracle", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dr-"));
    try {
      setup(tmp, {
        results: {
          ...results,
          casesGreen: 1,
          cases: [cleanOutcome, { ...orphanOutcome, orphansMatch: false, ok: false }],
        },
      });
      const checks = decisionRecordScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("decisionrecord.assembled.case-b-1");
      expect(failed).toContain("decisionrecord.cases-green");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when no negative fixture exercises the orphan detector (a clean-only suite proves nothing)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dr-"));
    try {
      setup(tmp, { results: { cases: [cleanOutcome], casesGreen: 1, chainsComplete: 1 } });
      const checks = decisionRecordScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const exercised = checks.find((c) => c.id === "decisionrecord.detector-exercised")!;
      expect(exercised.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the assembly artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-dr-"));
    try {
      setup(tmp, { results: null });
      const checks = decisionRecordScope.run({ repoRoot: tmp, seed: deriveSeed("f") });
      const present = checks.find((c) => c.id === "decisionrecord.assembly-present")!;
      expect(present.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("entity-store scope (Phase 4.1)", () => {
  const validVector = {
    name: "v0",
    entityType: "LoanApplication",
    ops: [
      {
        operation: "create",
        id: "app-1",
        caseId: "case-1",
        data: { applicant: "Alice", amount: 1000, productCode: "PERMIT-A", status: "submitted" },
      },
      { operation: "get", id: "app-1", expectVersion: 1, expect: { status: "submitted" } },
    ],
    expect: {
      audit: [{ operation: "create", id: "app-1", version: 1 }],
      outbox: [{ operation: "create", id: "app-1" }],
      outboxDeliveredAll: true,
    },
  };
  const okOutcome = {
    name: "v0",
    entityType: "LoanApplication",
    pass: true,
    detail: "ok",
    outboxSize: 1,
    delivered: 1,
  };
  const results = {
    vectors: [okOutcome],
    vectorsGreen: 1,
    total: 1,
    outboxDelivered: 1,
    outboxTotal: 1,
  };
  const setup = (root: string, opts: { vectors?: unknown[]; results?: unknown | null } = {}) => {
    const vdir = join(root, "schemas/entity-store/vectors");
    mkdirSync(vdir, { recursive: true });
    const vectors = opts.vectors ?? [validVector];
    vectors.forEach((v, i) => writeFileSync(join(vdir, `v${i}.vector.json`), JSON.stringify(v)));
    if (opts.results !== null) {
      const rp = join(root, "core/build/entity-store-results.json");
      mkdirSync(dirname(rp), { recursive: true });
      writeFileSync(rp, JSON.stringify(opts.results ?? results));
    }
  };

  it("passes when vectors are DSL-valid, payloads conform, and each round-trips with the outbox delivered", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-es-"));
    try {
      setup(tmp);
      const checks = entityStoreScope.run({ repoRoot: tmp, seed: deriveSeed("e") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const green = checks.find((c) => c.id === "entity-store.vectors-green")!;
      expect(green.value).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects an ill-formed vector via the EntityStoreVector schema", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-es-"));
    try {
      // Op is missing the required `operation` discriminator.
      const bad = { ...validVector, ops: [{ id: "app-1" }] };
      setup(tmp, { vectors: [bad] });
      const checks = entityStoreScope.run({ repoRoot: tmp, seed: deriveSeed("e") });
      expect(
        checks.some((c) => c.id.startsWith("entity-store.dsl-valid.") && c.status === "fail"),
      ).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects a payload that violates the schema-defined entity (boundary validation)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-es-"));
    try {
      // DSL-valid vector, but the entity payload has a bad status enum + missing fields.
      const bad = {
        ...validVector,
        ops: [{ operation: "create", id: "app-1", data: { applicant: "A", status: "bogus" } }],
      };
      setup(tmp, { vectors: [bad] });
      const checks = entityStoreScope.run({ repoRoot: tmp, seed: deriveSeed("e") });
      expect(
        checks.some((c) => c.id.startsWith("entity-store.entity-valid.") && c.status === "fail"),
      ).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a vector whose round-trip diverges from its pinned oracle", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-es-"));
    try {
      setup(tmp, {
        results: {
          ...results,
          vectorsGreen: 0,
          vectors: [
            {
              ...okOutcome,
              pass: false,
              detail: "audit[0] expected create/app-1/v1, got update/app-1/v2",
            },
          ],
        },
      });
      const checks = entityStoreScope.run({ repoRoot: tmp, seed: deriveSeed("e") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("entity-store.round-trip.v0");
      expect(failed).toContain("entity-store.vectors-green");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails outbox-delivered when the relay leaves records undelivered (transactional-outbox liveness)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-es-"));
    try {
      setup(tmp, {
        results: {
          ...results,
          vectors: [{ ...okOutcome, delivered: 0, outboxSize: 1 }],
          outboxDelivered: 0,
          outboxTotal: 1,
        },
      });
      const checks = entityStoreScope.run({ repoRoot: tmp, seed: deriveSeed("e") });
      const delivered = checks.find((c) => c.id === "entity-store.outbox-delivered")!;
      expect(delivered.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the results artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-es-"));
    try {
      setup(tmp, { results: null });
      const checks = entityStoreScope.run({ repoRoot: tmp, seed: deriveSeed("e") });
      const present = checks.find((c) => c.id === "entity-store.results-present")!;
      expect(present.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("entity-api scope (Phase 4.2)", () => {
  const validVector = {
    name: "v0",
    requests: [
      {
        method: "POST",
        path: "/loan-applications",
        body: {
          id: "app-1",
          applicant: "Ada",
          amount: 100,
          productCode: "P-HOME",
          status: "submitted",
        },
        expectStatus: 201,
        expectBodyId: "app-1",
        expectVersion: 1,
      },
    ],
  };
  const results = {
    vectorsGreen: 1,
    total: 1,
    operationsCovered: [
      "LoanApplications_create",
      "LoanApplications_list",
      "LoanApplications_read",
      "LoanApplications_remove",
      "LoanApplications_update",
    ],
    operationsDeclared: [
      "LoanApplications_create",
      "LoanApplications_list",
      "LoanApplications_read",
      "LoanApplications_remove",
      "LoanApplications_update",
      "Verify_status",
    ],
    boundaryRejections: 2,
    vectors: [
      {
        name: "v0",
        green: true,
        requests: [
          {
            method: "POST",
            path: "/loan-applications",
            operationId: "LoanApplications_create",
            status: 201,
            expectStatus: 201,
            conforms: true,
            ok: true,
            detail: "",
          },
        ],
      },
    ],
  };
  const setup = (root: string, opts: { vectors?: unknown[]; results?: unknown | null } = {}) => {
    const vdir = join(root, "schemas/entity-api/vectors");
    mkdirSync(vdir, { recursive: true });
    const vectors = opts.vectors ?? [validVector];
    vectors.forEach((v, i) => writeFileSync(join(vdir, `v${i}.vector.json`), JSON.stringify(v)));
    if (opts.results !== null) {
      const rp = join(root, "packages/api/build/api-contract-results.json");
      mkdirSync(dirname(rp), { recursive: true });
      writeFileSync(rp, JSON.stringify(opts.results ?? results));
    }
  };

  it("passes when vectors are DSL-valid, every response conforms, all ops covered, boundary rejects", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-api-"));
    try {
      setup(tmp);
      const checks = entityApiScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const green = checks.find((c) => c.id === "entity-api.vectors-green")!;
      expect(green.value).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects an ill-formed vector via the ApiContractVector schema", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-api-"));
    try {
      // Request missing the required `method`/`expectStatus`.
      const bad = { name: "v0", requests: [{ path: "/loan-applications" }] };
      setup(tmp, { vectors: [bad] });
      const checks = entityApiScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      expect(
        checks.some((c) => c.id.startsWith("entity-api.dsl-valid.") && c.status === "fail"),
      ).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a vector whose response diverges from the emitted contract or its pinned expectation", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-api-"));
    try {
      setup(tmp, {
        results: {
          ...results,
          vectorsGreen: 0,
          vectors: [
            {
              name: "v0",
              green: false,
              requests: [
                {
                  method: "POST",
                  path: "/loan-applications",
                  operationId: "LoanApplications_create",
                  status: 201,
                  expectStatus: 201,
                  conforms: false,
                  ok: false,
                  detail: "non-conforming response: /meta missing required property version",
                },
              ],
            },
          ],
        },
      });
      const checks = entityApiScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("entity-api.conforms.v0");
      expect(failed).toContain("entity-api.vectors-green");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails operations-covered when an entity operation is never exercised", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-api-"));
    try {
      setup(tmp, {
        results: { ...results, operationsCovered: ["LoanApplications_create"] },
      });
      const checks = entityApiScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      const covered = checks.find((c) => c.id === "entity-api.operations-covered")!;
      expect(covered.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails boundary-rejects when no malformed write is exercised", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-api-"));
    try {
      setup(tmp, { results: { ...results, boundaryRejections: 0 } });
      const checks = entityApiScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      const boundary = checks.find((c) => c.id === "entity-api.boundary-rejects")!;
      expect(boundary.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the results artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-api-"));
    try {
      setup(tmp, { results: null });
      const checks = entityApiScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      const present = checks.find((c) => c.id === "entity-api.results-present")!;
      expect(present.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("ui scope (Phase 4.5 — uischema)", () => {
  const validUi = {
    dataSchema: { id: "LoanApplication.json", version: "sha256:pinned" },
    layout: {
      type: "VerticalLayout",
      elements: [{ type: "Control", scope: "#/properties/applicant", label: "Applicant" }],
    },
  };
  const results = {
    dataSchemaId: "LoanApplication.json",
    dataSchemaVersion: "sha256:pinned",
    provenanceCurrent: true,
    scopeLint: { clean: true, controls: 1, dangling: [] },
    states: { required: 4, covered: 4 },
    axe: { storiesRun: 4, aaPass: 4, violations: [] },
    contrast: {
      total: 1,
      pass: 1,
      checks: [{ token: "text-body", kind: "text", ratio: 14.76, min: 4.5, pass: true }],
    },
    snapshots: { produced: 4, matched: 4, drift: [] },
  };
  const setup = (root: string, opts: { uiDoc?: unknown; results?: unknown | null } = {}): void => {
    const bdir = join(root, "schemas/ui/baseline");
    mkdirSync(bdir, { recursive: true });
    writeFileSync(
      join(bdir, "loan-application.uischema.json"),
      JSON.stringify(opts.uiDoc ?? validUi),
    );
    if (opts.results !== null) {
      const rp = join(root, "packages/uischema/build/ui-results.json");
      mkdirSync(dirname(rp), { recursive: true });
      writeFileSync(rp, JSON.stringify(opts.results ?? results));
    }
  };

  it("passes when the baseline is DSL-valid and every check family is green", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-ui-"));
    try {
      setup(tmp);
      const checks = uiScope.run({ repoRoot: tmp, seed: deriveSeed("ui") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const states = checks.find((c) => c.id === "ui.states-covered")!;
      expect(states.value).toBe(4);
      expect(states.threshold).toBe(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects an ill-formed baseline via the UiSchema contract", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-ui-"));
    try {
      // layout is required — a document without it is not a valid uischema.
      setup(tmp, { uiDoc: { dataSchema: { id: "LoanApplication.json", version: "x" } } });
      const checks = uiScope.run({ repoRoot: tmp, seed: deriveSeed("ui") });
      expect(checks.some((c) => c.id.startsWith("ui.dsl-valid.") && c.status === "fail")).toBe(
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("catches a dangling Control scope surfaced by the producer, with a fix-it hint", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-ui-"));
    try {
      setup(tmp, {
        results: {
          ...results,
          scopeLint: {
            clean: false,
            controls: 1,
            dangling: [
              {
                pointer: "#/properties/gone",
                file: "schemas/ui/baseline/loan-application.uischema.json",
                hint: "scope '#/properties/gone' does not resolve",
              },
            ],
          },
        },
      });
      const checks = uiScope.run({ repoRoot: tmp, seed: deriveSeed("ui") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("ui.scope-lint.#/properties/gone");
      expect(failed).toContain("ui.scope-lint-clean");
      const dangling = checks.find((c) => c.id === "ui.scope-lint.#/properties/gone")!;
      expect(dangling.artifact).toContain("loan-application.uischema.json");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails states-covered when a placed control is missing PDP-state stories", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-ui-"));
    try {
      setup(tmp, { results: { ...results, states: { required: 4, covered: 3 } } });
      const checks = uiScope.run({ repoRoot: tmp, seed: deriveSeed("ui") });
      const states = checks.find((c) => c.id === "ui.states-covered")!;
      expect(states.status).toBe("fail");
      expect(states.value).toBe(3);
      expect(states.threshold).toBe(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails axe-aa and names the offending story on a WCAG AA violation", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-ui-"));
    try {
      setup(tmp, {
        results: {
          ...results,
          axe: {
            storiesRun: 4,
            aaPass: 3,
            violations: [{ story: "applicant--error", ruleId: "label", impact: "critical" }],
          },
        },
      });
      const checks = uiScope.run({ repoRoot: tmp, seed: deriveSeed("ui") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("ui.a11y.applicant--error");
      expect(failed).toContain("ui.axe-aa");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails snapshots-matched when a regenerated snapshot drifts from its baseline", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-ui-"));
    try {
      setup(tmp, {
        results: {
          ...results,
          snapshots: {
            produced: 4,
            matched: 3,
            drift: [{ story: "amount--read-only", detail: "differs from committed baseline" }],
          },
        },
      });
      const checks = uiScope.run({ repoRoot: tmp, seed: deriveSeed("ui") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("ui.snapshot.amount--read-only");
      expect(failed).toContain("ui.snapshots-matched");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly with an actionable message when the results artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-ui-"));
    try {
      setup(tmp, { results: null });
      const checks = uiScope.run({ repoRoot: tmp, seed: deriveSeed("ui") });
      const present = checks.find((c) => c.id === "ui.results-present")!;
      expect(present.status).toBe("fail");
      expect(String(present.diff)).toContain("pnpm ui:preview");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("authz scope (Phase 4.3 — PDP slice)", () => {
  const model = {
    schemaVersion: "1.1",
    types: [
      {
        type: "artifact",
        relations: [{ name: "owner", rewrite: { direct: ["team"] } }],
      },
    ],
  };
  const vectors = [
    {
      name: "v-view",
      surface: "design-time",
      subject: "user:a",
      relation: "can_view",
      object: "artifact:x",
      expect: "allow",
    },
    {
      name: "v-edit",
      surface: "design-time",
      subject: "user:a",
      relation: "can_edit",
      object: "artifact:x",
      expect: "allow",
    },
    {
      name: "v-approve",
      surface: "design-time",
      subject: "user:a",
      relation: "can_approve",
      object: "artifact:x",
      expect: "deny",
    },
    {
      name: "v-modify",
      surface: "runtime",
      subject: "user:a",
      relation: "can_modify",
      object: "case:y",
      expect: "allow",
    },
  ];
  const log = vectors.map((v) => ({
    decisionId: `authz-${v.name}`,
    principal: v.subject,
    action: v.relation,
    resource: v.object,
    context: {},
    effect: v.expect,
    reason: "test reason",
  }));
  const results = {
    vectorsGreen: 4,
    total: 4,
    parityPass: true,
    designTimeCovered: 3,
    runtimeCovered: 1,
    decisionLogsComplete: true,
    vectors: vectors.map((v) => ({
      name: v.name,
      surface: v.surface,
      subject: v.subject,
      relation: v.relation,
      object: v.object,
      expect: v.expect,
      actual: v.expect,
      pass: true,
      parity: true,
      reason: "test reason",
    })),
    decisionLog: log,
  };
  const setup = (
    root: string,
    opts: { vectors?: unknown[]; results?: unknown | null; model?: unknown } = {},
  ) => {
    const vdir = join(root, "schemas/authz/vectors");
    mkdirSync(vdir, { recursive: true });
    writeFileSync(join(root, "schemas/authz/model.json"), JSON.stringify(opts.model ?? model));
    writeFileSync(join(vdir, "corpus.vectors.json"), JSON.stringify(opts.vectors ?? vectors));
    if (opts.results !== null) {
      const rp = join(root, "core/build/authz-results.json");
      mkdirSync(dirname(rp), { recursive: true });
      writeFileSync(rp, JSON.stringify(opts.results ?? results));
    }
  };

  it("passes when model + vectors are schema-valid, all green, both surfaces covered with parity, logs complete", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-authz-"));
    try {
      setup(tmp);
      const checks = authzScope.run({ repoRoot: tmp, seed: deriveSeed("z") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const green = checks.find((c) => c.id === "authz.vectors-green")!;
      expect(green.value).toBe(4);
      expect(checks.find((c) => c.id === "authz.parity")!.status).toBe("pass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects an ill-formed vector via the AuthzVector schema", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-authz-"));
    try {
      const bad = [{ name: "b", surface: "design-time", subject: "user:a", relation: "can_view" }];
      setup(tmp, { vectors: bad });
      const checks = authzScope.run({ repoRoot: tmp, seed: deriveSeed("z") });
      expect(checks.some((c) => c.id.startsWith("authz.dsl-valid.") && c.status === "fail")).toBe(
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when the corpus omits a required relation", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-authz-"));
    try {
      // Only can_view — missing can_edit / can_approve / can_modify.
      setup(tmp, { vectors: [vectors[0]] });
      const checks = authzScope.run({ repoRoot: tmp, seed: deriveSeed("z") });
      expect(checks.find((c) => c.id === "authz.relations-covered")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails the specific vector and the green gate when a decision diverges", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-authz-"));
    try {
      const diverged = {
        ...results,
        vectorsGreen: 3,
        vectors: results.vectors.map((v) =>
          v.name === "v-approve" ? { ...v, actual: "allow", pass: false } : v,
        ),
      };
      setup(tmp, { results: diverged });
      const checks = authzScope.run({ repoRoot: tmp, seed: deriveSeed("z") });
      const failed = checks.filter((c) => c.status !== "pass").map((c) => c.id);
      expect(failed).toContain("authz.decision.v-approve");
      expect(failed).toContain("authz.vectors-green");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails parity when the two enforcement surfaces disagree", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-authz-"));
    try {
      setup(tmp, { results: { ...results, parityPass: false } });
      const checks = authzScope.run({ repoRoot: tmp, seed: deriveSeed("z") });
      expect(checks.find((c) => c.id === "authz.parity")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when a decision-log entry is incomplete or missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-authz-"));
    try {
      setup(tmp, { results: { ...results, decisionLogsComplete: false } });
      const checks = authzScope.run({ repoRoot: tmp, seed: deriveSeed("z") });
      expect(checks.find((c) => c.id === "authz.decision-log-complete")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the results artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-authz-"));
    try {
      setup(tmp, { results: null });
      const checks = authzScope.run({ repoRoot: tmp, seed: deriveSeed("z") });
      expect(checks.find((c) => c.id === "authz.results-present")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("portal scope (Phase 4.4 — first Portal)", () => {
  const principals = [
    { id: "user:eve", crossTeam: false, expectedInbox: ["t-1", "t-2"] },
    { id: "user:pat", crossTeam: true, expectedInbox: ["t-3"] },
  ];
  const scenarios = [
    {
      principal: "user:eve",
      caseId: "case:c-1",
      expected: { applicantName: "read-only", decision: "editable" },
    },
    {
      principal: "user:iris",
      caseId: "case:c-1",
      expected: { decision: "read-only", reviewerNote: "hidden" },
    },
  ];
  const dataSchema = {
    type: "object",
    properties: { applicantName: {}, decision: {}, reviewerNote: {} },
  };
  const uischema = {
    type: "VerticalLayout",
    elements: [
      { type: "Control", scope: "#/properties/applicantName" },
      { type: "Control", scope: "#/properties/decision" },
      { type: "Control", scope: "#/properties/reviewerNote" },
    ],
  };
  const record = {
    caseId: "case:c-1",
    events: [
      { seq: 0, type: "case.created" },
      { seq: 1, type: "task.resolved", stepId: "review" },
    ],
    decisions: [{ stepId: "s1", decision: "threshold", outcomeType: "APPROVE", value: 1 }],
    tasks: [{ stepId: "review", assignee: "user:dan", resolution: "resolved", value: 1 }],
    outcome: { decision: 1 },
    orphans: [],
    chainComplete: true,
  };
  const results = {
    seed: "portal-4.4",
    inbox: [
      {
        principal: "user:eve",
        crossTeam: false,
        expected: ["t-1", "t-2"],
        visible: ["t-1", "t-2"],
        dueOrder: [100, 200],
        orderingOk: true,
      },
      {
        principal: "user:pat",
        crossTeam: true,
        expected: ["t-3"],
        visible: ["t-3"],
        dueOrder: [300],
        orderingOk: true,
      },
    ],
    crossTeam: {
      principal: "user:pat",
      baselinePrincipal: "user:eve",
      visibleCount: 1,
      baselineCount: 2,
      fewer: true,
    },
    signal: {
      emitted: true,
      principal: "user:eve",
      caseId: "case:c-1",
      payload: { afterMs: 0, stepId: "review", action: "resolve", value: 1 },
    },
    trace: {
      caseId: "case:c-1",
      chainComplete: true,
      nodeIds: ["event:0:case.created", "decision:s1", "task:review"],
      record,
    },
    fields: [
      {
        principal: "user:eve",
        caseId: "case:c-1",
        states: { applicantName: "read-only", decision: "editable", reviewerNote: "editable" },
      },
      {
        principal: "user:iris",
        caseId: "case:c-1",
        states: { applicantName: "read-only", decision: "read-only", reviewerNote: "hidden" },
      },
    ],
    uischema: { controls: 3, resolvedControls: 3, unresolved: [] },
  };
  const setup = (root: string, opts: { results?: unknown | null } = {}) => {
    const fdir = join(root, "packages/portal/fixtures");
    mkdirSync(fdir, { recursive: true });
    writeFileSync(join(fdir, "principals.json"), JSON.stringify(principals));
    writeFileSync(join(fdir, "field-scenarios.json"), JSON.stringify(scenarios));
    writeFileSync(join(fdir, "action.dataschema.json"), JSON.stringify(dataSchema));
    writeFileSync(join(fdir, "action.uischema.json"), JSON.stringify(uischema));
    if (opts.results !== null) {
      const rp = join(root, "packages/portal/build/portal-results.json");
      mkdirSync(dirname(rp), { recursive: true });
      writeFileSync(rp, JSON.stringify(opts.results ?? results));
    }
  };

  it("passes when rows are PDP-filtered + SLA-ordered, the signal validates, the trace renders, and entitlements match", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-portal-"));
    try {
      setup(tmp);
      const checks = portalScope.run({ repoRoot: tmp, seed: deriveSeed("p") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const rows = checks.find((c) => c.id === "portal.rows-visible")!;
      expect(rows.value).toBe(3);
      expect(checks.find((c) => c.id === "portal.cross-team-fewer")!.status).toBe("pass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("catches wrong PDP filtering (inbox diverges from the permitted id set)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-portal-"));
    try {
      const wrong = {
        ...results,
        inbox: [
          { ...results.inbox[0], visible: ["t-1", "t-2", "t-3"], dueOrder: [100, 200, 300] },
          results.inbox[1],
        ],
      };
      setup(tmp, { results: wrong });
      const checks = portalScope.run({ repoRoot: tmp, seed: deriveSeed("p") });
      expect(checks.find((c) => c.id === "portal.pdp-filtered.user:eve")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("catches bad SLA ordering while the id set is still correct", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-portal-"));
    try {
      const misordered = {
        ...results,
        inbox: [
          { ...results.inbox[0], visible: ["t-2", "t-1"], dueOrder: [200, 100] },
          results.inbox[1],
        ],
      };
      setup(tmp, { results: misordered });
      const checks = portalScope.run({ repoRoot: tmp, seed: deriveSeed("p") });
      expect(checks.find((c) => c.id === "portal.pdp-filtered.user:eve")!.status).toBe("pass");
      expect(checks.find((c) => c.id === "portal.sla-ordering.user:eve")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("catches a missing or schema-invalid Flow signal", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-portal-"));
    try {
      const badSignal = {
        ...results,
        signal: {
          ...results.signal,
          emitted: false,
          payload: { afterMs: -1, action: "resolve", value: 1 },
        },
      };
      setup(tmp, { results: badSignal });
      const checks = portalScope.run({ repoRoot: tmp, seed: deriveSeed("p") });
      expect(checks.find((c) => c.id === "portal.signal-emitted")!.status).toBe("fail");
      expect(checks.find((c) => c.id === "portal.signal-valid")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("catches wrong field entitlements (a hidden field rendered editable)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-portal-"));
    try {
      const leaked = {
        ...results,
        fields: [
          results.fields[0],
          {
            ...results.fields[1],
            states: { applicantName: "read-only", decision: "read-only", reviewerNote: "editable" },
          },
        ],
      };
      setup(tmp, { results: leaked });
      const checks = portalScope.run({ repoRoot: tmp, seed: deriveSeed("p") });
      expect(checks.find((c) => c.id === "portal.field-states.user:iris")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly when the results artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-portal-"));
    try {
      setup(tmp, { results: null });
      const checks = portalScope.run({ repoRoot: tmp, seed: deriveSeed("p") });
      expect(checks.find((c) => c.id === "portal.results-present")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("adapters scope (Phase 5.1)", () => {
  const mkMapping = (id: string, canonicalType: string) => ({
    id,
    schemaVersion: "adapter/v1",
    version: "1.0.0",
    direction: "inbound",
    kind: "Event",
    canonicalType,
    messageIdFrom: "/id",
    correlationFrom: "/corr",
    caseIdFrom: "/case",
    rules: [{ operation: "copy", from: "/x", to: "x" }],
  });
  const mkPort = (id: string, protocol: string, mapping: string, canonicalType: string) => ({
    id,
    schemaVersion: "adapter/v1",
    direction: "inbound",
    protocol,
    canonicalType,
    mapping,
    reliability: { maxAttempts: 3, dedup: true, dlq: true },
  });
  const mkGolden = (mappingId: string, canonicalType: string) => ({
    name: `golden-${mappingId}`,
    mappingId,
    wire: { id: "m", corr: "c", case: "k", x: 1 },
    expected: {
      kind: "Event",
      type: canonicalType,
      messageId: "m",
      correlationId: "c",
      caseId: "k",
      payload: { x: 1 },
    },
  });
  const bindings = [
    { id: "p-rest", protocol: "rest", mapping: "m-rest", type: "a.rest.v1" },
    { id: "p-broker", protocol: "broker", mapping: "m-broker", type: "a.broker.v1" },
    { id: "p-webhook", protocol: "webhook", mapping: "m-webhook", type: "a.webhook.v1" },
  ];
  const reliability = [
    {
      name: "dup",
      scenario: "duplicate",
      maxAttempts: 3,
      messages: [{ messageId: "a" }, { messageId: "a" }],
      expect: { applied: 1, deduped: 1, dlq: 0 },
    },
    {
      name: "poison",
      scenario: "poison",
      maxAttempts: 3,
      messages: [{ messageId: "p", poison: true }],
      expect: { applied: 0, deduped: 0, dlq: 1 },
    },
    {
      name: "redeliver",
      scenario: "redelivery",
      maxAttempts: 3,
      messages: [{ messageId: "r" }, { messageId: "r" }],
      expect: { applied: 1, deduped: 1, dlq: 0 },
    },
  ];
  const greenResults = {
    mappingsCount: 3,
    portsCount: 3,
    goldens: bindings.map((b) => ({
      name: `golden-${b.mapping}`,
      mappingId: b.mapping,
      match: true,
      error: null,
    })),
    goldensGreen: 3,
    bindings: bindings.map((b) => ({ protocol: b.protocol, inboundPorts: 1, covered: true })),
    bindingsCovered: true,
    bindingContract: bindings.map((b) => ({
      portId: b.id,
      protocol: b.protocol,
      roundTrips: true,
      error: null,
    })),
    bindingContractGreen: 3,
    reliability: reliability.map((r) => ({
      name: r.name,
      scenario: r.scenario,
      expected: r.expect,
      actual: r.expect,
      pass: true,
    })),
    reliabilityGreen: 3,
    dedupPass: true,
    dlqPass: true,
    redeliveryPass: true,
  };

  const setup = (root: string, opts: { results?: unknown | null } = {}) => {
    for (const [sub, suffix, docs] of [
      ["mappings", ".mapping.json", bindings.map((b) => mkMapping(b.mapping, b.type))],
      ["ports", ".port.json", bindings.map((b) => mkPort(b.id, b.protocol, b.mapping, b.type))],
      ["goldens", ".golden.json", bindings.map((b) => mkGolden(b.mapping, b.type))],
      ["reliability", ".vector.json", reliability],
    ] as const) {
      const dir = join(root, "schemas/adapters", sub);
      mkdirSync(dir, { recursive: true });
      docs.forEach((doc, i) => writeFileSync(join(dir, `f${i}${suffix}`), JSON.stringify(doc)));
    }
    if (opts.results !== null) {
      const rp = join(root, "packages/adapters/build/adapters-results.json");
      mkdirSync(dirname(rp), { recursive: true });
      writeFileSync(rp, JSON.stringify(opts.results ?? greenResults));
    }
  };

  it("passes when fixtures are schema-valid and the harness verdict is green", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-adapters-"));
    try {
      setup(tmp);
      const checks = adaptersScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      expect(checks.find((c) => c.id === "adapters.bindings-covered")!.status).toBe("pass");
      expect(checks.find((c) => c.id === "adapters.dedup")!.status).toBe("pass");
      expect(checks.find((c) => c.id === "adapters.dlq")!.status).toBe("pass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails visibly (with a producer fix-it hint) when the results artifact is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-adapters-"));
    try {
      setup(tmp, { results: null });
      const checks = adaptersScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      const present = checks.find((c) => c.id === "adapters.results-present")!;
      expect(present.status).toBe("fail");
      expect(String(present.diff)).toContain("@ichiflow/adapters");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails the golden + goldens-green checks on a mapping golden mismatch", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-adapters-"));
    try {
      const tampered = {
        ...greenResults,
        goldens: [
          { name: "g", mappingId: "m-rest", match: false, error: "output differs" },
          ...greenResults.goldens.slice(1),
        ],
        goldensGreen: 2,
      };
      setup(tmp, { results: tampered });
      const checks = adaptersScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      expect(checks.find((c) => c.id === "adapters.golden.m-rest")!.status).toBe("fail");
      expect(checks.find((c) => c.id === "adapters.goldens-green")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails the dedup / dlq checks when the reliability contract is not met", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-adapters-"));
    try {
      setup(tmp, { results: { ...greenResults, dedupPass: false, dlqPass: false } });
      const checks = adaptersScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      expect(checks.find((c) => c.id === "adapters.dedup")!.status).toBe("fail");
      expect(checks.find((c) => c.id === "adapters.dlq")!.status).toBe("fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails a contract check on a schema-invalid fixture", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ichiflow-adapters-"));
    try {
      setup(tmp);
      // Corrupt one port fixture: an unknown protocol is not in the AdapterProtocol enum.
      const bad = { ...mkPort("p-bad", "rest", "m-rest", "a.rest.v1"), protocol: "grpc" };
      writeFileSync(join(tmp, "schemas/adapters/ports", "f0.port.json"), JSON.stringify(bad));
      const checks = adaptersScope.run({ repoRoot: tmp, seed: deriveSeed("a") });
      expect(
        checks.some((c) => c.id.startsWith("adapters.contract.ports.") && c.status === "fail"),
      ).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
