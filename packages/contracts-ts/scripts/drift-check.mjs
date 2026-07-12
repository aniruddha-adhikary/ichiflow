// Regenerate-and-diff drift check for the generated TypeScript contract types (build plan 1.2).
// Regenerates from the canonical OpenAPI and asserts the committed `src/gen` output is unchanged.
// Deterministic; any delta is a failed check — the committed artifact is the contract of record.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const genDir = join(pkgRoot, "src", "gen");

function snapshot() {
  if (!existsSync(genDir)) return {};
  const out = {};
  for (const file of readdirSync(genDir)) out[file] = readFileSync(join(genDir, file), "utf8");
  return out;
}

const before = snapshot();

execFileSync("pnpm", ["exec", "openapi-ts"], { cwd: pkgRoot, stdio: "inherit" });

const after = snapshot();
const drifted = [];
for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
  if (before[name] !== after[name]) drifted.push(name);
}

if (drifted.length > 0) {
  console.error("TS contract codegen drift detected in:", drifted.join(", "));
  console.error("Run `pnpm codegen:ts` and commit the result.");
  process.exit(1);
}
console.log(`TS contract codegen drift clean (${Object.keys(after).length} generated file(s) match).`);
