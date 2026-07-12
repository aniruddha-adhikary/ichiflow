# 05 — Adapters (Ports In/Out)

> Architecture doc. Consistent with [BRIEF.md](./BRIEF.md) (locked decisions §5, §11, core
> vocabulary "Adapter"). Research input:
> [../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) Part A.

## What this covers

How ichiflow speaks the many protocols enterprises run on (REST, SOAP, IBM MQ / JMS, Kafka,
AMQP/RabbitMQ, files/SFTP, webhooks, DB/CDC) **without letting any of it leak into the core**. It
covers the "declare, don't code" Adapter model (a schema'd, versioned artifact an AI agent can
generate and a validator can check pre-deploy), the runtime bindings that execute those artifacts,
the canonical command/event bus at the core, the reliability stance (at-least-once + idempotent
receiver + transactional outbox + DLQ), content-based routing, observability, DMZ/intranet zone
placement, and contract versioning through the registry. It ends with one worked example — an
inbound IBM MQ XML adapter mapping to a canonical `LoanApplicationReceived` event.

## Position in the system

Adapters are the **ports in/out** of the system ([BRIEF.md](./BRIEF.md) core vocabulary). Inbound
adapters normalize external wire messages into **canonical, schema'd commands/events** that start or
signal **Cases** and **Flows** ([04-flow-and-case-layer.md](./04-flow-and-case-layer.md)); outbound
adapters de-normalize canonical events emitted by the core back onto the wire. The core never
imports a broker client — it knows only the Canonical Data Model. This is the single most important,
technology-independent decision here, and it is what lets a port be re-homed between runtimes without
touching business logic.

```
        EXTERNAL WORLD                 ADAPTER RUNTIME                 ICHIFLOW CORE
   REST / SOAP / IBM MQ / Kafka  ──▶  inbound adapter  ──CDM──▶  canonical command/event bus
   AMQP / SFTP / webhook / CDC   ◀──  outbound adapter ◀─CDM──   (Flows, Cases, Decisions)
```

---

## 1. The "declare, don't code" model

Every port is a **typed, schema'd, versioned artifact** that a runtime interprets. Code is the
exception (a custom transform); config is the rule. This is the meta-principle ichiflow shares
across adapters and identity ([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md),
"How to read this document").

An **Adapter** declaration has three schema'd parts:

1. **Contract** — the machine-readable interface of the external port, in the right standard for the
   protocol:
   - **OpenAPI 3.1** for REST and webhook ports (sync).
   - **AsyncAPI 3.x** for brokers (Kafka, AMQP, JMS/MQ, MQTT) — "the OpenAPI for messages," with
     per-protocol bindings.
   - **WSDL/XSD** for SOAP.
   These align with the schema strategy in [BRIEF.md](./BRIEF.md) §5 (TypeSpec-authored,
   OpenAPI/JSON-Schema/AsyncAPI as the checked-in artifacts).
2. **Mapping** — the **Message Translator** step, as a versioned mapping artifact. Structural field
   mapping (rename, restructure, default, coerce, flatten/nest) is declarative by default:
   - **JSONata** — default for JSON→JSON (portable across JS + JVM, expression-based, AI-friendly).
   - **XSLT** — for XML legacy (IBM MQ / SOAP payloads); the mature, standardized XML choice.
   - **code** — the escape hatch when a transform genuinely exceeds declarative mapping (heavy
     conditional/computed logic that turns JSONata write-only). It is **not** an ad-hoc code drop:
     an `engine: code` transform is a **schema'd** (declared input/output JSON Schema), **versioned**,
     **pure**, **trace-emitting** artifact — validated at the boundary by the same runtime validators
     as every other adapter, emitting a `decisionLog`/trace entry on any branch (§7) exactly like a
     declarative mapping, and carried by a versioned `ref` so a contract bump pairs with a reviewable
     mapping change (§9).
   - **DataWeave** — import-only, to migrate customers arriving from MuleSoft; not an ichiflow runtime.
   - **JOLT** — **not in v1** (redundant with JSONata on the JVM for structural JSON remaps); revisit
     only if a concrete need appears.

   **The purity invariant.** A mapping — declarative *or* `engine: code` — MUST be a **pure function
   of the decoded input.** Anything that needs I/O, state across messages, or enrichment-by-lookup is
   **not a mapping**: it is a Flow step (a `decision-eval`, or an outbound `adapter-call`), not a
   transform. Purity is what keeps mappings testable and replay-safe; enrichment that calls a service
   never belongs inside the transform. The boundary rule: declarative structural field-mapping is the
   default; drop to a schema'd **pure** `engine: code` transform when the logic exceeds roughly a
   screenful of expression or needs real branching/computation; **never** put I/O or state in a
   mapping.
