# 04 — Integration Adapters & Pluggable Auth/AccessControl

> Research note for **ichiflow** — AI-native enterprise workflow development framework.
> Date: 2026-07-12. Scope: two pluggability pillars — (A) integration adapters (ports in/out) and (B) pluggable authentication & authorization.
> Status of external projects verified against mid-2026 sources (see Sources at the end of each part).

---

## How to read this document

ichiflow is polyglot at the edges (a TS control-plane / UI layer and a JVM-heavy integration layer are both plausible) but wants a **single declarative contract** so that AI agents can *generate* adapters and auth configs from a spec rather than hand-code them. Both pillars therefore share one meta-principle:

> **Declare, don't code.** Every port (integration or identity) is a *typed, schema'd, versioned artifact* (AsyncAPI / OpenAPI / policy-as-code) that a runtime interprets. Code is the exception (custom transforms, custom credential flows), config is the rule.

---
---

# PART A — INTEGRATION ADAPTERS

## A.0 Executive summary & recommendation

Enterprise workflows must speak many protocols (REST, SOAP, IBM MQ / JMS XML, Kafka, AMQP/RabbitMQ, files/SFTP, webhooks, DB/CDC) without letting any of that leak into the workflow core. The 20-year-old **Enterprise Integration Patterns (EIP)** vocabulary (Hohpe & Woolf) is still the correct conceptual model, and it maps cleanly onto a modern *hexagonal / ports-and-adapters* architecture: an **inbound adapter** normalizes an external event into a **canonical, schema'd command/event** delivered to the core; the core emits canonical events consumed by **outbound adapters** that de-normalize back to a wire format.

**Recommendation (three-tier adapter strategy):**

1. **Canonical event/command bus at the core** — every adapter talks to the core only in the Canonical Data Model. The core never imports a broker client. This is the single most important decision and is technology-independent.
2. **Heavy/enterprise protocols → Apache Camel (on Quarkus, Kotlin or Java DSL).** Camel is the mature, actively-developed (25+ core releases in 2025, 300+ components) EIP implementation and is the only realistic option that covers IBM MQ, JMS, SOAP, SFTP, AS2, mainframe-era transports *and* Kafka/AMQP/REST in one runtime. Use it as the "integration sidecar/gateway" that terminates legacy protocols and republishes canonical events.
3. **Lightweight/streaming protocols and TS-native paths → a declarative stream processor (Redpanda Connect / Benthos) and/or Watermill (Go) / NestJS transports (TS)** for the high-volume, low-ceremony cases where a full Camel context is overkill.

**Declarability:** describe every message port with **AsyncAPI 3.x** (async/broker) and **OpenAPI 3.1** (sync/REST), describe transformations with a **portable mapping DSL** (JSONata for JSON, XSLT/JOLT for XML legacy), and treat the adapter definition as data an AI agent can synthesize and validate against the schema. Camel routes, Benthos pipelines, and NestJS handlers can all be generated from these contracts.

**Delivery-semantics stance:** design for **at-least-once + idempotent consumers + transactional outbox**. Treat "exactly-once" as a property you *emulate* (idempotency keys + dedup store), never one you rely on end-to-end across heterogeneous brokers.

---

## A.1 The canonical vocabulary — Enterprise Integration Patterns

EIP (Hohpe & Woolf, 2003) remains the shared language for this problem and is explicitly still current: the same patterns — **Canonical Data Model, Message Channel, Message Translator, Content-Based Router, Message Endpoint, Pipes-and-Filters, Aggregator, Scatter-Gather, Dead Letter Channel, Idempotent Receiver, Guaranteed Delivery** — now underpin Kafka-era streaming and even AI-agent coordination, not just old ESBs. ichiflow should adopt the EIP names verbatim in its adapter model so architects and AI agents share one vocabulary.

The patterns ichiflow leans on hardest:

| EIP pattern | Role in ichiflow |
|---|---|
| Canonical Data Model | The schema'd event/command the core speaks; every adapter maps to/from it |
| Message Translator | The transformation step (mapping DSL) in each adapter |
| Content-Based Router | Routes canonical events to workflow handlers / outbound adapters by content |
| Message Endpoint | The adapter boundary itself (inbound/outbound) |
| Idempotent Receiver | Dedup at the inbound edge (idempotency key store) |
| Guaranteed Delivery + Dead Letter Channel | Outbox + retry + DLQ on both edges |
| Correlation Identifier | Ties async responses / SOAP-over-MQ request-reply back together |

## A.2 Implementation landscape

### A.2.1 Apache Camel family (recommended backbone for enterprise protocols)

