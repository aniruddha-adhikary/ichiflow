import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const NOTIFICATIONS_REL = "schemas/notifications";
const RESULTS_REL = "packages/notifications/build/notifications-results.json";
const PRODUCER =
  "pnpm --filter @ichiflow/notifications build && pnpm --filter @ichiflow/notifications preview";
const EXPECTED_CHANNELS = ["email", "sms"];

interface RenderGoldenOutcome {
  name: string;
  templateId: string;
  match: boolean;
  error: string | null;
}
interface DriverSelectionOutcome {
  channel: string;
  driverId: string;
  delivered: boolean;
}
interface ReliabilityRecord {
  name: string;
  scenario: string;
  expected: { sent: number; deduped: number; dlq: number };
  actual: { sent: number; deduped: number; dlq: number };
  pass: boolean;
}
interface NotificationsResult {
  templatesCount: number;
  renderGoldens: RenderGoldenOutcome[];
  renderGoldensGreen: number;
  channelsCovered: string[];
  driverSelection: DriverSelectionOutcome[];
  driverSelectionGreen: number;
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
  const dir = join(repoRoot, NOTIFICATIONS_REL, sub);
  const validate = ajv.getSchema(schemaName);
  if (!validate) {
    checks.push(
      fail(`notifications.schema-present.${schemaName}`, {
        diff: `emitted ${schemaName} not found; run pnpm --filter @ichiflow/schemas build`,
      }),
    );
    return;
  }
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(suffix))
        .sort()
    : [];
  checks.push(
    assert(`notifications.fixtures-present.${sub}`, files.length > 0, {
      diff: `no ${suffix} fixtures in ${NOTIFICATIONS_REL}/${sub}`,
    }),
  );
  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const valid = validate(doc);
    checks.push(
      assert(`notifications.contract.${sub}.${file}`, valid === true, {
        expected: `${file} conforms to ${schemaName}`,
        actual: valid ? "valid" : ajv.errorsText(validate.errors),
      }),
    );
  }
}

/**
 * notifications — build plan 5.4 (doc 05 §4.2; doc 13 §2.d). Proves the outbound notification boundary
 * — email/SMS as ordinary outbound Adapter port types — **without a live provider**. Three check
 * families:
 *   - **Contract tests.** Every committed Template / render golden / reliability vector validates
 *     against its emitted canonical JSON Schema (`NotificationTemplate` / `NotificationGolden` /
 *     `NotificationReliabilityVector`).
 *   - **Render goldens.** Each governed template's **pure** `render(template, request)` reproduces its
 *     pinned `RenderedMessage` exactly — a template or param change is a visible golden diff — and every
 *     v1 channel (email/sms) is covered by a template.
 *   - **Delivery-SPI selection + idempotency/DLQ vectors.** Each channel selects its provider driver
 *     and a message really passes through the mock capture driver; a duplicate `notificationId` is
 *     deduped once (Idempotent Receiver), a poison provider lands the message in the DLQ after bounded
 *     attempts, and a crash redelivery sends once — `dedup: pass`, `dlq: pass`.
 * The fixture validation runs in-process (deterministic); the behavioral verdicts are read from the
 * artifact `${PRODUCER}` writes.
 */
export const notificationsScope: Scope = {
  id: "notifications",
  description:
    "The outbound notification boundary (email/SMS as Adapter port types): contract tests, governed per-locale render goldens, delivery-SPI driver selection, and idempotency/DLQ vectors — all against mocks.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const ajv = buildAjv();

    validateFixtures(
      ajv,
      checks,
      repoRoot,
      "templates",
      ".template.json",
      "NotificationTemplate.json",
    );
    validateFixtures(ajv, checks, repoRoot, "goldens", ".golden.json", "NotificationGolden.json");
    validateFixtures(
      ajv,
      checks,
      repoRoot,
      "reliability",
      ".vector.json",
      "NotificationReliabilityVector.json",
    );

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("notifications.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to run the notifications harness`,
        }),
      );
      return checks;
    }
    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as NotificationsResult;

    // Render goldens: each pure render reproduces its expected RenderedMessage.
    for (const g of r.renderGoldens) {
      checks.push(
        assert(`notifications.render-golden.${g.templateId}.${g.name}`, g.match, {
          expected: `${g.name} renders its pinned message`,
          actual: g.error ?? "rendered output differs from golden",
        }),
      );
    }
    checks.push({
      id: "notifications.render-goldens-green",
      status:
        r.renderGoldensGreen === r.renderGoldens.length && r.renderGoldens.length > 0
          ? "pass"
          : "fail",
      metric: "render_goldens_green",
      value: r.renderGoldensGreen,
      threshold: r.renderGoldens.length,
    });

    // Every v1 channel is covered by a governed template.
    checks.push(
      assert(
        "notifications.channels-covered",
        EXPECTED_CHANNELS.every((c) => r.channelsCovered.includes(c)),
        {
          expected: `every v1 channel covered: ${EXPECTED_CHANNELS.join(", ")}`,
          actual: JSON.stringify(r.channelsCovered),
        },
      ),
    );

    // Delivery-SPI selection: each channel selects a driver and the message really passes through it.
    for (const d of r.driverSelection) {
      checks.push(
        assert(
          `notifications.driver-selection.${d.channel}`,
          d.delivered && d.driverId.length > 0,
          {
            expected: `${d.channel} selects a provider driver and delivers through it`,
            actual: `driver=${d.driverId}, delivered=${d.delivered}`,
          },
        ),
      );
    }
    checks.push({
      id: "notifications.driver-selection-green",
      status:
        r.driverSelectionGreen === r.driverSelection.length && r.driverSelection.length > 0
          ? "pass"
          : "fail",
      metric: "driver_selection_green",
      value: r.driverSelectionGreen,
      threshold: r.driverSelection.length,
    });

    // Reliability vectors — dedup / DLQ / redelivery.
    for (const v of r.reliability) {
      checks.push(
        assert(`notifications.reliability.${v.scenario}.${v.name}`, v.pass, {
          expected: JSON.stringify(v.expected),
          actual: JSON.stringify(v.actual),
        }),
      );
    }
    checks.push({
      id: "notifications.reliability-green",
      status:
        r.reliabilityGreen === r.reliability.length && r.reliability.length > 0 ? "pass" : "fail",
      metric: "reliability_green",
      value: r.reliabilityGreen,
      threshold: r.reliability.length,
    });
    checks.push(
      assert("notifications.dedup", r.dedupPass, {
        expected: "duplicate-notificationId vectors dedup once",
        actual: r.dedupPass ? "pass" : "fail",
      }),
    );
    checks.push(
      assert("notifications.dlq", r.dlqPass, {
        expected: "poison-provider vectors land in the DLQ after bounded attempts",
        actual: r.dlqPass ? "pass" : "fail",
      }),
    );
    checks.push(
      assert("notifications.redelivery", r.redeliveryPass, {
        expected: "crash-redelivery vectors send exactly once",
        actual: r.redeliveryPass ? "pass" : "fail",
      }),
    );

    return checks;
  },
};