3. **Canonical binding** — the ichiflow Canonical Data Model type this port maps to/from
   (`kind: Command | Event`, `type: loan.application.received.v1`), plus the reliability, routing,
   and observability blocks (§4–§7).

Because the whole declaration is **pure data keyed to a schema**, an AI agent can *synthesize* an
adapter from a spec (an AsyncAPI/OpenAPI/WSDL contract + a target canonical type) and a **validator
checks it before deploy** — the same reason ichiflow exists. See §9 for a worked example.

---

## 2. Runtime bindings (one abstraction, several engines)

The Adapter declaration is runtime-neutral. An **adapter host** interprets it and dispatches to a
binding chosen by `channel.protocol`. All bindings publish/consume the *same* canonical events, so a
port can move between them without the core noticing.

| Class of port | Binding | Why |
|---|---|---|
| **Heavy / legacy / enterprise protocols** — IBM MQ, JMS, SOAP (CXF), SFTP/FTP, AS2, EDI, DB/CDC | **Apache Camel on Quarkus** (YAML DSL; Kotlin DSL where custom logic is unavoidable) | The only realistic option covering 300+ components — IBM MQ, JMS, SOAP, SFTP, mainframe-era transports *and* Kafka/AMQP/REST in one runtime. Fast startup / low memory on Quarkus; YAML DSL + Kaoto + JBang make routes declarative and AI-generatable ([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) §A.2.1). |
| **Lightweight / streaming / language-native** — high-volume Kafka/AMQP glue, simple REST/webhook | **Native paths**: NestJS microservice transports (TS) and Watermill-style Pub/Sub (Go), or a built-in REST/webhook handler | Full Camel context is overkill for low-ceremony, high-volume cases; language-native transports keep these adapters in the same language as the surrounding service ([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) §A.2.4). |

Both classes sit **behind the same Adapter abstraction**. The invariant is the canonical bus + the
declaration; the binding is an implementation detail chosen per port. This deliberately trades some
runtime sprawl for the ability to terminate any protocol an enterprise throws at ichiflow
([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) §A.4 risk:
"polyglot runtime sprawl" — mitigated by making the bus + contract the invariant).

### 2.1 Legacy structured-message profile (segment / positional EDI-family)

The catalogue is not only REST / MQ / Kafka / SOAP / file. Some inbound channels are **fixed-field or
segment-based message formats** — the EDI-family lineage (segment-and-element messages, positional /
fixed-width records) still load-bearing in trade, finance, insurance, and health. ichiflow enumerates a
first-class **legacy structured-message adapter profile**:

- **Contract** — the message grammar (segment/element dictionary or positional field map) declared as a
  schema'd artifact, versioned in the registry like any other contract.
- **Mapping** — inbound segment/positional message → canonical command, and canonical → outbound message,
  as a declared, versioned Message Translator (§4). The heavy/legacy Camel-on-Quarkus binding hosts the
  transport and codec.
- **Boundary validation** — the decoded structure is schema-validated at the boundary exactly like every
  other adapter, so a malformed segment never reaches the core.

