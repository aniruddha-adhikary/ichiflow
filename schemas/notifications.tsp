import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The canonical ichiflow **Notifications** layer (build plan 5.4; doc 05 §4.2). Enterprise workflows are
 * heavy with outbound communication — status notifications, request-for-information prompts,
 * adverse-action correspondence. ichiflow does **not** invent a parallel delivery stack for this:
 * **email and SMS are ordinary outbound Adapter port types**, and a notification is a canonical outbound
 * event fed from the core's transactional outbox and delivered through a provider **delivery SPI**
 * selected by `channel` (an SMTP/ESP driver for email, an SMS-gateway driver for SMS).
 *
 * Two properties make the layer harness-verifiable **without a live provider** (doc 13 §2.d, mirroring
 * the adapter reliability stance):
 *   - **Content is governed and templated** (doc 05 §4.2): a `NotificationTemplate` carries a
 *     **per-locale plain-language map** (the `plainLanguage` i18n text, doc 02 §9.2) and references a
 *     governed CodeSet for its coded content, so a notification says the same thing, in the same words,
 *     as the Portal and the why API. Rendering is a **pure** substitution of declared params into the
 *     locale's text — its goldens (`request → rendered message`) are stable.
 *   - **At-least-once, emulated** (doc 05 §reliability): delivery reuses the Idempotent Receiver
 *     (a stable `notificationId` deduped once) + bounded retries then a Dead Letter Channel (a provider
 *     that keeps failing is quarantined, never dropped and never retried forever).
 *
 * Each request carries a **Correlation Identifier** tying it to a `caseId` and a `stepId` — the keys the
 * DecisionRecord (build plan 5.4/3.4) stitches its `notify.*` adapter-call events by (doc 08 §5).
 */
@jsonSchema
namespace Ichiflow.Notifications;

/** The pinned notification-artifact schema version a Template/Request declares (doc 05 §9, contract versioning). */
union NotificationSchemaVersion {
  v1: "notification/v1",
}

/**
 * The outbound channel a notification is delivered over (doc 05 §4.2). Each is an ordinary outbound
 * Adapter port type whose provider driver is selected by this value; the v1 delivery SPI ships an
 * email (SMTP/ESP) driver and an SMS (gateway) driver, both driven against a mock (no live provider).
 */
union NotificationChannel {
  /** Email — delivered through an SMTP/ESP provider driver. */
  email: "email",

  /** SMS — delivered through an SMS-gateway provider driver. */
  sms: "sms",
}

/** How a delivery settled (doc 05 §reliability) — the terminal disposition the DecisionRecord stitches. */
union DeliveryDisposition {
  /** Delivered once by the selected provider driver. */
  sent: "sent",

  /** A duplicate `notificationId` deduped once by the Idempotent Receiver (never delivered twice). */
  deduped: "deduped",

  /** Quarantined in the Dead Letter Channel after bounded attempts (never dropped, never retried forever). */
  dlq: "dlq",
}

/**
 * The per-locale text a `NotificationTemplate` renders from (doc 02 §9.2 plain-language map). `body` is
 * required; `subject` applies to `email` only. Both may carry `{{param}}` placeholders substituted from
 * the request's declared `params` — rendering is a **pure** function of (template, locale, params).
 */
model NotificationText {
  /** Subject line (email channel); rendered with the same `{{param}}` substitution as `body`. */
  subject?: string;

  /** Message body — the plain-language text for this locale. */
  body: string;
}

/**
 * A governed **notification template** (doc 05 §4.2). Content is templated and references a governed
 * CodeSet (`codeSet`) for its coded content; `text` is the per-locale plain-language i18n map keyed by
 * BCP-47 locale. `params` declares the substitution parameters a request must supply — a request whose
 * params do not cover the template's declared set is a render error, so the goldens stay total.
 */
model NotificationTemplate {
  schemaVersion: NotificationSchemaVersion;

  /** Stable template id (e.g. `permit-issued`). */
  id: string;

  /** Semantic version of the template content (a text change bumps this). */
  version: string;

  /** The channel this template's text is authored for. */
  channel: NotificationChannel;

  /** The governed CodeSet ref providing the template's coded content / per-audience text (doc 02 §9). */
  codeSet: string;

  /** The per-locale plain-language text (BCP-47 key → text), rendered by pure param substitution. */
  text: Record<NotificationText>;

  /** The substitution parameters a request must supply (every `{{param}}` in the text). */
  params: string[];
}