- **Health:** Very healthy in 2026. Camel 4.20 / Camel Quarkus 3.36 released May 2026; ~25 Camel Core+Spring Boot releases and ~18 Camel Quarkus releases across 2025, 4,400+ commits / 144 committers. This is one of the most active integration projects in existence.
- **Coverage:** 300+ components — the decisive advantage. Native IBM MQ / JMS, SOAP (CXF), SFTP/FTP, AS2, file, Kafka, AMQP/RabbitMQ, REST, plus mainframe/EDI oddities. Nothing else in open source matches this breadth.
- **DSLs:** Java DSL, XML, YAML, and a **Kotlin DSL** (`camel-quarkus-kotlin-dsl`) — good fit if ichiflow's JVM side is Kotlin. YAML DSL is the key enabler for *declarative, AI-generatable* routes.
- **Runtimes:** Camel on **Quarkus** (fast startup, low memory, native image) is the recommended target. **Camel K** is being repositioned as a *Kubernetes manager for plain Camel Quarkus apps* (Camel K Runtime being deprecated from 2.6.0) — so prefer "Camel Quarkus app + optional Camel K operator" over betting on Camel K Runtime. **Camel JBang** is excellent for prototyping/local dev; **Kaoto** (2.9, 2025) gives a visual route + DataMapper editor that pairs well with AI-assisted authoring.
- **Verdict:** Backbone for anything legacy/enterprise. The YAML DSL + Kaoto + JBang combination is exactly the "declared not coded" story for the heavy protocols.

### A.2.2 Spring Integration

- EIP implementation native to Spring Boot; channel-abstraction first. Best when integration is a *small part* of a Spring app and traffic is mostly internal JMS/AMQP. Narrower connector catalog than Camel; Camel even ships a Spring Integration bridge component. **Use only if ichiflow's JVM services are already all-in on Spring and need light in-process wiring** — otherwise Camel wins on breadth.

### A.2.3 Commercial iPaaS — MuleSoft / Boomi (comparison baseline, not a dependency)

- MuleSoft (Anypoint + **DataWeave** transformation language) and Boomi are the enterprise iPaaS incumbents: strong tooling, connector marketplaces, governance, support contracts. They are the "buy" alternative to ichiflow's "build." Relevant as a **feature-parity yardstick** (self-service admin, connector catalog, mapping GUI, monitoring) and as a **migration source** (customers may arrive with DataWeave transforms). ichiflow should not depend on them but should be able to *import* their artifacts where feasible.

### A.2.4 Lightweight / streaming processors

| Tool | Lang | Model | License (2026) | Notes |
|---|---|---|---|---|
| **Redpanda Connect (ex-Benthos)** | Go | Declarative YAML stream pipelines, 200+ connectors, Bloblang mapping | Core engine **MIT** (`redpanda-data/benthos`); many connectors Apache-2.0; **some enterprise connectors gated behind Redpanda BSL/Enterprise license** | Best "declarative adapter as YAML" fit. **Licensing caveat: audit each connector** — post-acquisition, premium connectors require a Redpanda license. Pin to MIT/Apache connectors for the OSS core. |
| **Apache NiFi** | JVM | Visual flow-based, provenance/lineage built-in | Apache-2.0 | Strong for file/batch, data lineage, drag-drop. Heavier ops footprint; good for data-movement, less for request-reply app integration. |
| **Watermill** | Go | Pub/Sub abstraction over 12 backends (Kafka, RabbitMQ, NATS, SQL, Redis Streams, GCP, SQS/SNS) | MIT | Clean unified Publisher/Subscriber interface; great if ichiflow has Go services. v1.4 current, actively maintained. |
| **Conduit** | Go | Kafka-Connect-style CDC/stream connectors | Apache-2.0 | Focused on connector-based data sync/CDC; simpler than NiFi. |
| **NestJS microservice transports** | TS | Built-in transport strategies (Kafka, RabbitMQ, MQTT, NATS, Redis, gRPC) + custom `CustomTransportStrategy` | MIT | The natural TS-side abstraction; a custom strategy can bridge ichiflow's canonical bus into Nest handlers. |

**Guidance:** Camel for *breadth and legacy*; Redpanda Connect for *declarative high-volume streaming glue*; Watermill/NestJS transports for *language-native* adapters in Go/TS services. All three publish/consume the same canonical events, so they are interchangeable per-port.

## A.3 Proposed generalizable adapter interface (conceptual)

Ports-and-adapters, with the Canonical Data Model as the only thing the core knows about.

