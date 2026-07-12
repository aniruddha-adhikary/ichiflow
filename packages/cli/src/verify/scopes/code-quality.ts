import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, fail } from "../check.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const DETEKT_SARIF_REL = "core/build/reports/detekt/detekt.sarif";
const ARCH_RESULTS_REL = "core/build/arch-rules-results.json";
const BUILD_GRADLE_REL = "core/build.gradle.kts";
const JVM_COMMAND = "cd core && ./gradlew detekt test";

interface SarifResult {
  ruleId?: string;
  message?: { text?: string };
  locations?: Array<{
    physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number } };
  }>;
}

interface Sarif {
  runs: Array<{ results?: SarifResult[] }>;
}

interface ArchRule {
  id: string;
  passed: boolean;
  violations: string[];
}

interface ArchResults {
  suite: string;
  rules: number;
  results: ArchRule[];
}

function describeFinding(r: SarifResult): string {
  const loc = r.locations?.[0]?.physicalLocation;
  const where = loc?.artifactLocation?.uri
    ? `${loc.artifactLocation.uri}:${loc.region?.startLine ?? "?"}`
    : "unknown";
  return `${r.ruleId ?? "?"} @ ${where}: ${r.message?.text ?? ""}`;
}

/**
 * code-quality — the non-negotiable Kotlin quality gate (build doctrine / ADR-0016). Two independent
 * analyses, both build-failing in `./gradlew check`, surfaced here machine-readably so quality is a
 * verify verdict rather than an out-of-band CI side effect:
 *
 *  1. **detekt** static analysis — asserts zero findings from its SARIF report.
 *  2. **ArchUnit** architecture rules — asserts every recorded rule (notably the Decision Engine SPI
 *     boundary: only `…decision.spi` may depend on `org.kie..`) passed with no violations.
 *
 * It also asserts the gates remain *wired* (detekt plugin + ArchUnit dependency in the build), so the
 * gate itself cannot be silently removed. Run `cd core && ./gradlew detekt test` to produce artifacts.
 */
export const codeQualityScope: Scope = {
  id: "code-quality",
  description:
    "Kotlin quality gate: detekt static analysis (zero findings) + ArchUnit architecture rules (SPI boundary etc.), both build-failing.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];

    // --- Gate wiring: the tools must stay configured in the build. ---
    const gradlePath = join(repoRoot, BUILD_GRADLE_REL);
    const gradle = existsSync(gradlePath) ? readFileSync(gradlePath, "utf8") : "";
    checks.push(
      assert("code-quality.wiring.detekt-plugin", gradle.includes("io.gitlab.arturbosch.detekt"), {
        expected: `detekt plugin applied in ${BUILD_GRADLE_REL}`,
        actual: "not found",
      }),
    );
    checks.push(
      assert("code-quality.wiring.archunit-dep", gradle.includes("com.tngtech.archunit"), {
        expected: `ArchUnit dependency in ${BUILD_GRADLE_REL}`,
        actual: "not found",
      }),
    );

    // --- detekt SARIF: zero findings. ---
    const sarifPath = join(repoRoot, DETEKT_SARIF_REL);
    if (!existsSync(sarifPath)) {
      checks.push(
        fail("code-quality.detekt.report-present", {
          diff: `missing ${DETEKT_SARIF_REL}; run \`${JVM_COMMAND}\``,
        }),
      );
    } else {
      const sarif = JSON.parse(readFileSync(sarifPath, "utf8")) as Sarif;
      const findings = sarif.runs.flatMap((r) => r.results ?? []);
      checks.push({
        id: "code-quality.detekt.zero-findings",
        status: findings.length === 0 ? "pass" : "fail",
        metric: "detekt_findings",
        value: findings.length,
        threshold: 0,
        diff: findings.slice(0, 20).map(describeFinding).join("\n") || undefined,
      });
    }

    // --- ArchUnit: every recorded rule passed. ---
    const archPath = join(repoRoot, ARCH_RESULTS_REL);
    if (!existsSync(archPath)) {
      checks.push(
        fail("code-quality.archunit.results-present", {
          diff: `missing ${ARCH_RESULTS_REL}; run \`${JVM_COMMAND}\``,
        }),
      );
    } else {
      const arch = JSON.parse(readFileSync(archPath, "utf8")) as ArchResults;
      checks.push(
        assert("code-quality.archunit.rules-present", arch.results.length > 0, {
          expected: "at least one architecture rule recorded",
          actual: `${arch.results.length}`,
        }),
      );
      for (const rule of arch.results) {
        checks.push(
          assert(`code-quality.archunit.${rule.id}`, rule.passed, {
            expected: "no violations",
            actual: rule.violations.slice(0, 10).join("; ") || "violation",
          }),
        );
      }
    }

    return checks;
  },
};