**Immutable-submission pattern.** In many regulated domains a submission is a legal artifact that is
**not mutated** on rejection. The profile makes this explicit: a rejected inbound message is **not
edited** — the correction is a **new correlated inbound message assigned a new correlation id**, and the
original Case is closed as **rejected/superseded** (the correction opens a correlated child Case,
[04-flow-and-case-layer.md](./04-flow-and-case-layer.md) §5.6). The adapter therefore treats each inbound
message as immutable and relies on the Correlation Identifier (§4) to link a correction to its
predecessor, rather than attempting an in-place amend at the wire edge.

---

## 3. Ports-and-adapters topology (diagram)

```mermaid
flowchart LR
    subgraph EXT["External systems"]
        MQ["IBM MQ / JMS\n(XML)"]
        SOAP["SOAP\n(WSDL)"]
        SFTP["SFTP / files"]
        KAFKA["Kafka / AMQP"]
        REST["REST / webhook"]
        CDC["DB / CDC"]
    end

    subgraph HOST["Adapter host (interprets declarations)"]
        subgraph CAMEL["Apache Camel on Quarkus\n(heavy / legacy)"]
            IN1["inbound: decode → translate\n→ dedup → outbox-ack"]
        end
        subgraph NATIVE["Native paths\n(NestJS / Watermill / built-in)"]
            IN2["inbound: decode → translate\n→ dedup"]
        end
        OUT["outbound: translate → encode\n→ retry/backoff → DLQ\n(transactional outbox)"]
    end

    subgraph CORE["ichiflow core"]
        BUS["Canonical command/event bus\n(schema-validated CDM)"]
        ROUTE["Content-Based Router"]
        FLOW["Flows / Cases / Decisions"]
    end

    MQ --> IN1
    SOAP --> IN1
    SFTP --> IN1
    CDC --> IN1
    KAFKA --> IN2
    REST --> IN2

    IN1 --> BUS
    IN2 --> BUS
    BUS --> ROUTE --> FLOW
    FLOW -->|canonical event\n(from outbox)| OUT
    OUT --> MQ
    OUT --> KAFKA
    OUT --> REST
    OUT -.DLQ.-> DLQ["Dead Letter Channel\n+ triage/replay tooling"]
```

---

## 4. Canonical command/event bus at the core

Every adapter talks to the core **only** in the Canonical Data Model (CDM) — the Enterprise
Integration Patterns "Canonical Data Model" made concrete as ichiflow's schema'd command/event types
([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) §A.1). ichiflow adopts
the EIP vocabulary verbatim so architects and AI agents share one language:

| EIP pattern | Role in ichiflow |
|---|---|
| **Canonical Data Model** | The schema'd command/event the core speaks; every adapter maps to/from it |
| **Message Translator** | The mapping step (JSONata / XSLT / pure `engine: code`) in each adapter |
| **Message Endpoint** | The adapter boundary itself (inbound/outbound) |
| **Content-Based Router** | Routes canonical events to Flow handlers / outbound adapters by content (§6) |
| **Idempotent Receiver** | Dedup at the inbound edge (idempotency-key store) |
| **Guaranteed Delivery + Dead Letter Channel** | Transactional outbox + retry + DLQ on both edges |
| **Correlation Identifier** | Ties async responses / request-reply and every message to `case_id` |

- **Inbound:** external message → decode → **translate to a canonical command/event** → dedup →
  publish to the bus (ack the source only after the outbox commit). A canonical *command* typically
  starts or signals a Case/Flow; a canonical *event* notifies the core of an external fact.
- **Outbound:** the core emits a canonical event (from its transactional outbox) → **translate from
  canonical** → encode to the wire format → deliver with retry/backoff/DLQ.

Canonical types are **bounded-context-scoped and strictly versioned** to prevent the CDM becoming a
bloated "god schema" ([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) §A.4
risk: "canonical model rot").

### 4.1 Outbound composite-outcome publication