```
        EXTERNAL WORLD                 ADAPTER RUNTIME                 ICHIFLOW CORE
  ┌─────────────────────┐      ┌──────────────────────────┐     ┌────────────────────┐
  │ REST / SOAP / MQ /  │      │  INBOUND ADAPTER          │     │                    │
  │ Kafka / AMQP / SFTP │─────▶│  1. Listen/poll (channel) │     │  Canonical Command │
  │ / webhook / CDC     │ wire │  2. Decode (proto codec)  │────▶│  or Event bus      │
  └─────────────────────┘      │  3. Translate → canonical │ CDM │  (schema-validated)│
                               │  4. Dedup (idempotency)   │     │                    │
                               │  5. Ack after outbox commit│    │  Workflow engine / │
                               └──────────────────────────┘     │  content-based     │
                               ┌──────────────────────────┐     │  router            │
  ┌─────────────────────┐      │  OUTBOUND ADAPTER         │     │                    │
  │ downstream systems  │◀─────│  4. Encode → wire         │◀────│  Canonical Event   │
  │                     │ wire │  3. Translate ← canonical │ CDM │  (from outbox)     │
  └─────────────────────┘      │  2. Retry/backoff + DLQ   │     │                    │
                               │  1. Transactional publish │     └────────────────────┘
                               └──────────────────────────┘
```

**The adapter contract (declared, not coded).** Every adapter is one document:

```
Adapter:
  id: mq-inbound-claims
  direction: inbound | outbound
  channel:                       # transport binding (AsyncAPI/OpenAPI binding)
    protocol: ibmmq | kafka | amqp | rest | soap | sftp | webhook | jdbc-cdc
    endpoint: <connection ref / secret ref>
    options: { queue: CLAIMS.IN, concurrency: 8, ordering: partitionKey }
  codec: xml | json | avro | fixed-width | edifact | soap-envelope
  contract: asyncapi://claims/1.2#/channels/claimSubmitted   # the message schema
  canonical:
    kind: Command
    type: claim.submit.v1                # ichiflow Canonical Data Model type
  transform:                             # Message Translator
    engine: jsonata | jolt | xslt | dataweave
    spec: <ref to mapping artifact>
  routing: { contentBasedRule: "$.region" }        # Content-Based Router
  reliability:
    delivery: at-least-once
    idempotency: { key: "$.messageId", store: dedup-claims, ttl: 7d }
    ordering: perKey | none | strict
    retry: { max: 6, backoff: exponential, initial: 1s, max: 5m }
    dlq: { channel: CLAIMS.DLQ, includeStacktrace: true }
    outbox: { enabled: true }            # outbound only, transactional publish
  observability: { traceContext: w3c, decisionLog: true }
```

Because this is pure data keyed to a schema, an **AI agent can synthesize an adapter** from an AsyncAPI/OpenAPI/WSDL spec + a target canonical type, then a validator checks it before deploy. A runtime "adapter host" interprets it — dispatching to Camel (heavy protocols), Redpanda Connect (streaming), Watermill/NestJS (language-native), or a built-in REST/webhook handler — based on `channel.protocol`.

### A.3.1 Transformation / mapping DSLs

| DSL | Domain | When to use in ichiflow |
|---|---|---|
| **JSONata** | JSON→JSON query+transform | Default for JSON. ~690k weekly npm downloads, portable (JS + JVM ports), expression-based, AI-friendly. |
| **JOLT** | JSON→JSON structural (Java) | JVM structural remaps where declarative "shift/default/remove" specs are enough; no value logic. |
| **XSLT** | XML→XML/anything | Legacy XML / IBM MQ / SOAP payloads — the mature, standardized choice for classic enterprise XML. |
| **DataWeave** | Any→any (MuleSoft) | Not adopt; support as an **import/migration** source for customers arriving from MuleSoft. |

Recommendation: **JSONata** as the canonical default, **XSLT** for XML-legacy, **JOLT** optional on JVM, **DataWeave** import-only. All mapping specs are versioned artifacts referenced by the adapter contract.

### A.3.2 Reliability semantics (the realities)

- **Exactly-once is a myth end-to-end** across heterogeneous brokers. The transactional outbox guarantees *at-least-once to the broker*, not exactly-once to the consumer. Design for at-least-once everywhere.
- **Idempotent Receiver** on every inbound edge: carry a stable `messageId`, check a dedup/control table inside the same transaction that mutates business state; duplicates are discarded safely.
- **Transactional Outbox** on every outbound edge: write the business change and the outbound message in one local DB transaction; a relay/CDC publishes the outbox row to the broker. Prevents "state changed but event lost" and the reverse.
- **Ordering** is per-key at best (Kafka partition, MQ message group); "strict global order" should be avoided as a requirement. Expose `ordering: perKey | none | strict` and warn on `strict`.
- **Retries with exponential backoff + jitter**, capped, then **Dead Letter Channel**. DLQ needs first-class tooling: triage, depth alerting, safe replay, poison-message quarantine — not a black hole.
- **Inbox pattern** (dedup store) is the consumer-side complement to the outbox.

### A.3.3 Declaring message contracts — AsyncAPI / OpenAPI

