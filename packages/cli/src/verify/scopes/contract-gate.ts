import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, fail } from "../check.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const CONTRACT_DIFF_REL = ".ichiflow/contract-diff.json";

/** One oasdiff breaking-change entry (a subset of oasdiff's `breaking -f json` object). */
interface BreakingChange {
  id: string;
  text?: string;
  level?: number;
  operation?: string;
  path?: string;
}

interface ContractDiffResults {
  breakingChanges: BreakingChange[];
}

/**
 * contract-gate — build plan chunk 1.4a (ADR-0006, open-q1). The OpenAPI contract of record may not
 * acquire breaking changes silently: an intentional break must be accepted deliberately via
 * `pnpm contract:accept` (which advances the committed baseline). oasdiff computes the breaking
 * changes between the baseline (`schemas/contract/openapi.baseline.yaml`) and the currently emitted
 * OpenAPI, writing them to a git-ignored results file (`pnpm contract:diff`). This scope reads that
 * file and asserts zero breaking changes; the shell never owns the verdict. Mirrors the external-tool
 * pattern of `schema-fidelity-spike` (a tool writes a results file; the scope asserts over it, and
 * fails with an actionable diff if the file is missing).
 */
export const contractGateScope: Scope = {
  id: "contract-gate",
  description:
    "OpenAPI contract has zero unaccepted breaking changes vs the released baseline (oasdiff); accept intentional changes with `pnpm contract:accept`.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const resultsPath = join(repoRoot, CONTRACT_DIFF_REL);
    if (!existsSync(resultsPath)) {
      return [
        fail("contract-gate.results-present", {
          diff: `missing ${CONTRACT_DIFF_REL}; run \`pnpm contract:diff\` to run oasdiff and produce the breaking-change results`,
        }),
      ];
    }

    const results = JSON.parse(readFileSync(resultsPath, "utf8")) as ContractDiffResults;
    const changes = results.breakingChanges ?? [];

    const summary =
      changes.length === 0
        ? "none"
        : changes
            .map((c) => `${c.id} @ ${c.operation ?? "?"} ${c.path ?? "?"}: ${c.text ?? ""}`)
            .join("; ");

    return [
      assert("contract-gate.no-breaking-changes", changes.length === 0, {
        expected: "0 breaking changes vs baseline",
        actual: `${changes.length} breaking change(s)`,
        diff: `unaccepted breaking changes: ${summary}. If intentional, run \`pnpm contract:accept\` and commit the updated baseline.`,
      }),
    ];
  },
};