A resolved **`Outcome` / `CompositeOutcome`** (the typed decision result, with all its reason codes and
conditions intact — [02-schema-foundation.md](./02-schema-foundation.md) §9.3,
[03-decision-layer.md](./03-decision-layer.md) §2.3) is published as a **canonical outbound event** and
consumed by **multiple** downstream adapters, partners, and portals — the "one structured outcome,
many consumers" pattern. Two requirements make this safe:

- **The outcome is part of the canonical event schema**, so it fans out through ordinary outbound
  adapters (§4, §3 diagram) with no special path.
- **Codes survive serialization unaltered.** Every code is a `CodeRef` (`code` + `codeSet@version`, doc
  02 §9.3) pinned to its governed CodeSet, so a downstream consumer reads the exact same code, from the
  exact same table version, that the Decision emitted — and per-authority attribution on a
  `CompositeOutcome` is preserved through the wire. A breaking change to the outcome/code shape bumps the
  canonical type version (§9) like any other contract.

### 4.2 Notifications (email / SMS) are outbound Adapter port types

Enterprise workflows are heavy with outbound communication — status notifications,
request-for-information prompts, adverse-action correspondence. ichiflow does **not** invent a
parallel delivery stack for this: **email and SMS are ordinary outbound Adapter port types**,
declared and versioned like any other port (§1), fed a canonical outbound event from the core's
transactional outbox (§4, §5). Message **content is templated and references governed CodeSets** for
its coded content and its per-audience / per-locale text (the `plainLanguage` i18n map, doc 02 §9.2),
so a notification says the same thing, in the same words, as the Portal and the why API. A provider
adapter (SMTP/ESP, SMS gateway) is selected by `channel.protocol` exactly as for any other binding
(§2).

This covers **templated notification delivery over adapters**. Rich document generation (rendered
PDF letters/permits, object-store retention, a full delivery-audit comms module) is a distinct,
larger capability and is **out of scope here** — a proposed module, not part of the adapter layer.

---

## 5. Reliability stance

The realities of heterogeneous enterprise brokers drive a fixed stance
([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) §A.3.2):

- **At-least-once everywhere.** "Exactly-once" is a myth end-to-end across heterogeneous brokers;
  ichiflow *emulates* it with idempotency, never relies on it. The `reliability` block states this
  explicitly so it is a documented contract, not a stakeholder assumption.
- **Idempotent Receiver** on every inbound edge. A stable `messageId`/idempotency key is checked
  against a dedup store inside the same transaction that mutates business state; duplicates are
  discarded safely. This mirrors the idempotent signal/event handling in the Flow layer
  ([04-flow-and-case-layer.md](./04-flow-and-case-layer.md) §10).
- **Transactional Outbox** on every outbound edge. The business change and the outbound message are
  written in one local DB transaction; a relay (or Debezium CDC, [BRIEF.md](./BRIEF.md) §10)
  publishes the outbox row to the broker — no "state changed but event lost," and no reverse.
- **Per-key ordering.** Ordering is per-key at best (Kafka partition, MQ message group). The
  declaration exposes `ordering: perKey | none | strict` and **warns on `strict`**; global strict
  ordering is discouraged as a requirement.
- **Exponential backoff + jitter, capped, then DLQ.** Retries are bounded; exhausted messages land
  in a **Dead Letter Channel** with first-class tooling — triage, depth alerting, safe replay,
  poison-message quarantine. An undrained DLQ is silent data loss, so this is a product feature, not
  an afterthought ([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) §A.4).

The Flow layer hands failed outbound effects to exactly this machinery rather than stalling a
workflow ([04-flow-and-case-layer.md](./04-flow-and-case-layer.md) §10, "DLQ handoff to adapters").

---

## 6. Content-based routing

