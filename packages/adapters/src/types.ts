/**
 * TypeScript mirror of the canonical adapter contract (`schemas/adapters.tsp`, doc 05). The emitted
 * JSON Schema is the contract of record; these types are the in-process shape the runtime + harness
 * operate on. The `adapters` verify scope validates the committed fixtures against the emitted schema,
 * so drift between these types and the schema surfaces as a failed check.
 */

export type CanonicalKind = "Command" | "Event";
export type PortDirection = "inbound" | "outbound";
export type AdapterProtocol = "rest" | "broker" | "webhook";
export type MappingOp = "copy" | "constant" | "copyNumber";

export interface CanonicalEnvelope {
  kind: CanonicalKind;
  type: string;
  messageId: string;
  correlationId: string;
  caseId: string;
  payload: Record<string, unknown>;
}

export interface MappingRule {
  operation: MappingOp;
  from?: string;
  to: string;
  value?: unknown;
  optional?: boolean;
}

export interface Mapping {
  id: string;
  schemaVersion: "adapter/v1";
  version: string;
  direction: PortDirection;
  kind: CanonicalKind;
  canonicalType: string;
  messageIdFrom: string;
  correlationFrom: string;
  caseIdFrom: string;
  rules: MappingRule[];
}

export interface Reliability {
  maxAttempts: number;
  dedup: boolean;
  dlq: boolean;
}

export interface AdapterPort {
  id: string;
  schemaVersion: "adapter/v1";
  direction: PortDirection;
  protocol: AdapterProtocol;
  canonicalType: string;
  mapping: string;
  reliability: Reliability;
}

export type ReliabilityScenario = "duplicate" | "poison" | "redelivery";

export interface InboundMessage {
  messageId: string;
  poison?: boolean;
}

export interface ReliabilityVector {
  name: string;
  scenario: ReliabilityScenario;
  maxAttempts: number;
  messages: InboundMessage[];
  expect: { applied: number; deduped: number; dlq: number };
}

export interface MappingGoldenVector {
  name: string;
  mappingId: string;
  wire: Record<string, unknown>;
  expected: CanonicalEnvelope;
}
