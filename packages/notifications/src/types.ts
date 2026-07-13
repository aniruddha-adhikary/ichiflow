/**
 * TypeScript mirror of the canonical notification contract (`schemas/notifications.tsp`, doc 05 §4.2).
 * The emitted JSON Schema is the contract of record; these types are the in-process shape the delivery
 * SPI + harness operate on. The `notifications` verify scope validates the committed fixtures against
 * the emitted schema, so drift between these types and the schema surfaces as a failed check.
 */

export type NotificationChannel = "email" | "sms";
export type DeliveryDisposition = "sent" | "deduped" | "dlq";
export type NotificationReliabilityScenario = "duplicate" | "poison" | "redelivery";

export interface NotificationText {
  subject?: string;
  body: string;
}

export interface NotificationTemplate {
  schemaVersion: "notification/v1";
  id: string;
  version: string;
  channel: NotificationChannel;
  codeSet: string;
  text: Record<string, NotificationText>;
  params: string[];
}

export interface NotificationRequest {
  schemaVersion: "notification/v1";
  notificationId: string;
  correlationId: string;
  caseId: string;
  stepId: string;
  template: string;
  locale: string;
  recipient: string;
  params: Record<string, string>;
}

export interface RenderedMessage {
  channel: NotificationChannel;
  locale: string;
  recipient: string;
  subject?: string;
  body: string;
}

export interface NotificationGolden {
  name: string;
  templateId: string;
  request: NotificationRequest;
  expected: RenderedMessage;
}

export interface NotificationDeliveryAttempt {
  notificationId: string;
  poison?: boolean;
}

export interface NotificationDispositionCounts {
  sent: number;
  deduped: number;
  dlq: number;
}

export interface NotificationReliabilityVector {
  name: string;
  scenario: NotificationReliabilityScenario;
  maxAttempts: number;
  deliveries: NotificationDeliveryAttempt[];
  expect: NotificationDispositionCounts;
}
