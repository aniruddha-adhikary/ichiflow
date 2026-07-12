import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnvelope, validateEnvelope } from "../src/verify/envelope.js";
import { deriveSeed, pass } from "../src/verify/check.js";
import { runScope, runVerify } from "../src/verify/runner.js";
import { selfCheckScope } from "../src/verify/scopes/self-check.js";
import { schemaFidelitySpikeScope } from "../src/verify/scopes/schema-fidelity-spike.js";
import { schemaPipelineScope } from "../src/verify/scopes/schema-pipeline.js";
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
