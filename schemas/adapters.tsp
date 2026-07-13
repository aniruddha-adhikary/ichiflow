import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The canonical ichiflow **Adapter** layer (build plan 5.1; doc 05, ADR-0028). Adapters are the
 * boundary between the **canonical** command/event bus at the core and the **wire** formats external
 * systems speak. An Adapter is a declared artifact — a `Port` (its transport binding + contract) plus a
 * versioned **Message-Translator `Mapping`** — that a generator can emit and a validator can check
 * pre-deploy (doc 05 §1). The runtime binding executes the declaration; the core only ever sees
 * canonical `CanonicalEnvelope`s.
 *
 * Two invariants make the boundary harness-verifiable **without a live external system** (doc 13 §2.d):
 *   - **Mapping purity** (doc 05 §2): a `Mapping` is a **pure function of the decoded wire message** —
 *     no I/O, no cross-message state, no enrichment-by-lookup. Because it is pure its golden pairs
 *     (`input wire → expected canonical event`) are stable, and an AI-regenerated mapping must
 *     reproduce them or explain the diff.
 *   - **Reliability contract** (doc 05 §reliability): at-least-once delivery emulated with an
 *     **Idempotent Receiver** (a stable `messageId` deduped once at the inbound edge) + bounded
 *     exponential retries then a **Dead Letter Channel** (a poison message is quarantined, never a
 *     silently-lost or infinitely-retried message), and crash **redelivery applies once**.
 *
 * Every message carries a **Correlation Identifier** tying it to a `caseId` (doc 05 §11), the key the
 * DecisionRecord (build plan 5.4/3.4) stitches adapter-call events by.
 */
@jsonSchema
namespace Ichiflow.Adapters;

/** The pinned adapter-artifact schema version a Port/Mapping declares (doc 05 §9, contract versioning). */
union AdapterSchemaVersion {
  v1: "adapter/v1",
}

/** The transport binding a Port speaks (doc 05 §11.2). v1 ships REST + one message broker + webhook; each runs the same §2.d vector set against its mock. SFTP is design-only/post-v1 (ADR-0028). */
union AdapterProtocol {
  /** Synchronous HTTP request/response (REST in or out). */
  rest: "rest",

  /** A message broker (queue/topic) — publish/consume, driven against a mock broker (no live MQ/Kafka). */
  broker: "broker",

  /** An inbound HTTP webhook the core exposes for external callbacks. */
  webhook: "webhook",
}

/** The direction a Port moves messages relative to the core (doc 05 §3). */
union PortDirection {
  /** Wire → canonical: decode an external message, translate, publish onto the canonical bus. */
  inbound: "inbound",

  /** Canonical → wire: translate a canonical event from the outbox, encode, deliver with retry/DLQ. */
  outbound: "outbound",
}

/** Whether a canonical message is a `Command` (an imperative request) or an `Event` (a fact) on the bus (doc 05 §1). */
union CanonicalKind {
  Command: "Command",
  Event: "Event",
}

/**
 * A **canonical envelope** (doc 05 §1) — the only shape the core sees. `type` is a versioned canonical
 * name (`loan.application.received.v1`); `messageId` is the stable idempotency key checked by the
 * Idempotent Receiver; `correlationId` + `caseId` tie the message to its Case (doc 05 §11).
 */
model CanonicalEnvelope {
  kind: CanonicalKind;

  /** The versioned canonical type, e.g. `loan.application.received.v1`. */
  @pattern("^[a-z][a-z0-9]*([.][a-z0-9]+)+[.]v[0-9]+$")
  type: string;

  /** Stable idempotency key — the Idempotent Receiver dedups on this (doc 05 §reliability). */
  messageId: string;

  /** Correlation Identifier tying async request/reply and every message to its Case (doc 05 §11). */
  correlationId: string;

  /** The Case this message belongs to — the DecisionRecord stitch key (doc 04 §5.1). */
  caseId: string;

  /** The translated canonical body (a pure function of the decoded wire message). */
  payload: Record<unknown>;
}

/** How a single canonical field is produced from the decoded wire message — the closed, **pure** op set of the Message-Translator (doc 05 §2). */
union MappingOp {
  /** Copy the value at the wire JSON Pointer `from` to the canonical field `to`. */
  copy: "copy",

  /** Assign the literal `value` to the canonical field `to` (no wire read). */
  constant: "constant",

  /** Copy the value at `from`, coercing a numeric string to a number (a common wire→canonical normalization). */
  copyNumber: "copyNumber",
}

/**
 * One declarative **Message-Translator rule** (doc 05 §2). Rules are evaluated in order into the
 * canonical `payload`; each is a pure transform of the decoded input, so the mapping's golden pairs are
 * stable. `from` is a JSON Pointer into the wire message (RFC 6901); `to` is a dotted canonical path.
 */
model MappingRule {
  operation: MappingOp;

  /** JSON Pointer (RFC 6901) into the decoded wire message; required for `copy`/`copyNumber`. */
  from?: string;

  /** Dotted path into the canonical `payload` this rule writes (e.g. `applicant.id`). */
  to: string;

  /** The literal value for a `constant` op. */
  value?: unknown;

  /** When true, a missing/undefined `from` value is allowed (the field is simply omitted); otherwise it is a mapping error. */
  optional?: boolean;
}