- **AsyncAPI 3.x** (3.0 released 2024; 3.1 current) is the "OpenAPI for messages": protocol-agnostic, with bindings for Kafka, AMQP, MQTT, JMS/MQ, WebSocket. It describes channels, operations, messages, and payload schemas — i.e. exactly ichiflow's async ports. Mature code-generators exist (Modelina, AsyncAPI Generator, third-party codegen for Go/TS/Java) so adapter scaffolding and payload types can be generated.
- **OpenAPI 3.1** covers the synchronous REST/webhook ports; **WSDL/XSD** covers SOAP.
- **Strategy:** the `contract` field of every adapter points at an AsyncAPI/OpenAPI/WSDL artifact. This is the machine-readable interface an AI agent reads to (a) generate the adapter config and (b) generate/validate the canonical mapping. Contracts are versioned; breaking changes bump the canonical type (`claim.submit.v1` → `v2`).

## A.4 Risks (Part A)

- **Camel operational weight & learning curve.** 300+ components and a rich DSL are powerful but non-trivial; mitigate by constraining teams to the YAML DSL + a curated component allowlist, and by generating routes from contracts rather than hand-authoring.
- **Redpanda Connect licensing drift.** Core is MIT but premium connectors are gated behind Redpanda's BSL/Enterprise license post-acquisition — an OSS build could silently pull a licensed connector. Mitigate with a license-allowlist gate in CI and pinning to MIT/Apache connectors.
- **Canonical model rot.** A Canonical Data Model can become a bloated "god schema." Mitigate with bounded-context-scoped canonical types, strict versioning, and schema governance.
- **"Exactly-once" expectation from stakeholders.** Set expectations early: at-least-once + idempotency. Document it in the adapter contract's `reliability` block so it is explicit, not assumed.
- **Polyglot runtime sprawl.** Three adapter runtimes (Camel/JVM, Redpanda Connect/Go, NestJS/TS) is flexibility but also ops surface. Mitigate by making the canonical bus + contract the invariant, so a port can be re-homed between runtimes without touching the core.
- **DLQ neglect.** Undrained DLQs are silent data loss. Requires monitoring/replay tooling as a first-class product feature, not an afterthought.

## A.5 Sources (Part A)

- Enterprise Integration Patterns (catalog): https://www.enterpriseintegrationpatterns.com/patterns/messaging/Chapter1.html
- EIP still relevant / streaming & AI (Tacnode, 2026): https://tacnode.io/post/enterprise-integration-patterns
- Canonical Data Model (Advent of EIP, 2025): https://james-carr.org/posts/2025-12-23-advent-of-eip-day-6-canonical-data-model/
- Camel Quarkus 3.36 release (May 2026): https://camel.apache.org/blog/2026/05/camel-quarkus-release-3.36.0/
- Camel Kotlin DSL extension: https://quarkus.io/extensions/org.apache.camel.quarkus/camel-quarkus-kotlin-dsl/
- Camel integration quarterly digest Q4 2025 (Red Hat): https://developers.redhat.com/blog/2026/01/22/camel-integration-quarterly-digest-q4-2025
- Camel K roadmap 2025: https://github.com/apache/camel-k/issues/6042
- Camel vs Spring Integration (2025): https://www.javacodegeeks.com/2025/07/apache-camel-vs-spring-integration-which-to-choose-for-enterprise-integration.html
- Redpanda acquires Benthos: https://www.redpanda.com/press/redpanda-acquires-benthos
- Redpanda Connect enterprise licensing: https://docs.redpanda.com/connect/get-started/licensing/
- Benthos core MIT license: https://github.com/redpanda-data/benthos/blob/main/LICENSE
- Watermill (Three Dots Labs): https://github.com/ThreeDotsLabs/watermill and https://watermill.io/learn/getting-started/
- AsyncAPI 3.0.0 spec: https://www.asyncapi.com/docs/reference/specification/v3.0.0 ; tools: https://www.asyncapi.com/tools
- JOLT: https://github.com/bazaarvoice/jolt
- Transactional outbox / at-least-once (AWS Prescriptive Guidance): https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- Outbox trade-offs (2025): https://www.softwarecraftsperson.com/posts/2025-10-08-transactional-outbox-pattern/
- DLQ patterns (2026): https://oneuptime.com/blog/post/2026-02-09-dead-letter-queue-patterns/view

---
---

# PART B — PLUGGABLE AUTHENTICATION & ACCESS CONTROL

## B.0 Executive summary & recommendation

ichiflow serves **multiple portals for distinct populations** (back-office staff, customers, partners), each potentially with its **own SSO** (OIDC/SAML) *plus* legacy username/password, and needs **fine-grained, feature/attribute-based entitlements** on top of auto-generated UIs and APIs. This is two separable problems that must not be conflated:

1. **AuthN / identity brokering** — "who is this, via which portal, through which IdP?"
2. **AuthZ / access control** — "what may they do, on which resource, given these features/attributes/tenants?"

