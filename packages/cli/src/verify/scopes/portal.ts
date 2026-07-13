import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const FIXTURES_REL = "packages/portal/fixtures";
const RESULTS_REL = "packages/portal/build/portal-results.json";
const PRODUCER = "pnpm portal:preview";
const SIGNAL_SCHEMA = "FlowSignal.json";
const RECORD_SCHEMA = "DecisionRecord.json";

interface InboxResult {
  principal: string;
  crossTeam: boolean;
  expected: string[];
  visible: string[];
  dueOrder: number[];
  orderingOk: boolean;
}

interface FieldResult {
  principal: string;
  caseId: string;
  states: Record<string, string>;
}

interface PortalResults {
  seed: string;
  inbox: InboxResult[];
  crossTeam: {
    principal: string;
    baselinePrincipal: string;
    visibleCount: number;
    baselineCount: number;
    fewer: boolean;
  };
  signal: {
    emitted: boolean;
    principal: string;
    caseId: string;
    payload: unknown;
  };
  trace: {
    caseId: string;
    chainComplete: boolean;
    nodeIds: string[];
    record: unknown;
  };
  fields: FieldResult[];
  uischema: { controls: number; resolvedControls: number; unresolved: string[] };
}

interface PrincipalFixture {
  id: string;
  crossTeam: boolean;
  expectedInbox: string[];
}

interface FieldScenarioFixture {
  principal: string;
  caseId: string;
  expected: Record<string, string>;
}

