import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const CASES_REL = "schemas/decisionrecord/cases";
const CASE_SCHEMA = "DecisionRecordCase.json";
const RESULTS_REL = "packages/flow/build/decisionrecord-results.json";
const PRODUCER = "pnpm decisionrecord:assemble";

interface CaseOutcome {
  name: string;
  caseId: string;
  chainComplete: boolean;
  expectedChainComplete: boolean;
  orphans: string[];
  expectedOrphans: string[];
  orphansMatch: boolean;
  decisions: number;
  expectedDecisions: number;
  tasks: number;
  expectedTasks: number;
  ok: boolean;
}

interface DecisionRecordResult {
  cases: CaseOutcome[];
  casesGreen: number;
  chainsComplete: number;
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
 * decisionrecord — build plan 3.4 (ADR-0011, doc 08 §1, doc 13 §2.g). The per-Case **DecisionRecord**
 * stitches the flow event history + fired-Decision traces + Task resolutions into one causal chain
 * keyed by `case_id`; its correctness is **completeness** (no gap). This scope gates the pure assembler
 * in two parts. **DSL-valid**: every committed case fixture validates against the emitted
 * `DecisionRecordCase.json` (→ `FlowResult.json`). **Assembly + orphan detection**: the assembler runs
 * over each fixture's `FlowResult` and the reported `orphans` + chain-completeness + stitched
 * Decision/Task counts match the fixture's independently-pinned oracle — positive fixtures stitch clean
 * (`orphans: []`), negative fixtures inject a gap (a Task-lifecycle event with no `task.created`, a
 * dangling Task) that the detector must flag. Real-source completeness (every conformance vector
 * assembles with no orphan) is proven in the `flow-layer` scope; here we prove the detector *and* the
 * assembly on pinned fixtures. The assembler is pure, so `${PRODUCER}` is a deterministic pass.
 */
export const decisionRecordScope: Scope = {
  id: "decisionrecord",
  description:
    "The per-Case DecisionRecord assembler + orphan-event detector: committed case fixtures are DSL-valid and each assembles to its pinned stitched chain / orphan verdict.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const casesDir = join(repoRoot, CASES_REL);

    if (!existsSync(casesDir)) {
      return [fail("decisionrecord.cases-present", { diff: `missing ${CASES_REL}` })];
    }
    const caseFiles = readdirSync(casesDir)
      .filter((f) => f.endsWith(".case.json"))
      .sort();
    checks.push(
      assert("decisionrecord.cases-present", caseFiles.length > 0, {
        diff: `no *.case.json fixtures in ${CASES_REL}`,
      }),
    );
    if (caseFiles.length === 0) return checks;

    const ajv = buildAjv();
    const validate = ajv.getSchema(CASE_SCHEMA);
    if (!validate) {
      return [
        fail("decisionrecord.schema-present", {
          diff: `emitted ${CASE_SCHEMA} not found; run pnpm --filter @ichiflow/schemas build`,
        }),
      ];
    }

    const caseNames: string[] = [];
    for (const file of caseFiles) {
      const doc = JSON.parse(readFileSync(join(casesDir, file), "utf8")) as { name?: string };
      const valid = validate(doc);
      checks.push(
        assert(`decisionrecord.dsl-valid.${file}`, valid === true, {
          expected: `${file} conforms to ${CASE_SCHEMA}`,
          actual: valid ? "valid" : ajv.errorsText(validate.errors),
        }),
      );
      if (typeof doc.name === "string") caseNames.push(doc.name);
    }

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("decisionrecord.assembly-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to assemble the DecisionRecords`,
        }),
      );
      return checks;
    }

    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as DecisionRecordResult;

    // The artifact must cover every committed fixture — a case added without a re-run is a stale verdict.
    const covered = new Set(r.cases.map((c) => c.name));
    checks.push(
      assert(
        "decisionrecord.cases-covered",
        caseNames.every((n) => covered.has(n)),
        {
          expected: `assembly artifact covers all ${caseNames.length} committed cases`,
          actual: `covers ${covered.size}; missing ${caseNames.filter((n) => !covered.has(n)).join(", ") || "none"}`,
        },
      ),
    );

    for (const c of r.cases) {
      // A non-empty case_id is the stitch key (ADR-0011).
      checks.push(
        assert(`decisionrecord.case-id.${c.caseId || "?"}`, c.caseId.length > 0, {
          expected: "a non-empty case_id",
          actual: JSON.stringify(c.caseId),
        }),
      );
      checks.push(
        assert(`decisionrecord.assembled.${c.caseId}`, c.ok, {
          expected: `chainComplete=${c.expectedChainComplete}, orphans=${JSON.stringify(c.expectedOrphans)}, decisions=${c.expectedDecisions}, tasks=${c.expectedTasks}`,
          actual: `chainComplete=${c.chainComplete}, orphans=${JSON.stringify(c.orphans)}, decisions=${c.decisions}, tasks=${c.tasks}`,
        }),
      );
    }

    checks.push({
      id: "decisionrecord.cases-green",
      status: r.casesGreen === r.cases.length ? "pass" : "fail",
      metric: "cases_green",
      value: r.casesGreen,
      threshold: r.cases.length,
    });

    // The detector must actually fire on the negative fixtures — a suite of only clean chains proves nothing.
    const incomplete = r.cases.filter((c) => !c.expectedChainComplete).length;
    checks.push(
      assert("decisionrecord.detector-exercised", incomplete > 0, {
        expected: "at least one negative (orphan/incomplete) fixture exercises the detector",
        actual: `${incomplete} incomplete-chain fixtures`,
      }),
    );

    return checks;
  },
};
