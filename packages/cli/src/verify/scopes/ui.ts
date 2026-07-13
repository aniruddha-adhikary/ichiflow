import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const BASELINE_REL = "schemas/ui/baseline";
const UISCHEMA_SCHEMA = "UiSchema.json";
const RESULTS_REL = "packages/uischema/build/ui-results.json";
const PRODUCER = "pnpm ui:preview";

// The four PDP-shaped states every placed control must have a story for (doc 07 §11.2, doc 13 §2.e):
// a placed field's "done-ness" is a count over these states, not an eyeballed screenshot.
const REQUIRED_STATES = ["hidden", "read-only", "error", "validation-failed"] as const;

interface DanglingScope {
  pointer: string;
  file: string;
  hint: string;
}

interface AxeViolation {
  story: string;
  ruleId: string;
  impact: string;
}

interface ContrastCheck {
  token: string;
  kind: string;
  ratio: number;
  min: number;
  pass: boolean;
}

interface SnapshotDrift {
  story: string;
  detail: string;
}

interface UiResults {
  dataSchemaId: string;
  dataSchemaVersion: string;
  provenanceCurrent: boolean;
  scopeLint: {
    clean: boolean;
    controls: number;
    dangling: DanglingScope[];
  };
  states: {
    required: number;
    covered: number;
  };
  axe: {
    storiesRun: number;
    aaPass: number;
    violations: AxeViolation[];
  };
  contrast: {
    total: number;
    pass: number;
    checks: ContrastCheck[];
  };
  snapshots: {
    produced: number;
    matched: number;
    drift: SnapshotDrift[];
  };
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
 * ui — build plan 4.5 ◆ (ADR-0024, doc 07 §2/§3/§11/§12, doc 13 §2.e). The UI harness gates the
 * **uischema** layer: a JSON Forms layout tree authored independently of the data schema, whose done-
 * ness is an enumerable count over four check families, never an eyeballed screenshot.
 *
 * **DSL-valid**: every committed baseline uischema validates against the emitted `UiSchema` schema —
 * the layout is schema-governed, not free text.
 *
 * The remaining families read the producer's results artifact (written by `${PRODUCER}`, mirroring the
 * other producer→scope pairs), so the render/axe/snapshot work is deterministic and off the scope's
 * hot path:
 *
 *   - **uischema-scope lint** (doc 07 §3): every `Control.scope` JSON Pointer resolves against the
 *     current data schema; a dangling pointer fails with a fix-it hint naming the pointer + file.
 *   - **PDP-state story coverage** (doc 07 §11.2): every placed control renders in all four PDP-shaped
 *     states (hidden / read-only / error / validation-failed) — `states_covered / states_required`.
 *   - **a11y AA** (doc 07 §12): axe-core (WCAG 2.2 AA) over every rendered story in jsdom, plus the
 *     token-contract contrast gate (text ≥ 4.5:1, UI ≥ 3:1) on the design tokens.
 *   - **preview snapshots** (doc 07 §12): serialized-DOM baselines regenerate byte-identically
 *     (drift = fail); no timestamps/random ids in the output.
 *
 * All green ⇒ `ui` passes; the harness is deterministic (`flaky=false`).
 */