**Recommendation:**

- **AuthN — broker per audience, don't build a custom IdP.** Front each portal with an **identity broker that supports realms/organizations and per-connection IdP config**. **Keycloak** (CNCF incubating, Quarkus-based, SAML *and* OIDC, realms = portal isolation, brokering to upstream IdPs) is the strongest open-source default for an enterprise, legacy-inclusive footprint. **Zitadel** is the better pick if multi-tenant B2B2C isolation and event-sourced audit are the top priorities. Reserve **WorkOS/Stytch/Auth0** as the "buy" option when enterprise SSO onboarding speed and embedded admin portals matter more than self-hosting.
- **Pluggable strategy layer at the app edge.** Keep a **Passport.js-style strategy abstraction** in the TS layer so new login methods (an extra OIDC provider, SAML, legacy password, API keys, mTLS) are *plugins*, not core changes. Use **Better Auth** as the modern TS foundation (Passport is legacy/maintenance; Lucia is deprecated; Auth.js is now under the Better Auth umbrella). On the JVM, **Spring Security** + **pac4j** play the same role.
- **AuthZ — externalize the decision into a policy engine, model as "features + attributes + relationships."** No single model wins; ichiflow needs a **hybrid**: **RBAC** for coarse portal/role gating, **ABAC** for feature-flag/attribute entitlements and row/field-level rules, **ReBAC** for "who is related to this record/tenant." Recommended engine: **OpenFGA** (Zanzibar-style ReBAC, great for "list what this user can see" on auto-generated UIs/APIs and multi-tenant relationships) as the relationship backbone, optionally paired with **Cedar** (safe, deterministic, formally-analyzable, auditable ABAC/RBAC) for attribute/context rules. **OPA/Rego** is the general-purpose alternative with the richest decision-log/audit story; **Casbin** for embedded/in-process; **Permit.io / Oso** as managed/hybrid convenience layers over these engines.
- **Auditable/explainable decisions are non-negotiable.** Whatever engine, require **decision logs** (`decision_id`, principal, action, resource, context, allow/deny, *reason/rule*) — OPA and Cedar both provide this natively; it is the substrate for compliance and for AI-generated UI that must explain *why* a field is hidden.
- **Identity propagation across services via OAuth2 Token Exchange (RFC 8693).** One user login at the portal edge; downstream services receive audience-scoped, identity-preserving tokens through a Security Token Service (Keycloak/Zitadel both support the grant), enabling least-privilege and clean B2B2C / cross-trust-domain chaining.

## B.1 Identity brokers & auth libraries

### B.1.1 Self-hosted identity brokers / IdPs

| Product | Lang | Protocols | Multi-tenant model | Health (2026) | Fit for ichiflow |
|---|---|---|---|---|---|
| **Keycloak** | Java/Quarkus | OIDC, OAuth2, SAML 2.0, token exchange, LDAP/Kerberos federation | **Realms** (isolation per portal) + IdP brokering; **Organizations** for B2B | CNCF **incubating** (joined 2023; not yet graduated as of mid-2026), very active, Quarkus distro (~50% faster boot) | **Primary recommendation.** SAML *and* OIDC, upstream IdP brokering, legacy password + LDAP, realm-per-portal, token exchange. Best coverage of the "legacy + modern + multi-portal" requirement. |
| **Zitadel** | Go | OIDC, OAuth2, SAML, token exchange | **Built ground-up for multi-tenancy**; event-sourced (every change is an event → audit) | Active, cloud-native, API-first | **Strong #2 / co-primary.** Choose when B2B2C tenant isolation + immutable audit trail are the top priorities. |
| **Ory** (Kratos/Hydra/Keto/Oathkeeper) | Go | OIDC/OAuth2 (Hydra), identity (Kratos), ReBAC (Keto), proxy (Oathkeeper) | Composable; API-first | Active; "opt into complexity" — powerful but you assemble the pieces | Good if ichiflow wants headless, fully API-driven auth and is comfortable integrating 3–4 services. Keto doubles as a Zanzibar authz engine. |
| **Authentik** | Python | OIDC, SAML, LDAP, proxy/forward-auth | Multi-tenant possible but *not* a core strength | Active; praised for clean UI, "simpler Keycloak" | Good for SMB-scale or when UX/admin simplicity beats strict tenant isolation. |
| **Authelia** | Go | Forward-auth companion (not a full IdP) | n/a | Active | Reverse-proxy gatekeeper for internal apps; not a portal-IdP solution on its own. |
| **Dex** | Go | OIDC front-end brokering to upstream connectors | Lightweight | Active | Thin OIDC broker in front of other IdPs; useful as a federation shim, not a full IAM. |

