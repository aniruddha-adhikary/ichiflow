// License-allowlist gate (ADR-0016). Scans the **production** dependency closure (what ichiflow
// embeds/distributes and thus imposes on self-hosting customers) and fails the build on any license
// outside the allowlist. Dev-only tooling (linters, test runners) is not embedded and is not gated.
// Uses pnpm's authoritative license resolution rather than re-parsing package.json by hand.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cfg = JSON.parse(readFileSync(join(repoRoot, "tools/license-check/allowlist.json"), "utf8"));
const allowed = new Set(cfg.allowed);
const exceptions = cfg.exceptions ?? {};

// Evaluate an SPDX expression: OR passes if any operand passes; AND/plain require all operands.
function licenseAllowed(expr) {
  const cleaned = expr.replace(/[()]/g, " ").trim();
  if (allowed.has(cleaned)) return true;
  if (/\bOR\b/i.test(cleaned)) {
    return cleaned.split(/\bOR\b/i).some((t) => allowed.has(t.trim().replace(/\+$/, "")));
  }
  if (/\bAND\b/i.test(cleaned)) {
    return cleaned.split(/\bAND\b/i).every((t) => allowed.has(t.trim().replace(/\+$/, "")));
  }
  return allowed.has(cleaned.replace(/\+$/, ""));
}

let raw;
try {
  raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // pnpm exits non-zero when it finds unknown licenses; its stdout still holds the JSON.
  raw = err.stdout?.toString() ?? "";
}

const byLicense = JSON.parse(raw || "{}");
const violations = [];

for (const [license, packages] of Object.entries(byLicense)) {
  const ok = license !== "Unknown" && licenseAllowed(license);
  if (ok) continue;
  for (const pkg of packages) {
    if (exceptions[pkg.name]) continue;
    const versions = Array.isArray(pkg.versions) ? pkg.versions.join(",") : "";
    violations.push(`${pkg.name}@${versions}: ${license}`);
  }
}

const total = Object.values(byLicense).reduce((n, pkgs) => n + pkgs.length, 0);

if (violations.length > 0) {
  console.error(`License allowlist violations (${violations.length}):`);
  for (const v of violations.sort()) console.error(`  ✗ ${v}`);
  console.error(
    "\nAdd the license to tools/license-check/allowlist.json (if OSS-permissive) or the package " +
      "to `exceptions` with justification (ADR-0016).",
  );
  process.exit(1);
}

console.log(`License gate clean — ${total} production dependencies, all on the allowlist.`);
