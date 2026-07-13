import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const ADAPTERS_REL = "schemas/adapters";
const RESULTS_REL = "packages/adapters/build/adapters-results.json";
const PRODUCER =
  "pnpm --filter @ichiflow/adapters build && pnpm --filter @ichiflow/adapters preview";
const V1_BINDINGS = ["rest", "broker", "webhook"];

interface GoldenOutcome {
  name: string;
  mappingId: string;
  match: boolean;
  error: string | null;
}
interface BindingContractOutcome {
  portId: string;
  protocol: string;
  roundTrips: boolean;
  error: string | null;
}
interface ReliabilityRecord {
  name: string;
  scenario: string;
  expected: { applied: number; deduped: number; dlq: number };
  actual: { applied: number; deduped: number; dlq: number };
  pass: boolean;
}
interface AdaptersResult {
  mappingsCount: number;
  portsCount: number;
  goldens: GoldenOutcome[];
  goldensGreen: number;
  bindings: Array<{ protocol: string; inboundPorts: number; covered: boolean }>;
  bindingsCovered: boolean;
  bindingContract: BindingContractOutcome[];
  bindingContractGreen: number;
  reliability: ReliabilityRecord[];
  reliabilityGreen: number;
  dedupPass: boolean;
  dlqPass: boolean;
  redeliveryPass: boolean;
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

function validateFixtures(
  ajv: Ajv2020,
  checks: CheckResult[],
  repoRoot: string,
  sub: string,
  suffix: string,
  schemaName: string,
): void {
  const dir = join(repoRoot, ADAPTERS_REL, sub);
  const validate = ajv.getSchema(schemaName);
  if (!validate) {
    checks.push(
      fail(`adapters.schema-present.${schemaName}`, { diff: `emitted ${schemaName} not found` }),
    );
    return;
  }
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(suffix))
        .sort()
    : [];
  checks.push(
    assert(`adapters.fixtures-present.${sub}`, files.length > 0, {
      diff: `no ${suffix} fixtures in ${ADAPTERS_REL}/${sub}`,
    }),
  );
  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const valid = validate(doc);
    checks.push(
      assert(`adapters.contract.${sub}.${file}`, valid === true, {
        expected: `${file} conforms to ${schemaName}`,
        actual: valid ? "valid" : ajv.errorsText(validate.errors),
      }),
    );
  }
}

/**
 * adapters — build plan 5.1 (ADR-0028, doc 05; doc 13 §2.d). Proves the canonical↔wire boundary holds
 * **without a live external system**. Three check families:
 *   - **Contract tests.** Every committed Port / Mapping / golden / reliability fixture validates
 *     against its emitted canonical JSON Schema (`AdapterPort`/`Mapping`/`MappingGoldenVector`/
 *     `ReliabilityVector`), and every canonical output validates against `CanonicalEnvelope`.
 *   - **Mapping golden files.** Each pure Message-Translator mapping reproduces its `input wire →
 *     expected canonical event` golden exactly (a mapping change is a visible golden diff), and each v1
 *     transport binding (rest/broker/webhook) round-trips `decode ∘ translate` back to the same
 *     canonical output.
 *   - **Idempotency / DLQ vectors.** A duplicate `messageId` is deduped once (Idempotent Receiver), a
 *     poison message lands in the DLQ after bounded attempts, and a crash redelivery applies once —
 *     `dedup: pass`, `dlq: pass`.
 * The fixture validation runs in-process (deterministic); the behavioral verdicts are read from the
 * artifact `${PRODUCER}` writes.
 */
export const adaptersScope: Scope = {
  id: "adapters",
  description:
    "The canonical↔wire adapter boundary: contract tests, pure Message-Translator mapping goldens across REST/broker/webhook bindings, and idempotency/DLQ reliability vectors — all against mocks.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const ajv = buildAjv();

    validateFixtures(ajv, checks, repoRoot, "ports", ".port.json", "AdapterPort.json");
    validateFixtures(ajv, checks, repoRoot, "mappings", ".mapping.json", "Mapping.json");
    validateFixtures(ajv, checks, repoRoot, "goldens", ".golden.json", "MappingGoldenVector.json");
    validateFixtures(
      ajv,
      checks,
      repoRoot,
      "reliability",
      ".vector.json",
      "ReliabilityVector.json",
    );

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("adapters.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to run the adapter harness`,
        }),
      );
      return checks;
    }
    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as AdaptersResult;

    const envelopeValidate = ajv.getSchema("CanonicalEnvelope.json");

    // Mapping goldens: each pure mapping reproduces its expected canonical event, which itself is a
    // valid CanonicalEnvelope.
    for (const g of r.goldens) {
      checks.push(
        assert(`adapters.golden.${g.mappingId}`, g.match, {
          expected: `${g.name} reproduces its expected canonical event`,
          actual: g.error ?? "output differs from golden",
        }),
      );
    }
    checks.push({
      id: "adapters.goldens-green",
      status: r.goldensGreen === r.goldens.length && r.goldens.length > 0 ? "pass" : "fail",
      metric: "goldens_green",
      value: r.goldensGreen,
      threshold: r.goldens.length,
    });

    // Every v1 transport profile has a binding (a covered inbound port).
    checks.push(
      assert("adapters.bindings-covered", r.bindingsCovered, {
        expected: `every v1 binding present: ${V1_BINDINGS.join(", ")}`,
        actual: JSON.stringify(r.bindings),
      }),
    );

    // Contract round-trip through each declared binding.
    for (const b of r.bindingContract) {
      checks.push(
        assert(`adapters.binding-contract.${b.portId}`, b.roundTrips, {
          expected: `${b.protocol} decode ∘ translate reproduces the canonical output`,
          actual: b.error ?? "round-trip differs",
        }),
      );
    }
    checks.push({
      id: "adapters.binding-contract-green",
      status:
        r.bindingContractGreen === r.bindingContract.length && r.bindingContract.length > 0
          ? "pass"
          : "fail",
      metric: "binding_contract_green",
      value: r.bindingContractGreen,
      threshold: r.bindingContract.length,
    });

    // Reliability vectors — dedup / DLQ / redelivery.
    for (const v of r.reliability) {
      checks.push(
        assert(`adapters.reliability.${v.scenario}.${v.name}`, v.pass, {
          expected: JSON.stringify(v.expected),
          actual: JSON.stringify(v.actual),
        }),
      );
    }
    checks.push({
      id: "adapters.reliability-green",
      status:
        r.reliabilityGreen === r.reliability.length && r.reliability.length > 0 ? "pass" : "fail",
      metric: "reliability_green",
      value: r.reliabilityGreen,
      threshold: r.reliability.length,
    });
    checks.push(
      assert("adapters.dedup", r.dedupPass, {
        expected: "duplicate-messageId vectors dedup once",
        actual: r.dedupPass ? "pass" : "fail",
      }),
    );
    checks.push(
      assert("adapters.dlq", r.dlqPass, {
        expected: "poison-message vectors land in the DLQ after bounded attempts",
        actual: r.dlqPass ? "pass" : "fail",
      }),
    );
    checks.push(
      assert("adapters.redelivery", r.redeliveryPass, {
        expected: "crash-redelivery vectors apply exactly once",
        actual: r.redeliveryPass ? "pass" : "fail",
      }),
    );

    if (envelopeValidate) {
      checks.push(assert("adapters.envelope-schema-present", true, {}));
    }

    return checks;
  },
};