/**
 * A canonical **notification request** (doc 05 §4.2) — the outbound event fed from the transactional
 * outbox to the notification port. `notificationId` is the stable idempotency key the Idempotent
 * Receiver dedups on; `correlationId` + `caseId` + `stepId` tie it to its Case for DecisionRecord
 * stitching. `params` supplies the values the referenced template substitutes for its declared params.
 */
model NotificationRequest {
  schemaVersion: NotificationSchemaVersion;

  /** Stable idempotency key — delivery dedups on this (doc 05 §reliability). */
  notificationId: string;

  /** Correlation Identifier tying the request to its Case (doc 05 §11). */
  correlationId: string;

  /** The Case this notification belongs to — a DecisionRecord stitch key (doc 04 §5.1). */
  caseId: string;

  /** The flow step that requested the notification — the DecisionRecord stitch key for `notify.*` events. */
  stepId: string;

  /** The referenced template (`id@version`); its `channel` selects the provider driver. */
  template: string;

  /** The BCP-47 locale to render — must resolve to an entry in the template's `text` map. */
  locale: string;

  /** The delivery address (email address / phone number) — opaque to rendering. */
  recipient: string;

  /** The substitution values for the template's declared `params`. */
  params: Record<string>;
}

/**
 * A **rendered message** — the pure output of applying a `NotificationRequest` to its template's
 * locale text. The provider driver delivers exactly this; its bytes are stable, so a template or param
 * change is a visible golden diff (doc 13 §2.d).
 */
model RenderedMessage {
  channel: NotificationChannel;

  /** The BCP-47 locale rendered. */
  locale: string;

  /** The delivery address. */
  recipient: string;

  /** Rendered subject line (email only). */
  subject?: string;

  /** Rendered message body. */
  body: string;
}

/** A committed **render golden** (build plan 5.4, harness-first): a request + the exact `RenderedMessage` the pure renderer must produce. */
model NotificationGolden {
  /** Human-readable golden name; doubles as intent documentation. */
  name: string;

  /** The template id (`id@version`) the request renders against. */
  templateId: string;

  /** The notification request to render. */
  request: NotificationRequest;

  /** The pinned rendered message the pure renderer must reproduce. */
  expected: RenderedMessage;
}

/** The reliability scenario a notification vector exercises (doc 05 §reliability) — mirrors the adapter set. */
union NotificationReliabilityScenario {
  /** A duplicate `notificationId` must be deduped once (delivered exactly once). */
  duplicate: "duplicate",

  /** A provider that keeps failing must land the message in the DLQ after bounded attempts. */
  poison: "poison",

  /** A crash-redelivered message with a seen `notificationId` must apply exactly once. */
  redelivery: "redelivery",
}

/** One inbound copy of a notification in a reliability vector — a `notificationId` plus whether the provider rejects it. */
model NotificationDeliveryAttempt {
  /** The idempotency key delivery dedups on. */
  notificationId: string;

  /** True iff the selected provider driver deterministically fails every attempt (a poison delivery). */
  poison?: boolean;
}

/**
 * A committed **idempotency/DLQ vector** (build plan 5.4, harness-first). Drives a sequence of delivery
 * attempts through the Idempotent Receiver + bounded-retry DLQ machinery and pins the disposition
 * counts, so `dedup`/`dlq`/`redelivery` are proven, not assumed.
 */
model NotificationReliabilityVector {
  /** Human-readable vector name. */
  name: string;

  scenario: NotificationReliabilityScenario;

  /** Bounded retry attempts before a failing delivery is quarantined in the DLQ. */
  @minValue(1)
  maxAttempts: int32;

  /** The ordered delivery attempts to drive. */
  deliveries: NotificationDeliveryAttempt[];

  /** The pinned disposition counts. */
  expect: NotificationDispositionCounts;
}

/** The pinned outcome of a reliability vector — how many deliveries were sent / deduped / quarantined. */
model NotificationDispositionCounts {
  /** Deliveries delivered exactly once by the provider driver. */
  @minValue(0)
  sent: int32;

  /** Duplicate deliveries deduped once. */
  @minValue(0)
  deduped: int32;

  /** Deliveries quarantined in the DLQ after bounded attempts. */
  @minValue(0)
  dlq: int32;
}
