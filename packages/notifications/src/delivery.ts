import type {
  DeliveryDisposition,
  NotificationChannel,
  NotificationDeliveryAttempt,
  NotificationReliabilityVector,
  RenderedMessage,
} from "./types.js";

/**
 * The **delivery SPI** (doc 05 §4.2). A notification is delivered through a provider **driver** selected
 * by `channel` — an SMTP/ESP driver for email, an SMS-gateway driver for SMS — exactly as any other
 * outbound Adapter binding selects a transport by `channel.protocol`. A driver is a deterministic
 * boundary: `send` returns whether the provider accepted this attempt. The v1 SPI ships mock capture
 * drivers so the layer is harness-verifiable without a live provider (doc 13 §2.d).
 */
export interface NotificationDriver {
  /** Stable driver id (e.g. `smtp-capture`) — the selection the harness pins. */
  id: string;

  /** The channel this driver serves. */
  protocol: NotificationChannel;

  /** Deterministic delivery attempt: return true to accept, false to fail (a poison provider keeps failing). */
  send(message: RenderedMessage, attempt: number): boolean;
}

/** A mock provider driver that captures accepted messages instead of hitting a live provider. */
export interface CaptureDriver extends NotificationDriver {
  /** The messages the driver accepted, in delivery order — the audit surface the harness inspects. */
  readonly sent: RenderedMessage[];
}

/** Build a deterministic capture driver for a channel: it accepts every attempt and records the message. */
export function captureDriver(protocol: NotificationChannel, id: string): CaptureDriver {
  const sent: RenderedMessage[] = [];
  return {
    id,
    protocol,
    sent,
    send(message: RenderedMessage): boolean {
      sent.push(message);
      return true;
    },
  };
}

/**
 * The default v1 **delivery SPI**: one provider driver per channel (doc 05 §4.2). A live deployment
 * swaps a capture driver for a real SMTP/ESP or SMS-gateway driver behind the same interface; the
 * selection contract (channel → driver) is unchanged.
 */
export function defaultDeliverySpi(): Map<NotificationChannel, NotificationDriver> {
  return new Map<NotificationChannel, NotificationDriver>([
    ["email", captureDriver("email", "smtp-capture")],
    ["sms", captureDriver("sms", "sms-gateway-capture")],
  ]);
}

/** Select the provider driver for a channel; an unbound channel is a configuration error, never a silent drop. */
export function selectDriver(
  spi: Map<NotificationChannel, NotificationDriver>,
  channel: NotificationChannel,
): NotificationDriver {
  const driver = spi.get(channel);
  if (!driver) throw new Error(`no delivery driver bound for channel ${channel}`);
  return driver;
}

/** One `notify.*` adapter-call event the delivery emits — the material the DecisionRecord stitches (doc 08 §5). */
export interface NotifyEvent {
  seq: number;
  type: "notify.requested" | "notify.sent" | "notify.deduped" | "notify.dlq";
  notificationId: string;
}

export interface DeliveryOutcome {
  sent: number;
  deduped: number;
  dlq: number;
  /** Ordered per-delivery dispositions — useful for golden-style inspection. */
  dispositions: Array<{
    notificationId: string;
    disposition: DeliveryDisposition;
    attempts: number;
  }>;
  /** The ordered `notify.*` adapter-call event stream the DecisionRecord's notification family stitches. */
  events: NotifyEvent[];
}

/** A deterministic delivery handler: return true to accept this attempt, false to fail (a poison provider keeps failing). */
export interface DeliveryReceiver {
  handle: (delivery: NotificationDeliveryAttempt, attempt: number) => boolean;
}

/**
 * Drive a delivery sequence through the **Idempotent Receiver + bounded-retry DLQ** machinery (doc 05
 * §reliability), keyed by `notificationId`. Deterministic — the same sequence + handler always produce
 * the same dispositions and the same `notify.*` event stream:
 *   - a duplicate `notificationId` is deduped once (`notify.deduped`), never delivered twice;
 *   - a provider that keeps failing is retried up to `maxAttempts` then quarantined (`notify.dlq`);
 *   - a crash-redelivered message with a seen id is deduped, so replay does not double-send.
 */
export function runDelivery(
  deliveries: NotificationDeliveryAttempt[],
  maxAttempts: number,
  receiver: DeliveryReceiver,
): DeliveryOutcome {
  const seen = new Set<string>();
  const outcome: DeliveryOutcome = { sent: 0, deduped: 0, dlq: 0, dispositions: [], events: [] };
  const emit = (type: NotifyEvent["type"], notificationId: string): void => {
    outcome.events.push({ seq: outcome.events.length, type, notificationId });
  };

  for (const delivery of deliveries) {
    emit("notify.requested", delivery.notificationId);
    if (seen.has(delivery.notificationId)) {
      outcome.deduped += 1;
      outcome.dispositions.push({
        notificationId: delivery.notificationId,
        disposition: "deduped",
        attempts: 0,
      });
      emit("notify.deduped", delivery.notificationId);
      continue;
    }

    let accepted = false;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      if (receiver.handle(delivery, attempt)) {
        accepted = true;
        break;
      }
    }

    if (accepted) {
      // Idempotency key recorded on acceptance — subsequent copies dedup (never double-send).
      seen.add(delivery.notificationId);
      outcome.sent += 1;
      outcome.dispositions.push({
        notificationId: delivery.notificationId,
        disposition: "sent",
        attempts,
      });
      emit("notify.sent", delivery.notificationId);
    } else {
      // Attempts exhausted: quarantine, do not mark seen (a corrected resend is a new delivery).
      outcome.dlq += 1;
      outcome.dispositions.push({
        notificationId: delivery.notificationId,
        disposition: "dlq",
        attempts,
      });
      emit("notify.dlq", delivery.notificationId);
    }
  }

  return outcome;
}

/** The canonical receiver for the reliability vectors: fails every attempt iff a delivery is flagged `poison`. */
export function poisonAwareReceiver(): DeliveryReceiver {
  return { handle: (delivery) => delivery.poison !== true };
}

/** Run one reliability vector and report whether the pinned disposition counts held. */
export function evaluateVector(vector: NotificationReliabilityVector): {
  name: string;
  scenario: string;
  expected: NotificationReliabilityVector["expect"];
  actual: { sent: number; deduped: number; dlq: number };
  pass: boolean;
} {
  const outcome = runDelivery(vector.deliveries, vector.maxAttempts, poisonAwareReceiver());
  const actual = { sent: outcome.sent, deduped: outcome.deduped, dlq: outcome.dlq };
  const pass =
    actual.sent === vector.expect.sent &&
    actual.deduped === vector.expect.deduped &&
    actual.dlq === vector.expect.dlq;
  return { name: vector.name, scenario: vector.scenario, expected: vector.expect, actual, pass };
}
