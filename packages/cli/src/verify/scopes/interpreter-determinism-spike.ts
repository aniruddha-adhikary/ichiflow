import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, fail } from "../check.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const RESULTS_REL = "packages/flow/build/interpreter-spike-results.json";
const PRODUCER = "pnpm --filter @ichiflow/flow build && pnpm --filter @ichiflow/flow spike";
const PINNED_SDK_VERSION = "1.11.7";

interface ReplayOutcome {
  attempt: number;
  ok: boolean;
  error: string | null;
}

interface SpikeResult {
  sdk: string;
  sdkVersion: string;
  flowId: string;
  steps: number;
  expected: number;
  result: number;
  resultCorrect: boolean;
  secondResult: number;
  resultsIdentical: boolean;
  replays: ReplayOutcome[];
  replayClean: boolean;
  historyEvents: number;
  sla: { scheduledMs: number; wallMs: number; fastForwarded: boolean };
}

/**
 * interpreter-determinism-spike — build plan 3.0 (ADR-0003/0004), the riskiest-bet proof (doc 14 §6):
 * durable-execution determinism at DSL generality. Consumes the harness artifact (run the producer:
 * `${PRODUCER}`) where the generic interpreter executes a toy 3-step flow (compute → 30-day SLA timer
 * → compute) on Temporal's time-skipping test env. Asserts the pattern before the full step set:
 * pinned SDK, the interpreted result is correct and stable across an independent re-execution, the
 * recorded history replays twice with no determinism violation, and the month-long SLA timer
 * fast-forwards. Determinism is the whole layer's correctness property, so it is gated first.
 */
export const interpreterDeterminismSpikeScope: Scope = {
  id: "interpreter-determinism-spike",
  description:
    "The generic Temporal interpreter executes a 3-step flow with replay-twice determinism (no non-determinism violation) and fast-forwards a 30-day SLA timer under time-skip.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      return [
        fail("interpreter-determinism-spike.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to run the determinism harness`,
        }),
      ];
    }

    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as SpikeResult;
    const checks: CheckResult[] = [];

    checks.push(
      assert(
        "interpreter-determinism-spike.sdk-pinned",
        r.sdk === "@temporalio" && r.sdkVersion === PINNED_SDK_VERSION,
        {
          expected: `@temporalio ${PINNED_SDK_VERSION}`,
          actual: `${r.sdk} ${r.sdkVersion}`,
        },
      ),
    );

    checks.push(
      assert("interpreter-determinism-spike.result-correct", r.resultCorrect, {
        expected: `interpreted result == ${r.expected}`,
        actual: String(r.result),
      }),
    );

    checks.push(
      assert("interpreter-determinism-spike.results-identical", r.resultsIdentical, {
        expected: "identical result on an independent second execution",
        actual: `first=${r.result}, second=${r.secondResult}`,
      }),
    );

    for (const replay of r.replays) {
      checks.push(
        assert(`interpreter-determinism-spike.replay-clean.${replay.attempt}`, replay.ok, {
          expected: "history replays with no determinism violation",
          actual: replay.error ?? "ok",
        }),
      );
    }

    checks.push({
      id: "interpreter-determinism-spike.replay-clean",
      status: r.replayClean ? "pass" : "fail",
      metric: "replays_clean",
      value: r.replays.filter((x) => x.ok).length,
      threshold: r.replays.length,
    });

    checks.push(
      assert("interpreter-determinism-spike.history-nonempty", r.historyEvents > 0, {
        expected: "> 0 recorded history events",
        actual: String(r.historyEvents),
      }),
    );

    checks.push(
      assert("interpreter-determinism-spike.sla-fast-forwarded", r.sla.fastForwarded, {
        expected: `${r.sla.scheduledMs}ms SLA timer fast-forwarded under time-skip`,
        actual: `wall-clock ${r.sla.wallMs}ms`,
      }),
    );

    return checks;
  },
};
