import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const VECTORS_REL = "schemas/flow/vectors";
const VECTOR_SCHEMA = "FlowConformanceVector.json";
const RESULTS_REL = "packages/flow/build/flow-conformance-results.json";
const PRODUCER = "pnpm --filter @ichiflow/flow build && pnpm --filter @ichiflow/flow conformance";
const PINNED_SDK_VERSION = "1.11.7";

interface ReplayOutcome {
  attempt: number;
  ok: boolean;
  error: string | null;
}

interface VectorOutcome {
  name: string;
  flowId: string;
  expected: number;
  result: number;
  correct: boolean;
  expectedSteps: number;
  steps: number;
  stepsMatch: boolean;
  expectedSlaMs: number;
  slaMs: number;
  slaMatch: boolean;
  replays: ReplayOutcome[];
  replayClean: boolean;
  fastForwarded: boolean;
}

interface ConformanceResult {
  sdk: string;
  sdkVersion: string;
  vectors: VectorOutcome[];
  vectorsGreen: number;
  determinismClean: boolean;
}

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  const dir = generatedSchemaDir();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    ajv.addSchema(JSON.parse(readFileSync(join(dir, file), "utf8")));
  }
  return ajv;
}

/**
 * flow-layer — build plan 3.1 (ADR-0004, doc 04 §2). The whole layer's correctness is one generic
 * interpreter workflow's correctness, gated in two parts. **DSL-valid**: every committed conformance
 * vector (embedding a Flow document) validates against the emitted canonical DSL schema
 * (`FlowConformanceVector.json` → `Flow.json`) — an ill-formed step or unknown op is rejected. **Skeleton
 * conformance**: the same interpreter, run over each vector on Temporal's time-skipping test env, hits
 * each vector's independently-pinned oracle (result/steps/SLA + timer fast-forward) and its history
 * replays twice with no non-determinism violation. The DSL check runs in-process (deterministic); the
 * interpreter run is captured by `${PRODUCER}` into the verdict artifact this scope reads.
 */
export const flowLayerScope: Scope = {
  id: "flow-layer",
  description:
    "The generic Temporal flow interpreter: committed conformance vectors are DSL-valid and each interprets to its pinned oracle with clean replay determinism under time-skip.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const vectorsDir = join(repoRoot, VECTORS_REL);

    if (!existsSync(vectorsDir)) {
      return [fail("flow-layer.vectors-present", { diff: `missing ${VECTORS_REL}` })];
    }
    const vectorFiles = readdirSync(vectorsDir)
      .filter((f) => f.endsWith(".vector.json"))
      .sort();
    checks.push(
      assert("flow-layer.vectors-present", vectorFiles.length > 0, {
        diff: `no *.vector.json fixtures in ${VECTORS_REL}`,
      }),
    );
    if (vectorFiles.length === 0) return checks;

    const ajv = buildAjv();
    const validate = ajv.getSchema(VECTOR_SCHEMA);
    if (!validate) {
      return [
        fail("flow-layer.schema-present", {
          diff: `emitted ${VECTOR_SCHEMA} not found; run pnpm --filter @ichiflow/schemas build`,
        }),
      ];
    }

    const vectorNames: string[] = [];
    for (const file of vectorFiles) {
      const doc = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as { name?: string };
      const valid = validate(doc);
      checks.push(
        assert(`flow-layer.dsl-valid.${file}`, valid === true, {
          expected: `${file} conforms to ${VECTOR_SCHEMA}`,
          actual: valid ? "valid" : ajv.errorsText(validate.errors),
        }),
      );
      if (typeof doc.name === "string") vectorNames.push(doc.name);
    }

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("flow-layer.conformance-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to run the conformance harness`,
        }),
      );
      return checks;
    }

    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as ConformanceResult;

    checks.push(
      assert(
        "flow-layer.sdk-pinned",
        r.sdk === "@temporalio" && r.sdkVersion === PINNED_SDK_VERSION,
        {
          expected: `@temporalio ${PINNED_SDK_VERSION}`,
          actual: `${r.sdk} ${r.sdkVersion}`,
        },
      ),
    );

    // The harness must cover every committed vector — a fixture added without a re-run is a stale verdict.
    const covered = new Set(r.vectors.map((v) => v.name));
    checks.push(
      assert(
        "flow-layer.vectors-covered",
        vectorNames.every((n) => covered.has(n)),
        {
          expected: `conformance artifact covers all ${vectorNames.length} committed vectors`,
          actual: `covers ${covered.size}; missing ${vectorNames.filter((n) => !covered.has(n)).join(", ") || "none"}`,
        },
      ),
    );

    for (const v of r.vectors) {
      checks.push(
        assert(
          `flow-layer.vector.${v.flowId}`,
          v.correct && v.stepsMatch && v.slaMatch && v.fastForwarded,
          {
            expected: `result=${v.expected}, steps=${v.expectedSteps}, slaMs=${v.expectedSlaMs}, fast-forwarded`,
            actual: `result=${v.result}, steps=${v.steps}, slaMs=${v.slaMs}, fastForwarded=${v.fastForwarded}`,
          },
        ),
      );
      checks.push(
        assert(`flow-layer.determinism.${v.flowId}`, v.replayClean, {
          expected: "history replays twice with no determinism violation",
          actual: v.replays.find((x) => !x.ok)?.error ?? "clean",
        }),
      );
    }

    checks.push({
      id: "flow-layer.vectors-green",
      status: r.vectorsGreen === r.vectors.length ? "pass" : "fail",
      metric: "vectors_green",
      value: r.vectorsGreen,
      threshold: r.vectors.length,
    });

    checks.push(
      assert("flow-layer.determinism-clean", r.determinismClean, {
        expected: "every vector's history replays deterministically",
        actual: r.determinismClean ? "clean" : "a replay diverged",
      }),
    );

    return checks;
  },
};
