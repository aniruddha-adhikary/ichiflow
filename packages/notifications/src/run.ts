import {
  defaultDeliverySpi,
  evaluateVector,
  poisonAwareReceiver,
  runDelivery,
  selectDriver,
  type NotifyEvent,
} from "./delivery.js";
import { loadGoldens, loadReliabilityVectors, loadTemplates } from "./load.js";
import { render, RenderError } from "./templating.js";
import type { NotificationChannel, NotificationTemplate, RenderedMessage } from "./types.js";

export interface RenderGoldenOutcome {
  name: string;
  templateId: string;
  match: boolean;
  actual: RenderedMessage | null;
  error: string | null;
}

export interface DriverSelectionOutcome {
  channel: NotificationChannel;
  driverId: string;
  /** The message really passed through the selected driver (mock capture), proving selection is wired, not asserted. */
  delivered: boolean;
}

export interface ReliabilityOutcomeRecord {
  name: string;
  scenario: string;
  expected: { sent: number; deduped: number; dlq: number };
  actual: { sent: number; deduped: number; dlq: number };
  pass: boolean;
  /** The `notify.*` adapter-call event stream this vector produced — the material the DecisionRecord stitches. */
  events: NotifyEvent[];
}

export interface NotificationsResult {
  templatesCount: number;
  renderGoldens: RenderGoldenOutcome[];
  renderGoldensGreen: number;
  channelsCovered: NotificationChannel[];
  driverSelection: DriverSelectionOutcome[];
  driverSelectionGreen: number;
  reliability: ReliabilityOutcomeRecord[];
  reliabilityGreen: number;
  dedupPass: boolean;
  dlqPass: boolean;
  redeliveryPass: boolean;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/** Stable, order-independent object serialization so a golden match does not depend on key order. */
function canonicalize(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(v as Record<string, unknown>).sort()) {
    out[key] = canonicalize((v as Record<string, unknown>)[key]);
  }
  return out;
}

const EXPECTED_CHANNELS: NotificationChannel[] = ["email", "sms"];

/**
 * Compute the full notifications-harness verdict from the committed fixtures (build plan 5.4, doc 13
 * §2.d). Three check families, all against mocks — no live provider:
 *   - **Render goldens.** Each committed golden's pure `render(template, request)` reproduces its pinned
 *     `RenderedMessage` exactly (a template or param change is a visible golden diff).
 *   - **Delivery-SPI selection.** Every channel selects its provider driver and a message really passes
 *     through the mock capture driver — selection is wired, not merely declared.
 *   - **Idempotency/DLQ vectors.** A duplicate `notificationId` is deduped once, a poison provider
 *     lands the message in the DLQ after bounded attempts, and a redelivery applies once.
 * Pure and deterministic — no I/O beyond the committed fixture read.
 */
export function runNotifications(): NotificationsResult {
  const templates = loadTemplates();
  const goldens = loadGoldens();
  const reliabilityVectors = loadReliabilityVectors();

  const templateById = new Map<string, NotificationTemplate>(
    templates.map((t) => [`${t.id}@${t.version}`, t]),
  );

  const renderGoldens: RenderGoldenOutcome[] = goldens.map((g) => {
    const template = templateById.get(g.templateId);
    if (!template) {
      return {
        name: g.name,
        templateId: g.templateId,
        match: false,
        actual: null,
        error: `no template ${g.templateId}`,
      };
    }
    try {
      const actual = render(template, g.request);
      return {
        name: g.name,
        templateId: g.templateId,
        match: deepEqual(actual, g.expected),
        actual,
        error: null,
      };
    } catch (err) {
      const error = err instanceof RenderError ? err.message : (err as Error).message;
      return { name: g.name, templateId: g.templateId, match: false, actual: null, error };
    }
  });

  // Delivery-SPI selection: for each channel, select its driver and push a representative rendered
  // message through the mock capture driver — proving the channel → driver wiring, not just asserting it.
  const spi = defaultDeliverySpi();
  const driverSelection: DriverSelectionOutcome[] = EXPECTED_CHANNELS.map((channel) => {
    const driver = selectDriver(spi, channel);
    const probe: RenderedMessage = {
      channel,
      locale: "en",
      recipient: channel === "email" ? "probe@example.test" : "+10000000000",
      body: "probe",
    };
    const delivered = driver.send(probe, 1);
    return { channel, driverId: driver.id, delivered };
  });

  const reliability: ReliabilityOutcomeRecord[] = reliabilityVectors.map((vector) => {
    const evaluated = evaluateVector(vector);
    // Re-drive to capture the `notify.*` adapter-call event stream the DecisionRecord's notification
    // family stitches — the concrete tie between this port and build plan 5.4's completeness re-green.
    const events = runDelivery(vector.deliveries, vector.maxAttempts, poisonAwareReceiver()).events;
    return { ...evaluated, events };
  });
  const scenarioPass = (s: string): boolean =>
    reliability.filter((r) => r.scenario === s).every((r) => r.pass) &&
    reliability.some((r) => r.scenario === s);

  return {
    templatesCount: templates.length,
    renderGoldens,
    renderGoldensGreen: renderGoldens.filter((g) => g.match).length,
    channelsCovered: EXPECTED_CHANNELS.filter((c) => templates.some((t) => t.channel === c)),
    driverSelection,
    driverSelectionGreen: driverSelection.filter((d) => d.delivered).length,
    reliability,
    reliabilityGreen: reliability.filter((r) => r.pass).length,
    dedupPass: scenarioPass("duplicate"),
    dlqPass: scenarioPass("poison"),
    redeliveryPass: scenarioPass("redelivery"),
  };
}
