// oasdiff breaking-change gate producer (build plan chunk 1.4a, ADR-0006 / open-q1).
// Runs oasdiff to compute breaking changes between the released contract baseline and the
// currently emitted OpenAPI, and writes the machine-readable result to a git-ignored path. The
// verify `contract-gate` scope — not this shell script — owns the verdict: this script always
// writes the results and exits 0 in the normal case (even when breaking changes exist), and exits
// non-zero only when oasdiff itself fails to run (e.g. not installed).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const BASELINE_REL = "schemas/contract/openapi.baseline.yaml";
const CURRENT_REL = "schemas/generated/openapi3/openapi.yaml";
const OUTPUT_REL = ".ichiflow/contract-diff.json";

const baselinePath = join(repoRoot, BASELINE_REL);
const currentPath = join(repoRoot, CURRENT_REL);
const outputPath = join(repoRoot, OUTPUT_REL);

function oasdiffVersion() {
  try {
    return execFileSync("oasdiff", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

let breakingChanges;
try {
  // No --fail-on: oasdiff exits 0 whether or not there are breaking changes, so the verdict is
  // owned by the verify scope. `breaking` with `-f json` prints a JSON array of breaking changes.
  const stdout = execFileSync(
    "oasdiff",
    ["breaking", baselinePath, currentPath, "-f", "json"],
    { encoding: "utf8" },
  );
  breakingChanges = JSON.parse(stdout.trim() || "[]");
} catch (err) {
  // oasdiff itself failed to run (not installed, bad spec, etc.) — surface it clearly and fail.
  console.error(`contract:diff — oasdiff failed to run: ${err instanceof Error ? err.message : err}`);
  console.error(`Install the pinned oasdiff (see .ichiflow/resources.manifest.yaml) and retry.`);
  process.exit(2);
}

const results = {
  tool: "oasdiff",
  version: oasdiffVersion(),
  baseline: BASELINE_REL,
  current: CURRENT_REL,
  breakingChanges,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
console.log(
  `contract:diff — wrote ${OUTPUT_REL} (${breakingChanges.length} breaking change(s) vs ${BASELINE_REL}).`,
);
