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
      const checks = await decisionLayerScope.run({ repoRoot: tmp, seed: deriveSeed("dl") });
      expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
      const green = checks.find((c) => c.id === "decision-layer.tck-cases-green")!;
      expect(green.value).toBe(2);
      expect(green.threshold).toBe(2);
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