/**
 * A versioned **Message-Translator mapping** (doc 05 §2) — the declarative, **pure** function from a
 * decoded wire message to a `CanonicalEnvelope`. `correlationFrom`/`caseIdFrom`/`messageIdFrom` are wire
 * JSON Pointers that populate the envelope's correlation triple (doc 05 §11); `rules` populate the
 * payload. A change that alters an output is a visible golden diff.
 */
model Mapping {
  id: string;

  schemaVersion: AdapterSchemaVersion;

  version: string;

  direction: PortDirection;

  /** The canonical `kind` this mapping emits. */
  kind: CanonicalKind;

  /** The versioned canonical `type` this mapping emits. */
  @pattern("^[a-z][a-z0-9]*([.][a-z0-9]+)+[.]v[0-9]+$")
  canonicalType: string;

  /** Wire JSON Pointer to the stable idempotency key (→ `messageId`). */
  messageIdFrom: string;

  /** Wire JSON Pointer to the correlation id (→ `correlationId`). */
  correlationFrom: string;

  /** Wire JSON Pointer to the Case id (→ `caseId`). */
  caseIdFrom: string;

  /** Ordered payload rules (doc 05 §2). */
  @minItems(1)
  rules: MappingRule[];
}

/**
 * The **reliability** block of a Port (doc 05 §reliability). Retries are bounded then the message is
 * dead-lettered; `dedup` turns on the Idempotent Receiver at the inbound edge.
 */
model Reliability {
  /** Bounded delivery attempts before a message is dead-lettered (exponential backoff is emulated deterministically in the harness). */
  @minValue(0)
  maxAttempts: int32;

  /** When true, an inbound duplicate `messageId` is deduped once (Idempotent Receiver). */
  dedup: boolean;

  /** When true, an attempts-exhausted message lands in the Dead Letter Channel rather than being dropped or retried forever. */
  dlq: boolean;
}

/**
 * A declared **Adapter Port** (doc 05 §1, §3) — a transport binding + the canonical type it bridges +
 * its mapping + reliability block. A binding re-homes by changing `protocol`; the core is unchanged.
 */
model AdapterPort {
  id: string;

  schemaVersion: AdapterSchemaVersion;

  direction: PortDirection;

  protocol: AdapterProtocol;

  /** The canonical type this port bridges (must match its mapping's `canonicalType`). */
  @pattern("^[a-z][a-z0-9]*([.][a-z0-9]+)+[.]v[0-9]+$")
  canonicalType: string;

  /** The `Mapping.id` this port applies. */
  mapping: string;

  reliability: Reliability;
}

/**
 * One **mapping golden vector** (doc 13 §2.d "mapping golden files") — an `input wire message` paired
 * with the `expectedCanonical` envelope the pure mapping must produce. A mapping change that alters an
 * output shows up as a golden diff here.
 */
model MappingGoldenVector {
  /** Human-readable vector name; doubles as intent documentation. */
  name: string;

  /** The `Mapping.id` under test. */
  mappingId: string;

  /** The decoded inbound wire message. */
  wire: Record<unknown>;

  /** The canonical envelope the mapping must deterministically produce. */
  expected: CanonicalEnvelope;
}

/** The reliability scenario a `ReliabilityVector` exercises (doc 13 §2.d "idempotency / DLQ behavior vectors"). */
union ReliabilityScenario {
  /** A duplicate `messageId` arrives; the Idempotent Receiver must apply it once. */
  duplicate: "duplicate",

  /** A poison message repeatedly fails handling; after bounded attempts it must land in the DLQ. */
  poison: "poison",

  /** A crash mid-handle redelivers the message; it must apply exactly once. */
  redelivery: "redelivery",
}

/** One inbound message in a reliability sequence — its `messageId` and whether handling it (deterministically) fails (a poison payload). */
model InboundMessage {
  messageId: string;

  /** Deterministically fails handling (a poison message) — drives the DLQ path. */
  poison?: boolean;
}

/**
 * One **reliability vector** (doc 13 §2.d) — a deterministic inbound sequence + the pinned reliability
 * outcome the runtime must produce: how many messages were `applied` to business state (each once), how
 * many duplicates were `deduped`, and how many exhausted messages landed in the `dlq`.
 */
model ReliabilityVector {
  name: string;

  scenario: ReliabilityScenario;

  /** Bounded attempts before dead-lettering (mirrors the Port's `Reliability.maxAttempts`). */
  @minValue(0)
  maxAttempts: int32;

  /** The inbound message sequence (duplicates share a `messageId`). */
  @minItems(1)
  messages: InboundMessage[];

  expect: ReliabilityExpectation;
}

/** The pinned reliability outcome of driving a `ReliabilityVector`'s sequence through the Idempotent Receiver + DLQ machinery. */
model ReliabilityExpectation {
  /** Distinct messages applied to business state (each exactly once). */
  @minValue(0)
  applied: int32;

  /** Inbound duplicates deduped by the Idempotent Receiver. */
  @minValue(0)
  deduped: int32;

  /** Messages that exhausted their attempts and were dead-lettered. */
  @minValue(0)
  dlq: int32;
}