interface UiSchemaFixture {
  elements?: { type?: string; scope?: string }[];
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const sortedEq = (a: string[], b: string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

const seqEq = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * portal — build plan 4.4 (doc 07 §5/§7/§11, doc 13 §2.e/§2.f). The first back-office **Portal**: a
 * PDP-filtered, SLA-ordered Task inbox + a Case/review view (decision trace, an action form that
 * **signals the Flow** rather than mutating state, an obligation checklist, and field-level
 * entitlements). This scope reads the deterministic harness artifact produced by `${PRODUCER}` and the
 * committed fixtures (the independent oracle), then gates, enumerably:
 *   - **PDP-filtered rows** — each seeded principal's inbox is exactly the id set the authz relation
 *     model permits (incl. a cross-team principal who sees strictly fewer rows).
 *   - **SLA ordering** — rows are ordered soonest-due first (exact sequence + non-decreasing dueMs).
 *   - **Action form signals the Flow** — submit emits a payload that validates against the emitted
 *     `${SIGNAL_SCHEMA}` (the Phase-3 Flow signal contract), never a direct state mutation.
 *   - **Decision trace** — the assembled `DecisionRecord` validates against emitted `${RECORD_SCHEMA}`
 *     and its trace nodes render.
 *   - **Field entitlements** — a lower-privilege principal sees ≥1 hidden + ≥1 read-only field per the
 *     PDP, with the "why is this hidden?" affordance.
 * The reuse of the SAME relation model as the `authz` slice (schemas/authz/model.json) keeps
 * design-time = runtime, one relation vocabulary (doc 13 §2.f). Deterministic ⇒ `flaky=false`.
 */
export const portalScope: Scope = {
  id: "portal",
  description:
    "The first back-office Portal: a PDP-filtered, SLA-ordered Task inbox and a Case/review view whose action form signals the Flow, with a rendered decision trace, obligation checklist, and PDP-driven field entitlements (editable/read-only/hidden).",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const fixturesDir = join(repoRoot, FIXTURES_REL);

    if (!existsSync(fixturesDir)) {
      return [fail("portal.fixtures-present", { diff: `missing ${FIXTURES_REL}` })];
    }

    const principals = readJson<PrincipalFixture[]>(join(fixturesDir, "principals.json"));
    const scenarios = readJson<FieldScenarioFixture[]>(join(fixturesDir, "field-scenarios.json"));
    const dataSchema = readJson<{ properties?: Record<string, unknown> }>(
      join(fixturesDir, "action.dataschema.json"),
    );
    const uischema = readJson<UiSchemaFixture>(join(fixturesDir, "action.uischema.json"));

    checks.push(
      assert("portal.fixtures-present", principals.length > 0 && scenarios.length > 0, {
        diff: `expected seeded principals + field scenarios in ${FIXTURES_REL}`,
      }),
    );

    // Interim uischema (doc 07 §3 drift-lite): every Control scope resolves against the data schema.
    const props = dataSchema.properties ?? {};
    const controls = (uischema.elements ?? []).filter((e) => e.type === "Control");
    const unresolved = controls
      .map((c) => c.scope ?? "")
      .filter((scope) => !((scope.split("/").pop() ?? "") in props));
    checks.push(
      assert("portal.uischema-resolves", controls.length > 0 && unresolved.length === 0, {
        expected: "every interim uischema Control scope resolves to a data-schema property",
        actual: unresolved.length > 0 ? `unresolved: ${unresolved.join(", ")}` : "all resolve",
      }),
    );

    const ajv = buildAjv();
    const validateSignal = ajv.getSchema(SIGNAL_SCHEMA);
    const validateRecord = ajv.getSchema(RECORD_SCHEMA);
    if (!validateSignal || !validateRecord) {
      return [
        fail("portal.schema-present", {
          diff: `emitted ${SIGNAL_SCHEMA}/${RECORD_SCHEMA} not found; run pnpm --filter @ichiflow/schemas build`,
        }),
      ];
    }

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("portal.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to render the Portal harness`,
        }),
      );
      return checks;
    }

    const r = readJson<PortalResults>(resultsPath);
    const byPrincipal = new Map(r.inbox.map((row) => [row.principal, row]));

    // PDP-filtered rows + SLA ordering, per seeded principal (committed expected = the oracle).
    let totalVisible = 0;
    let totalExpected = 0;
    for (const p of principals) {
      totalExpected += p.expectedInbox.length;
      const row = byPrincipal.get(p.id);
      if (!row) {
        checks.push(
          fail(`portal.pdp-filtered.${p.id}`, {
            diff: `results have no inbox for ${p.id}; run \`${PRODUCER}\``,
          }),
        );
        continue;
      }
      totalVisible += row.visible.length;
      checks.push(
        assert(`portal.pdp-filtered.${p.id}`, sortedEq(row.visible, p.expectedInbox), {
          expected: p.expectedInbox,
          actual: row.visible,
          diff: `${p.id} inbox must be exactly the PDP-permitted id set`,
        }),
      );
      const monotonic = row.dueOrder.every((d, i) => i === 0 || row.dueOrder[i - 1]! <= d);
      checks.push(
        assert(`portal.sla-ordering.${p.id}`, seqEq(row.visible, p.expectedInbox) && monotonic, {
          expected: `${p.id} rows ordered soonest-due first: ${p.expectedInbox.join(", ")}`,
          actual: `${row.visible.join(", ")} (dueMs: ${row.dueOrder.join(", ")})`,
        }),
      );
    }

    checks.push({
      id: "portal.rows-visible",
      status: totalVisible === totalExpected && totalExpected > 0 ? "pass" : "fail",
      metric: "rows_visible",
      value: totalVisible,
      threshold: totalExpected,
    });

    // A cross-team principal sees strictly fewer rows than the in-team baseline.
    checks.push(
      assert(
        "portal.cross-team-fewer",
        r.crossTeam.fewer && r.crossTeam.visibleCount < r.crossTeam.baselineCount,
        {
          expected: `${r.crossTeam.principal} sees fewer rows than ${r.crossTeam.baselinePrincipal}`,
          actual: `${r.crossTeam.visibleCount} vs ${r.crossTeam.baselineCount}`,
        },
      ),
    );

    // Action form signals the Flow — emitted + payload validates against the emitted FlowSignal schema.
    checks.push(
      assert("portal.signal-emitted", r.signal.emitted && r.signal.payload != null, {
        expected: "submitting the action form emits a Flow signal (not a direct mutation)",
        actual: r.signal.emitted ? "emitted" : "no signal emitted",
      }),
    );
    const signalValid = validateSignal(r.signal.payload);
    checks.push(
      assert("portal.signal-valid", signalValid === true, {
        expected: `signal payload conforms to emitted ${SIGNAL_SCHEMA}`,
        actual: signalValid ? "valid" : ajv.errorsText(validateSignal.errors),
        artifact: RESULTS_REL,
      }),
    );

    // Decision trace — the assembled DecisionRecord validates + its nodes render.
    const recordValid = validateRecord(r.trace.record);
    checks.push(
      assert("portal.trace-valid", recordValid === true, {
        expected: `decision trace conforms to emitted ${RECORD_SCHEMA}`,
        actual: recordValid ? "valid" : ajv.errorsText(validateRecord.errors),
      }),
    );
    const hasDecisionNode = r.trace.nodeIds.some((n) => n.startsWith("decision:"));
    const hasTaskNode = r.trace.nodeIds.some((n) => n.startsWith("task:"));
    checks.push(
      assert(
        "portal.trace-nodes",
        r.trace.chainComplete && r.trace.nodeIds.length > 0 && hasDecisionNode && hasTaskNode,
        {
          expected: "chain-complete trace with ≥1 event, decision, and task node rendered",
          actual: `chainComplete=${r.trace.chainComplete}, nodes=${r.trace.nodeIds.length}`,
        },
      ),
    );

    // Field entitlements — rendered states match the committed oracle, incl. ≥1 hidden + ≥1 read-only.
    const fieldByKey = new Map(r.fields.map((f) => [`${f.principal}@${f.caseId}`, f]));
    let anyHidden = false;
    let anyReadOnly = false;
    for (const sc of scenarios) {
      const got = fieldByKey.get(`${sc.principal}@${sc.caseId}`);
      const states = got?.states ?? {};
      const keys = Object.keys(sc.expected);
      const matched = keys.every((k) => states[k] === sc.expected[k]);
      if (Object.values(states).includes("hidden")) anyHidden = true;
      if (Object.values(states).includes("read-only")) anyReadOnly = true;
      checks.push(
        assert(`portal.field-states.${sc.principal}`, matched, {
          expected: sc.expected,
          actual: states,
          diff: `${sc.principal} field render states must match the PDP-derived entitlements`,
        }),
      );
    }
    checks.push(
      assert("portal.field-hidden-present", anyHidden, {
        expected: "≥1 field hidden for a lower-privilege principal (with a why affordance)",
        actual: "no hidden field rendered",
      }),
    );
    checks.push(
      assert("portal.field-readonly-present", anyReadOnly, {
        expected: "≥1 field read-only for a lower-privilege principal",
        actual: "no read-only field rendered",
      }),
    );

    return checks;
  },
};