**Commercial (buy) options:** **Auth0/Okta** (mature, broad, pricier), **WorkOS** (productized enterprise SSO/SCIM/audit — turns 4-week integrations into 4-day; AuthKit free tier to 1M MAU; but **one IdP per organization**), **Stytch** (allows **multiple IdPs per organization** + embeddable self-service admin portal — better when a customer org has many upstream IdPs). These matter for ichiflow as (a) parity yardstick for "self-service SSO onboarding" and (b) drop-in if a deployment can't self-host.

### B.1.2 Pluggable strategy layer (application edge)

| Library | Ecosystem | Status (2026) | Recommendation |
|---|---|---|---|
| **Better Auth** | TS | Ascendant; **Auth.js/NextAuth joined the Better Auth umbrella (Sep 2025)**; growing plugin ecosystem; adding RFC 8693 token exchange | **Recommended TS foundation.** Plugin model = the Passport-style pluggability requirement, modernized. |
| **Passport.js** | Node/TS | Legacy, 500+ strategies, maintenance-mode; still works | Conceptual model to emulate (strategy = plugin); avoid as the new foundation. |
| **Lucia** | TS | **Deprecated (Mar 2025)** — reframed as a learn-to-build-sessions resource | Do not adopt as a library; use as reference. |
| **Auth.js / NextAuth** | TS | Security-patch-only under Better Auth | Migrate toward Better Auth. |
| **Spring Security** | JVM | Mature, active | JVM-side strategy/filter chain + resource-server. |
| **pac4j** | JVM | Mature, active | Multi-protocol (OIDC/SAML/CAS/OAuth) security engine for JVM apps/gateways; pairs with Spring Security. |

**Design implication:** ichiflow's own **portal/auth layer wraps a strategy registry** — each portal declares which strategies (OIDC-A, OIDC-B, SAML-C, legacy-password, api-key, mTLS) it enables; the identity broker (Keycloak/Zitadel realm) does the heavy protocol lifting; Better Auth / Spring Security is the in-app plug point for anything not delegated to the broker.

## B.2 Authorization models & policy engines

### B.2.1 Model choice: RBAC vs ABAC vs ReBAC

- **RBAC** — roles→permissions. Simple, familiar, coarse. Good for portal-level and job-function gating; explodes ("role explosion") when entitlements get fine-grained.
- **ABAC** — decisions from attributes of subject/resource/action/context (e.g. `user.department == resource.owningDept AND feature.claimsEdit == true`). Natural fit for the **"features and attributes"** entitlement style and for **row/field-level** rules on auto-generated UIs/APIs.
- **ReBAC** — decisions from a graph of relationships (Zanzibar). Excels at **"list every resource this user can access"** (reverse-index queries) — exactly what an auto-generated list view/API needs — and at multi-tenant "member-of-org/team" hierarchies.

**ichiflow needs all three.** Use RBAC for coarse gating, ABAC for feature/attribute entitlements and field-level masking, ReBAC for tenant/record relationships and efficient "what can I see" queries.

### B.2.2 Policy engines

| Engine | Model strength | Deployment | Decision logs / audit | License | Fit |
|---|---|---|---|---|---|
| **OpenFGA** | **ReBAC** (Zanzibar), high-scale, reverse-index "list objects" | Service (stateful graph store) | Yes (assertions, query logging) | Apache-2.0 (CNCF) | **Recommended relationship backbone** — multi-tenancy, row-level "who can see this record", list-filtering for generated UIs/APIs. |
| **Cedar** | **ABAC + RBAC**, safe, deterministic, **formally analyzable/verifiable** | Embedded lib or service | Yes — returns decision + diagnostics/reasons | Apache-2.0 (AWS) | **Recommended attribute/policy layer** — feature/attribute entitlements, field-level rules; explainable by design. |
| **OPA / Rego** | General-purpose policy (ABAC+); very flexible | Sidecar/service | **Best-in-class decision logs** (`decision_id`, input, result, bundle metadata) | Apache-2.0 (CNCF graduated) | Strong alternative/complement, esp. where you want one engine for infra + app policy and the richest audit trail. Rego is powerful but error-prone. |
| **Casbin** | ACL/RBAC/ABAC/ReBAC via model files; **embedded, many languages** | In-process library | Not built-in (must add middleware; DB-adapter writes are interceptable) | Apache-2.0 | Good for **in-process** enforcement in a single service; weaker for centralized audit/multi-service governance. |
| **Permit.io** | Full-stack over OPA/OPAL/Cedar; RBAC/ABAC/ReBAC + UI | SaaS control plane + local PDP | Yes (managed) | Commercial (OSS components) | Managed convenience layer + policy authoring UI; useful to accelerate, wraps the OSS engines. |
| **Oso** | Developer-first authorization (Polar / cloud) | Lib + cloud | Yes (cloud) | Commercial + OSS | Clean DX for embedding authz; evaluate as an alternative to hand-rolling. |

