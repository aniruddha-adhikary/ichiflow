import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const AUTHZ_REL = "schemas/authz";
const VECTORS_REL = "schemas/authz/vectors";
const MODEL_SCHEMA = "AuthzModel.json";
const VECTOR_SCHEMA = "AuthzVector.json";
const LOG_SCHEMA = "AuthzDecisionLog.json";
const RESULTS_REL = "core/build/authz-results.json";
const PRODUCER = "pnpm authz:jvm";

// Relations the corpus must exercise so both design-time (artifact can_*) and runtime (case can_*)
// derivations are actually covered — a green count is only meaningful over the full relation surface.
const REQUIRED_RELATIONS = ["can_view", "can_edit", "can_approve", "can_modify"];

interface VectorDoc {
  name?: string;
  relation?: string;
}

interface VectorOutcome {
  name: string;
  surface: string;
  relation: string;
  pass: boolean;
  parity: boolean;
  reason: string;
}

interface AuthzResult {
  vectors: VectorOutcome[];
  vectorsGreen: number;
  total: number;
  parityPass: boolean;
  designTimeCovered: number;
  runtimeCovered: number;
  decisionLogsComplete: boolean;
  decisionLog: unknown[];
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
 * authz — build plan 4.3 (ADR-0010, ADR-0025, doc 06 Parts 2 & 4, doc 13 §2.f). v1 authorization is
 * OpenFGA-only: Teams, membership, role-as-relation, and artifact/case ownership are a ReBAC model,
 * and one central PDP answers both **design-time** (artifact edit/approve) and **runtime** (Case
 * view/modify) checks. This scope gates that slice in two parts.
 *
 * **DSL-valid**: the committed model validates against the emitted `AuthzModel` schema, and every
 * committed vector validates against `AuthzVector` — the corpus is schema-governed, not free text.
 *
 * **PDP conformance + parity**: replaying every vector through the PDP (produced by `${PRODUCER}`)
 * reproduces its pinned allow/deny (`vectors_green == total`) across the required relation surface;
 * the same corpus covers *both* enforcement surfaces (design-time and runtime are each non-empty);
 * `parity(design-time, runtime)` holds — the artifact-access and data-access PEPs never disagree,
 * proving one PDP with no drift (doc 06 §4.2); and every decision emitted a complete decision log
 * (doc 06 §2.4) that conforms to `AuthzDecisionLog`.
 */
export const authzScope: Scope = {
  id: "authz",
  description:
    "The PDP slice (OpenFGA Team/role/ownership ReBAC): the model + vectors are schema-valid, every vector replays to its pinned allow/deny across the required relations, both design-time and runtime surfaces are covered by one PDP with design-time = runtime parity, and every decision emits a schema-valid decision log.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const vectorsDir = join(repoRoot, VECTORS_REL);
    const modelPath = join(repoRoot, AUTHZ_REL, "model.json");

    if (!existsSync(vectorsDir)) {
      return [fail("authz.vectors-present", { diff: `missing ${VECTORS_REL}` })];
    }
    const vectorFiles = readdirSync(vectorsDir)
      .filter((f) => f.endsWith(".vectors.json"))
      .sort();
    checks.push(
      assert("authz.vectors-present", vectorFiles.length > 0, {
        diff: `no *.vectors.json fixtures in ${VECTORS_REL}`,
      }),
    );
    checks.push(
      assert("authz.model-present", existsSync(modelPath), {
        diff: `missing ${AUTHZ_REL}/model.json`,
      }),
    );
    if (vectorFiles.length === 0 || !existsSync(modelPath)) return checks;

    const ajv = buildAjv();
    const validateModel = ajv.getSchema(MODEL_SCHEMA);
    const validateVector = ajv.getSchema(VECTOR_SCHEMA);
    const validateLog = ajv.getSchema(LOG_SCHEMA);
    if (!validateModel || !validateVector || !validateLog) {
      return [
        fail("authz.schema-present", {
          diff: `emitted ${MODEL_SCHEMA}/${VECTOR_SCHEMA}/${LOG_SCHEMA} not found; run pnpm --filter @ichiflow/schemas build`,
        }),
      ];
    }

    const model = JSON.parse(readFileSync(modelPath, "utf8"));
    checks.push(
      assert("authz.model-valid", validateModel(model) === true, {
        expected: `model.json conforms to ${MODEL_SCHEMA}`,
        actual: ajv.errorsText(validateModel.errors),
      }),
    );

    const vectorNames: string[] = [];
    const relationsSeen = new Set<string>();
    for (const file of vectorFiles) {
      const doc = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as VectorDoc[];
      const arrayOk = Array.isArray(doc);
      checks.push(
        assert(`authz.vectors-array.${file}`, arrayOk, {
          expected: `${file} is an array of AuthzVector`,
          actual: arrayOk ? "array" : typeof doc,
        }),
      );
      if (!arrayOk) continue;
      const bad = doc.find((v) => validateVector(v) !== true);
      checks.push(
        assert(`authz.dsl-valid.${file}`, bad === undefined, {
          expected: `every vector in ${file} conforms to ${VECTOR_SCHEMA}`,
          actual: bad ? ajv.errorsText(validateVector.errors) : "all valid",
        }),
      );
      for (const v of doc) {
        if (typeof v.name === "string") vectorNames.push(v.name);
        if (typeof v.relation === "string") relationsSeen.add(v.relation);
      }
    }

    const missingRelations = REQUIRED_RELATIONS.filter((r) => !relationsSeen.has(r));
    checks.push(
      assert("authz.relations-covered", missingRelations.length === 0, {
        expected: `corpus exercises ${REQUIRED_RELATIONS.join(", ")}`,
        actual:
          missingRelations.length === 0 ? "all covered" : `missing ${missingRelations.join(", ")}`,
      }),
    );

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("authz.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to replay the vectors`,
        }),
      );
      return checks;
    }

    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as AuthzResult;

    const covered = new Set(r.vectors.map((v) => v.name));
    checks.push(
      assert(
        "authz.vectors-covered",
        vectorNames.every((n) => covered.has(n)),
        {
          expected: `results cover all ${vectorNames.length} committed vectors`,
          actual: `covers ${covered.size}; missing ${vectorNames.filter((n) => !covered.has(n)).join(", ") || "none"}`,
        },
      ),
    );

    for (const v of r.vectors) {
      checks.push(
        assert(`authz.decision.${v.name}`, v.pass, {
          expected: "vector replays to its pinned allow/deny",
          actual: `${v.surface}/${v.relation}: ${v.reason}`,
        }),
      );
    }

    // Both enforcement surfaces must be non-empty, or "one PDP spans both" is vacuous.
    checks.push(
      assert("authz.design-time-covered", r.designTimeCovered > 0, {
        expected: "at least one design-time (artifact) vector",
        actual: `${r.designTimeCovered}`,
      }),
    );
    checks.push(
      assert("authz.runtime-covered", r.runtimeCovered > 0, {
        expected: "at least one runtime (case) vector",
        actual: `${r.runtimeCovered}`,
      }),
    );

    // Every decision emitted a decision log that conforms to the emitted AuthzDecisionLog schema.
    const badLog = r.decisionLog.find((e) => validateLog(e) !== true);
    checks.push(
      assert("authz.decision-log-valid", badLog === undefined, {
        expected: `every decision-log entry conforms to ${LOG_SCHEMA}`,
        actual: badLog ? ajv.errorsText(validateLog.errors) : "all valid",
      }),
    );
    checks.push(
      assert("authz.decision-log-complete", r.decisionLogsComplete === true, {
        expected: "one complete decision-log entry per decision (id + reason present)",
        actual: `complete=${r.decisionLogsComplete}, entries=${r.decisionLog.length}`,
      }),
    );

    checks.push({
      id: "authz.parity",
      status: r.parityPass ? "pass" : "fail",
      metric: "parity_design_time_runtime",
      value: r.parityPass ? 1 : 0,
      threshold: 1,
    });

    checks.push({
      id: "authz.vectors-green",
      status: r.vectorsGreen === r.total && r.total > 0 ? "pass" : "fail",
      metric: "vectors_green",
      value: r.vectorsGreen,
      threshold: r.total,
    });

    return checks;
  },
};