export const uiScope: Scope = {
  id: "ui",
  description:
    "The uischema layer (JSON Forms): committed baseline uischemas are schema-valid, every Control scope resolves against the current data schema (scope lint), every placed control covers the four PDP-shaped states, axe-core AA passes on every rendered story with token contrast satisfied, and preview snapshots regenerate byte-identically.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const baselineDir = join(repoRoot, BASELINE_REL);

    if (!existsSync(baselineDir)) {
      return [fail("ui.baseline-present", { diff: `missing ${BASELINE_REL}` })];
    }
    const baselineFiles = readdirSync(baselineDir)
      .filter((f) => f.endsWith(".uischema.json"))
      .sort();
    checks.push(
      assert("ui.baseline-present", baselineFiles.length > 0, {
        diff: `no *.uischema.json baselines in ${BASELINE_REL}; run \`${PRODUCER}\` to generate the baseline`,
      }),
    );
    if (baselineFiles.length === 0) return checks;

    const ajv = buildAjv();
    const validateUiSchema = ajv.getSchema(UISCHEMA_SCHEMA);
    if (!validateUiSchema) {
      return [
        fail("ui.schema-present", {
          diff: `emitted ${UISCHEMA_SCHEMA} not found; run pnpm --filter @ichiflow/schemas build`,
        }),
      ];
    }

    for (const file of baselineFiles) {
      const doc = JSON.parse(readFileSync(join(baselineDir, file), "utf8"));
      const valid = validateUiSchema(doc);
      checks.push(
        assert(`ui.dsl-valid.${file}`, valid === true, {
          expected: `${file} conforms to ${UISCHEMA_SCHEMA}`,
          actual: valid ? "valid" : ajv.errorsText(validateUiSchema.errors),
        }),
      );
    }

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("ui.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to render stories + axe + snapshots`,
        }),
      );
      return checks;
    }

    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as UiResults;

    // Provenance (doc 07 §2 rule 2): the baseline must target the *current* data schema; a drifted
    // digest means the generated-once baseline must be regenerated against the evolved schema.
    checks.push(
      assert("ui.provenance-current", r.provenanceCurrent === true, {
        expected: `baseline targets the current ${r.dataSchemaId} (version ${r.dataSchemaVersion})`,
        actual: r.provenanceCurrent
          ? "current"
          : `baseline provenance drifted from the emitted data schema; regenerate with \`${PRODUCER}\``,
      }),
    );

    // uischema-scope lint (doc 07 §3): each dangling pointer is its own failed check with a fix-it hint.
    for (const d of r.scopeLint.dangling) {
      checks.push(
        fail(`ui.scope-lint.${d.pointer}`, {
          expected: `scope ${d.pointer} resolves against the data schema`,
          actual: d.hint,
          artifact: d.file,
        }),
      );
    }
    checks.push({
      id: "ui.scope-lint-clean",
      status: r.scopeLint.clean && r.scopeLint.controls > 0 ? "pass" : "fail",
      metric: "controls_linted",
      value: r.scopeLint.dangling.length === 0 ? r.scopeLint.controls : 0,
      threshold: r.scopeLint.controls,
      ...(r.scopeLint.clean ? {} : { actual: `${r.scopeLint.dangling.length} dangling scope(s)` }),
    });

    // PDP-state story coverage (doc 07 §11.2) — a count, never a screenshot.
    checks.push({
      id: "ui.states-covered",
      status: r.states.covered === r.states.required && r.states.required > 0 ? "pass" : "fail",
      metric: "states_covered",
      value: r.states.covered,
      threshold: r.states.required,
      ...(r.states.covered === r.states.required
        ? {}
        : {
            expected: `${REQUIRED_STATES.length} states per placed control (${REQUIRED_STATES.join(", ")})`,
            actual: `${r.states.covered}/${r.states.required} covered`,
          }),
    });

    // a11y AA (doc 07 §12): every axe violation is a named failed check; the aggregate is a count.
    for (const v of r.axe.violations) {
      checks.push(
        fail(`ui.a11y.${v.story}`, {
          expected: "no WCAG 2.2 AA violations in the rendered story",
          actual: `${v.ruleId} (${v.impact})`,
        }),
      );
    }
    checks.push({
      id: "ui.axe-aa",
      status: r.axe.aaPass === r.axe.storiesRun && r.axe.storiesRun > 0 ? "pass" : "fail",
      metric: "axe_aa_pass",
      value: r.axe.aaPass,
      threshold: r.axe.storiesRun,
    });

    // Token-contract contrast (doc 07 §12): each failing token pair is a named check.
    for (const c of r.contrast.checks.filter((x) => !x.pass)) {
      checks.push(
        fail(`ui.contrast.${c.token}`, {
          expected: `${c.kind} contrast ≥ ${c.min}:1`,
          actual: `${c.ratio}:1`,
        }),
      );
    }
    checks.push({
      id: "ui.contrast",
      status: r.contrast.pass === r.contrast.total && r.contrast.total > 0 ? "pass" : "fail",
      metric: "contrast_pass",
      value: r.contrast.pass,
      threshold: r.contrast.total,
    });

    // Preview snapshots (doc 07 §12): serialized-DOM baselines must regenerate byte-identically.
    for (const d of r.snapshots.drift) {
      checks.push(
        fail(`ui.snapshot.${d.story}`, {
          expected: "regenerated snapshot matches the committed baseline",
          actual: d.detail,
        }),
      );
    }
    checks.push({
      id: "ui.snapshots-matched",
      status:
        r.snapshots.matched === r.snapshots.produced && r.snapshots.produced > 0 ? "pass" : "fail",
      metric: "snapshots_matched",
      value: r.snapshots.matched,
      threshold: r.snapshots.produced,
    });

    return checks;
  },
};