Inbound canonical events are dispatched to the right consumer — a Flow handler, a specific Case
correlation, or an outbound adapter — by a **Content-Based Router** evaluating a predicate over the
message body (`routing.contentBasedRule`, e.g. `$.region == 'EU'`). Routing predicates use the same
expression sublanguage as Flows/Decisions (FEEL / JSONata) so business logic reads consistently
across the platform. Routing rules that are genuinely business decisions (not plumbing) can be
promoted to governed DMN Decisions.

---

## 7. Adapter observability

Every message crossing an adapter is **correlated to `case_id`** (the global correlation identifier,
[BRIEF.md](./BRIEF.md) §10) and traced with **OpenTelemetry** (W3C trace context propagated from the
wire where present, generated at the edge where not). Each adapter emits:

- an OTel span per message (decode → translate → publish/deliver), tagged with `case_id`,
  `adapter_id`, canonical `type`, and delivery outcome;
- a **decision log** entry when content-based routing or a mapping branch chooses a path
  (`decisionLog: true`) — including any branch inside a schema'd `engine: code` transform (§1), so a
  code transform lands on the same audit spine as a declarative mapping — feeding the DecisionRecord's
  causal chain ([04-flow-and-case-layer.md](./04-flow-and-case-layer.md) §7);
- DLQ depth / redelivery metrics for alerting.

This makes "which external message, transformed how, started which Case" answerable end-to-end and
lands adapter behavior in the *why* API alongside Flow and Decision events.

---

## 8. Zone placement (DMZ vs intranet)

ichiflow supports explicit **DMZ/intranet zones** with a one-way async relay between them
([BRIEF.md](./BRIEF.md) §11). Adapters are placed by trust exposure:

- **DMZ zone.** Internet-facing inbound ports — public **webhooks**, partner **REST**, inbound
  **AS2/SFTP** from external parties. These terminate the external protocol, authenticate, validate
  against the contract, translate to canonical, and **relay one-way** into the intranet. They hold no
  business state.
- **Intranet zone.** Ports to internal systems of record — **IBM MQ / JMS**, internal **SOAP**,
  **DB/CDC**, internal Kafka — plus the core (Flows/Cases/Decisions) and the DecisionRecord.
- **One-way relays.** The DMZ→intranet path is an async, single-direction canonical-event relay
  (no synchronous callback from intranet into DMZ), so a compromised DMZ node cannot pull from the
  core. Outbound intranet→external traffic egresses through controlled outbound adapters, not by
  opening inbound holes.

The Adapter abstraction is identical in both zones — only placement and the relay boundary differ —
so a declaration is portable across zones by configuration.

---

## 9. Versioning & evolution via the registry

Adapter contracts and canonical types are versioned artifacts in the schema **registry**
(Apicurio, FULL_TRANSITIVE for events; oasdiff breaking-change CI gates — [BRIEF.md](./BRIEF.md) §5):

- The `contract` field points at a **versioned** AsyncAPI/OpenAPI/WSDL artifact in the registry.
- A breaking change to a canonical type **bumps the type version** (`loan.application.received.v1`
  → `v2`); old and new run side by side while producers/consumers migrate. FULL_TRANSITIVE
  compatibility on event schemas is enforced by the registry; `oasdiff` gates breaking REST changes
  in CI.
- Mapping artifacts (JSONata / XSLT / pure `engine: code`) are versioned and referenced by the
  adapter, so a contract bump pairs with an explicit, reviewable mapping change — and an AI agent
  regenerates the mapping from the new contract for a validator to check pre-deploy.

---

## 10. Worked example — inbound IBM MQ XML → `LoanApplicationReceived`

An inbound adapter listens on an IBM MQ queue for a legacy XML loan submission and maps it to the
canonical `loan.application.received.v1` **command** that starts a loan Case
([04-flow-and-case-layer.md](./04-flow-and-case-layer.md) §6 example). Heavy legacy protocol →
**Camel-on-Quarkus** binding; XML payload → **XSLT** mapping.

