import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The ichiflow verify verdict envelope.
 *
 * Every `ichiflow verify --scope <...> --json` run emits this shape and nothing else
 * (doc 13 §3.2). "Verdicts are JSON, never prose": done-ness is an enumerable count over a
 * suite of checks, not a narrated claim. This schema is the load-bearing contract consumed by
 * CI, the progress ledger, `get_verify_status`, and agents.
 */
@jsonSchema
namespace Ichiflow.Verify;

/** pass | fail — the only two verdicts a scope may emit. */
union Verdict {
  pass: "pass",
  fail: "fail",
}

/** Outcome of a single enumerated check. */
union CheckStatus {
  pass: "pass",
  fail: "fail",
  skip: "skip",
}

/** Count summary across the scope's checks. */
model VerdictSummary {
  @minValue(0) checks: int32;
  @minValue(0) passed: int32;
  @minValue(0) failed: int32;
  @minValue(0) skipped: int32;
}

/** Enumerable "how much is done": green vs total over the conformance suite. */
model ConformanceProgress {
  @minValue(0) green: int32;
  @minValue(0) total: int32;
}

/** Coverage ratio against a declared threshold. */
model CoverageProgress {
  @minValue(0) @maxValue(1) value: float64;
  @minValue(0) @maxValue(1) threshold: float64;
  met: boolean;
}

/** The progress metric block — a count/ratio, never a narrative estimate. */
model Progress {
  conformance?: ConformanceProgress;
  coverage?: CoverageProgress;
}

/**
 * One check result. Failures carry a structured diff (expected/actual/artifact), never a
 * sentence. `id` is stable across runs so a dashboard and an agent track the same check.
 */
model CheckResult {
  /** Stable check id, e.g. `self-check.envelope-schema`. */
  id: string;

  status: CheckStatus;

  /** The artifact this check is about, if any (e.g. `decision:loan-eligibility@3.2.0`). */
  artifact?: string;

  /** Expected value for a failed check (structured, not prose). */
  expected?: unknown;

  /** Actual value for a failed check (structured, not prose). */
  actual?: unknown;

  /** A short structured diff string; supplements expected/actual. */
  diff?: string;

  /** Named metric for coverage-style checks (e.g. `rule-coverage`). */
  metric?: string;

  /** Metric value for a coverage-style check. */
  value?: float64;

  /** Metric threshold for a coverage-style check. */
  threshold?: float64;
}

/** The verdict envelope emitted by every verify scope. */
model VerdictEnvelope {
  /** Envelope schema version. */
  verifyVersion: string;

  /** The scope that produced this verdict (e.g. `self-check`, `schema-pipeline`). */
  scope: string;

  /** ISO-8601 UTC timestamp of the run. */
  ranAt: utcDateTime;

  /** Seed for deterministic time/data (§3.6); recorded so a run is reproducible. */
  seed: string;

  verdict: Verdict;
  summary: VerdictSummary;
  progress: Progress;
  checks: CheckResult[];

  /** Must always be false — a flaky check is a harness defect, not a retry (§3.6). */
  flaky: boolean;
}