**Recommendation:** **OpenFGA (relationships) + Cedar (attributes/features), fronted by a thin ichiflow "authz gateway" (PDP) that both the API layer and the UI layer call.** OPA/Rego is an acceptable single-engine substitute where teams prefer one policy language and value its decision-log maturity. Casbin only for isolated in-process needs.

### B.2.3 Row/field-level security on auto-generated UIs & APIs

Because ichiflow auto-generates UIs and APIs, authorization must be **enforced centrally and reflected in generation**:

- **API layer:** every generated endpoint calls the PDP with `(principal, action, resource, context)`; ReBAC supplies the *filter set* ("which rows"), ABAC supplies *field masks* ("which columns/features").
- **UI layer:** the same PDP answers "may this user see/edit field X / feature Y" so generated screens render conditionally and consistently with the API — one decision source, no drift.
- **Decision logs** feed both compliance audit and the *explanation* surface ("this field is hidden because policy P denied on attribute A").

## B.3 Proposed generalizable interface (conceptual)

Separate **identity** (portal + strategies + broker) from **entitlement** (PDP), joined by a **security context** propagated via token exchange.

```
   PORTAL EDGE (per audience)            IDENTITY BROKER              SECURITY CONTEXT           POLICY DECISION POINT
 ┌───────────────────────────┐      ┌────────────────────┐     ┌─────────────────────┐     ┌───────────────────────┐
 │ Portal: back-office        │      │ Keycloak realm /   │     │  Canonical Principal │     │  ichiflow authz       │
 │   strategies:[oidc-corp,   │─────▶│ Zitadel org        │────▶│  { sub, tenant,      │────▶│  gateway (PDP)        │
 │              legacy-pw]    │      │  - OIDC/SAML broker │     │    portal, roles[],  │     │   ├─ ReBAC: OpenFGA   │
 ├───────────────────────────┤      │  - upstream IdP-A   │     │    attributes{},     │     │   ├─ ABAC: Cedar      │
 │ Portal: customer           │─────▶│  - upstream IdP-B   │     │    features[] }      │     │   └─ decision log     │
 │   strategies:[oidc-social] │      │  - RFC 8693 STS     │     └─────────┬───────────┘     └──────────┬────────────┘
 ├───────────────────────────┤      └────────────────────┘               │  token exchange            │ allow/deny
 │ Portal: partner            │                                          ▼  (audience-scoped)          ▼ + reason
 │   strategies:[saml-partner]│                            downstream services / adapters      generated UI + API
 └───────────────────────────┘                            (identity preserved, least-priv)     enforce + explain
```

**Declared artifacts (AI-generatable):**

```
Portal:                              # one per audience
  id: customer
  audience: customer
  strategies: [oidc-social, legacy-password]
  broker: { realm: customer, idps: [google-oidc, acme-saml] }
  tokenExchange: { sts: keycloak, downstreamAudiences: [claims-svc, billing-svc] }

Entitlement:                         # policy-as-code, versioned
  model: rebac+abac
  relationships: openfga://ichiflow/model/1   # tenant, org, record graphs
  policies: cedar://ichiflow/features/1        # feature/attribute + field rules
  audit: { decisionLog: true, fields: [principal, action, resource, context, effect, reason] }
```

An AI agent can generate a new portal (strategies + broker connection), a new entitlement policy (from a feature/attribute description), and validate both against schema — the same "declare, don't code" principle as Part A.

## B.4 Identity propagation & multi-tenant SSO patterns

- **OAuth2 Token Exchange (RFC 8693):** portal edge authenticates the user once; when Service A must call Service B on the user's behalf, it exchanges the subject token at the STS for a new token with a **different audience/scope/lifetime but the same identity**. This is the standard for least-privilege identity propagation across microservices and for **cross-trust-domain / identity-chaining** (M&A, B2B where two identity stacks must interoperate). Keycloak and Zitadel both implement the `urn:ietf:params:oauth:grant-type:token-exchange` grant. Distinguish **delegation** (user identity preserved) vs **impersonation** (service acts as user) and log which occurred.
- **Portal-per-audience with separate IdP configs:** realize each population as a **realm (Keycloak) / organization (Zitadel)** with its own IdP set, branding, and strategy list — isolation by construction, not by convention.
- **B2B2C multi-tenant SSO:** a customer org brings its own upstream IdP; ichiflow brokers to it and scopes the resulting identity to that tenant. Requires **multiple-IdP-per-org** support (native in Zitadel/Stytch; per-connection in Keycloak; single-IdP-per-org limit in WorkOS is a known constraint to design around) plus **self-service admin** (embeddable admin portal — Stytch/WorkOS productize this; self-hosted needs building) so customer IT configures their own SSO/SCIM.

## B.5 Risks (Part B)

