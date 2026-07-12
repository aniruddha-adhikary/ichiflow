/** TypeScript mirror of the TypeSpec-authored verdict envelope (schemas/verdict.tsp, doc 13 §3.2). */

export type Verdict = "pass" | "fail";
export type CheckStatus = "pass" | "fail" | "skip";

export interface VerdictSummary {
  checks: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ConformanceProgress {
  green: number;
  total: number;
}

export interface CoverageProgress {
  value: number;
  threshold: number;
  met: boolean;
}

export interface Progress {
  conformance?: ConformanceProgress;
  coverage?: CoverageProgress;
}

export interface CheckResult {
  id: string;
  status: CheckStatus;
  artifact?: string;
  expected?: unknown;
  actual?: unknown;
  diff?: string;
  metric?: string;
  value?: number;
  threshold?: number;
}

export interface VerdictEnvelope {
  verifyVersion: string;
  scope: string;
  ranAt: string;
  seed: string;
  verdict: Verdict;
  summary: VerdictSummary;
  progress: Progress;
  checks: CheckResult[];
  flaky: boolean;
}

/** The envelope version this CLI emits. Bumping it is an oasdiff-gated contract change (open-q1). */
export const VERIFY_VERSION = "1";

/**
 * A scope is a named harness: an id plus a pure-as-possible check runner. Checks must be
 * deterministic (§3.6) — no wall-clock or RNG inside; time/data is seeded and passed in.
 */
export interface Scope {
  id: string;
  /** Human description; never part of the verdict of record. */
  description: string;
  run(ctx: ScopeContext): Promise<CheckResult[]> | CheckResult[];
}

export interface ScopeContext {
  /** Absolute path to the repository root. */
  repoRoot: string;
  /** Deterministic seed for this run (e.g. `sha256:...`). */
  seed: string;
}