```yaml
# Adapter declaration (declared, not coded) — checked into the Workspace, validated pre-deploy
Adapter:
  id: mq-inbound-loan-applications
  direction: inbound
  binding: camel-quarkus            # heavy/legacy protocol → Camel
  channel:
    protocol: ibmmq
    endpoint: secret://mq/loan-intake        # connection + credentials by reference
    options: { queue: LOAN.APPLICATIONS.IN, concurrency: 8, ordering: perKey }
  codec: xml
  contract: wsdl://loan-intake/LoanApplication/2.3     # external XSD/WSDL in the registry
  transform:
    engine: xslt
    spec: mapping://loan/mq-xml-to-canonical/3         # versioned mapping artifact
  canonical:
    kind: Command
    type: loan.application.received.v1                 # ichiflow CDM type (registry-versioned)
    schema: schema://loan/LoanApplicationReceived/1
  routing:
    contentBasedRule: "$.application.region"           # Content-Based Router (e.g. EU vs US)
  reliability:
    delivery: at-least-once
    idempotency: { key: "$.application.submissionId", store: dedup-loan, ttl: 7d }
    ordering: perKey
    retry: { max: 6, backoff: exponential, initial: 1s, max: 5m }
    dlq: { channel: LOAN.APPLICATIONS.DLQ, includeStacktrace: true }
  observability: { traceContext: w3c, correlateTo: case_id, decisionLog: true }
  zone: intranet                    # internal system-of-record MQ lives in the intranet
```

```json
// Canonical command produced on the bus (schema-validated against LoanApplicationReceived/1)
{
  "kind": "Command",
  "type": "loan.application.received.v1",
  "case_id": "c-2026-000431",
  "correlation": { "idempotency_key": "SUB-88213-2026" },
  "occurred_at": "2026-07-12T08:41:12Z",
  "source": { "adapter": "mq-inbound-loan-applications", "queue": "LOAN.APPLICATIONS.IN" },
  "payload": {
    "applicant": { "id": "APP-55021", "name": "…", "region": "EU" },
    "amount": { "currency": "EUR", "value": 250000 },
    "term_months": 240,
    "product": "mortgage.fixed"
  }
}
```

Flow of control: MQ message arrives → Camel consumes from `LOAN.APPLICATIONS.IN` → decode XML →
**XSLT** translate to `LoanApplicationReceived/1` → dedup on `submissionId` → publish canonical
command to the bus (ack MQ only after outbox commit) → the content-based router / Flow layer starts
the loan Case ([04-flow-and-case-layer.md](./04-flow-and-case-layer.md) §6). Every hop carries
`case_id` and an OTel trace; a malformed or repeatedly-failing message lands in
`LOAN.APPLICATIONS.DLQ` for triage and replay.

---

## Open questions

- **Adapter host packaging.** Is the adapter host one process embedding both Camel-Quarkus and the
  native paths, or separate deployables per binding class? Affects the modular-monolith→split-later
  story ([BRIEF.md](./BRIEF.md) §11) and DMZ footprint.
- **Redpanda Connect / Benthos inclusion.** The research flags premium connectors gated behind a
  Redpanda BSL/Enterprise license ([../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md)
  §A.4). If adopted as a third binding for declarative streaming glue, a CI license-allowlist gate
  and MIT/Apache connector pinning are prerequisites — decision deferred.
- **Mapping generation trust boundary.** How much AI-generated mapping (JSONata/XSLT) ships without
  human review vs. requiring sign-off, and what property/parity tests gate it, given mappings can
  silently corrupt data.
- **Request-reply over MQ.** Synchronous SOAP-over-MQ / request-reply correlation (Correlation
  Identifier + reply-queue lifecycle) needs a concrete pattern beyond the fire-and-forward inbound
  case shown here.
- **CDC as an adapter vs. a migration mechanism.** Debezium CDC appears both as an inbound adapter
  protocol here and as a coexistence mechanism in migration ([BRIEF.md](./BRIEF.md) §13); the
  boundary between "CDC adapter" and "migration Ring 1" needs to be drawn explicitly.