- **Keycloak still incubating, not graduated (CNCF).** Low practical risk (huge adoption, Red Hat backing) but note governance maturity vs. graduated projects; re-verify graduation status at adoption time.
- **Conflating AuthN and AuthZ.** The classic mistake. Keep the identity broker and the PDP as separate concerns; entitlements live in policy-as-code, not in IdP roles alone.
- **Rego footguns / policy correctness.** Rego is expressive but error-prone (runtime exceptions, non-determinism); Cedar/OpenFGA are safer/deterministic. Mitigate with policy tests, formal analysis (Cedar), and CI validation.
- **ReBAC data consistency & performance.** OpenFGA is a stateful graph that must stay in sync with business data; stale tuples = wrong decisions. Needs a write-through/CDC discipline to keep relationship tuples current, plus latency budgeting for list queries.
- **Multi-IdP-per-tenant limits.** Some managed options (WorkOS) cap one IdP per org; design tenant/IdP mapping to avoid lock-in to that constraint.
- **Token-exchange sprawl / audit gaps.** Delegation chains can obscure "who did what on whose behalf." Mandate decision + exchange logging with delegation-vs-impersonation flags.
- **Self-service SSO onboarding is real work.** If self-hosting (Keycloak/Zitadel), the embeddable "customer configures their own SSO" admin experience that WorkOS/Stytch sell must be built — budget for it.
- **Vendor lock-in vs. self-host ops burden.** Buy (Auth0/WorkOS/Stytch) trades ops for lock-in and cost; self-host (Keycloak/Zitadel) trades cost for ops. Keep the strategy/PDP abstraction so the broker is swappable.

## B.6 Sources (Part B)

- Keycloak on CNCF (incubating): https://www.cncf.io/projects/keycloak/
- Keycloak joins CNCF (2023): https://www.cncf.io/blog/2023/04/11/keycloak-joins-cncf-as-an-incubating-project/
- State of open-source identity 2025 (Authentik/Authelia/Keycloak/Zitadel): https://blog.houseoffoss.com/post/the-state-of-open-source-identity-in-2025-authentik-vs-authelia-vs-keycloak-vs-zitadel
- Authentik vs Zitadel (2026): https://wz-it.com/en/blog/authentik-vs-zitadel-identity-provider-comparison/
- Open-source auth providers 2025 (Tesseral): https://tesseral.com/guides/open-source-auth-providers-in-2025-best-solutions-for-open-source-auth
- Better Auth / Lucia deprecation / Auth.js merge: https://www.wisp.blog/blog/lucia-auth-is-dead-whats-next-for-auth and https://github.com/lucia-auth/lucia/discussions/1714
- Policy engine showdown OPA vs OpenFGA vs Cedar (Permit.io): https://www.permit.io/blog/policy-engine-showdown-opa-vs-openfga-vs-cedar
- Benchmarking policy languages Rego/Cedar/OpenFGA (Teleport): https://goteleport.com/blog/benchmarking-policy-languages/
- OPA vs Cedar vs Zanzibar 2025 (Oso): https://www.osohq.com/learn/opa-vs-cedar-vs-zanzibar
- Casbin/Oso/Permit comparison (Permit.io, 2026): https://www.permit.io/blog/top-open-source-authorization-tools-for-enterprises-in-2026
- Apache Casbin: https://github.com/apache/casbin
- OPA decision logs: https://www.openpolicyagent.org/docs/management-decision-logs
- RBAC vs ABAC (Permit.io): https://www.permit.io/blog/rbac-vs-abac
- ReBAC vs policy-based (WorkOS): https://workos.com/blog/relationship-based-vs-policy-based-authorization
- RFC 8693 Token Exchange: https://datatracker.ietf.org/doc/html/rfc8693
- RFC 8693 deep dive / identity chaining: https://dev.to/kanywst/rfc-8693-deep-dive-token-exchange-310i and https://dev.to/kanywst/identity-chaining-deep-dive-connecting-identity-across-trust-domains-with-oauth-2onb
- Auth0 vs Okta vs Stytch vs WorkOS buyer framework (2026): https://securityboulevard.com/2026/06/auth0-vs-okta-vs-stytch-vs-workos-vs-ssojet-2026-a-buyer-stage-framework/
- Stytch vs WorkOS (multi-IdP, admin portal): https://workos.com/blog/stytch-alternatives

---

## Cross-cutting synthesis

Both pillars reduce to the same architecture: **a schema'd contract at the edge + a runtime that interprets it + a canonical model the core speaks.** For integration the contract is AsyncAPI/OpenAPI and the canonical model is the event/command CDM; for identity the contract is the portal/entitlement declaration and the canonical model is the security context (principal + tenant + attributes + features). In both, the payoff of "declare, don't code" is that **an AI agent can generate the artifact from a spec and a validator can check it before deploy** — which is precisely ichiflow's reason to exist.
