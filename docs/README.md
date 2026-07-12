# ichiflow documentation

ichiflow is an AI-native enterprise workflow development framework. It modularizes the recurring
shape of enterprise software — back-office and customer-facing interfaces, rule flows that
determine outcomes, and manual review — into a schema-centric, declarative-first, API-first,
pluggable, deeply auditable system that is productive for AI coding agents at both build time and
run time.

## How to read this set

- **Start at [`architecture/00-vision-and-principles.md`](architecture/00-vision-and-principles.md)**,
  then read the architecture docs in numeric order. `01-system-overview.md` gives the container-level
  map; each later doc drills into one layer.
- **[`architecture/BRIEF.md`](architecture/BRIEF.md) is the coordination summary** — the shared
  context (locked decisions, core vocabulary, personas, doc conventions) that every architecture doc
  and ADR is written against. Read it first if you want the decisions without the prose.
- **[`adr/`](adr/) records the decisions** in MADR style (Context, Decision, Alternatives,
  Consequences), each citing the research that grounds it. See [`adr/README.md`](adr/README.md).
- **[`research/`](research/) is the raw market/technology research** that fed the decisions. These are
  read-only inputs; the architecture docs and ADRs are the authoritative design.

These are design documents for a system that does not exist yet: they describe the target design in
present tense and mark phasing (v1 vs later) where it matters.

## Architecture docs

| Doc | Covers |
|---|---|
| [00 — Vision & Principles](architecture/00-vision-and-principles.md) | What ichiflow is, why now (the AI-native inflection), the personas, guiding principles, and non-goals. |
| [01 — System Overview](architecture/01-system-overview.md) | Container-level map, the design-time **Workspace** vs runtime split, the module set, and the tier ladder. |
| [02 — Schema Foundation](architecture/02-schema-foundation.md) | TypeSpec authoring; emitted OpenAPI 3.1 / JSON Schema 2020-12 as the contract of record; codegen; CodeSets/reference data. |
| [03 — The Decision Layer](architecture/03-decision-layer.md) | DMN Decisions and the Decision Engine SPI; Outcome / CompositeOutcome / Condition; governance, simulation, and explainability. |
| [04 — Flow & Case Layer](architecture/04-flow-and-case-layer.md) | The declarative Flow DSL interpreted on Temporal (deterministic TypeScript interpreter workflow); Cases, human Tasks, SLAs, escalation. |
| [05 — Adapters (Ports In/Out)](architecture/05-adapters.md) | Declared, versioned ports in/out (REST, MQ/JMS/Kafka/AMQP, file/SFTP, SOAP, webhook, CDC); canonicalization and boundary validation. |
| [06 — Identity & Access](architecture/06-identity-and-access.md) | Identity broker per audience/portal, OAuth2 token exchange for propagation, and the hybrid central PDP (OpenFGA + Cedar/OPA). |
| [07 — UI and Portals](architecture/07-ui-and-portals.md) | The JSON Forms model (independent data + uischema), safe designer overrides, and per-audience Portals with their own BFF and IdP. |
| [08 — Audit, Explainability & Observability](architecture/08-audit-and-observability.md) | Per-case DecisionRecord and the "why" API; selective event sourcing; bitemporal as-of; OpenTelemetry correlation. |
| [09 — Deployment & Topology](architecture/09-deployment-and-topology.md) | Modular monolith and split-later; Dev/Team/Enterprise tiers; DMZ/intranet zones; scaling and disaster recovery. |
| [10 — The AI-Native Experience](architecture/10-ai-native-experience.md) | The in-repo agent kit, the first-party `ichiflow-mcp` server and its guardrail tiers, agents as non-human identities, and the Copilots. |
| [11 — Migration In and Out](architecture/11-migration-in-and-out.md) | "Map first, migrate last": the three-ring brownfield model, decision parity testing, and the migration-out/exit story. |

## Architecture Decision Records

Full list with one-line summaries in [`adr/README.md`](adr/README.md).

| ADR | Decision |
|---|---|
| [0001](adr/0001-canonical-rule-representation-dmn.md) | Canonical rule representation is DMN 1.6 (DRD + FEEL). |
| [0002](adr/0002-pluggable-decision-engine-spi-drools-default.md) | Pluggable Decision Engine SPI; Apache KIE/Drools default, GoRules ZEN second. |
| [0003](adr/0003-temporal-durable-execution-substrate.md) | Temporal (MIT) as the durable-execution substrate. |
| [0004](adr/0004-declarative-flow-dsl-on-temporal.md) | Declarative CNCF-Serverless-Workflow-aligned Flow DSL interpreted on Temporal. |
| [0005](adr/0005-first-party-case-and-human-task-module.md) | First-party Case & Human-Task module; assignment routing is itself a Decision. |
| [0006](adr/0006-typespec-authoring-openapi-jsonschema-canonical.md) | TypeSpec authoring; emitted OpenAPI 3.1 / JSON Schema 2020-12 are the contract of record. |
| [0007](adr/0007-kotlin-core-typescript-edges.md) | Kotlin core, TypeScript edges; generated types on both sides; Temporal-Kotlin caveat. |
| [0008](adr/0008-jsonforms-model-ui-overrides.md) | JSON Forms model with independent uischema and a tester/priority renderer registry. |
| [0009](adr/0009-identity-broker-per-audience.md) | Identity broker per audience (Keycloak primary; RFC 8693 propagation). |
| [0010](adr/0010-hybrid-authorization-openfga-plus-policy.md) | Hybrid authorization: OpenFGA ReBAC backbone + Cedar/OPA ABAC; one PDP for API and UI. |
| [0011](adr/0011-decisionrecord-and-selective-event-sourcing.md) | Per-case DecisionRecord + "why" API; event-source the core only; bitemporal as-of. |
| [0012](adr/0012-postgresql-first-storage-spis.md) | PostgreSQL-first storage with SPIs; multi-DB correlation via global case_id. |
| [0013](adr/0013-modular-monolith-split-later.md) | Modular monolith by default, async-first boundaries, split later; tier ladder; zones. |
| [0014](adr/0014-map-first-migrate-last.md) | Map first, migrate last: three-ring brownfield model; decision parity testing; exit story. |
| [0015](adr/0015-first-party-mcp-server-and-agent-kit.md) | First-party `ichiflow-mcp` server + in-repo agent kit; three server-enforced guardrail tiers. |
| [0016](adr/0016-license-hygiene-policy.md) | License hygiene: Apache-2.0/MIT substrate preference; the avoid-list and CI allowlist. |

## Research inputs (read-only)

Background research that fed the decisions above. Authoritative design lives in the architecture docs
and ADRs; these are inputs, not contracts.

| Doc | Topic |
|---|---|
| [01 — Rule Engines](research/01-rule-engines.md) | Business rule engine market and feature assessment (DMN, Drools/KIE, GoRules ZEN, ODM). |
| [02 — Workflow Orchestration](research/02-workflow-orchestration.md) | Durable-execution vs BPMN/CMMN engines; Temporal, Camunda, Flowable, Conductor, DBOS; SDK/language notes. |
| [03 — Schema and Types](research/03-schema-and-types.md) | Schema-first IDL, cross-language type generation, and UI generation. |
| [04 — Adapters and Auth](research/04-adapters-and-auth.md) | Integration adapters and pluggable auth / access control. |
| [05 — Audit, Observability, Deployment](research/05-audit-observability-deployment.md) | Audit/explainability, observability, deployability, multi-database, and zone separation. |
| [06 — Migration and Onboarding](research/06-migration-and-onboarding.md) | Brownfield migration and progressive developer/user experience. |
| [07 — AI-Native Operations](research/07-ai-native-operations.md) | Making coding agents first-class at build time and run time. |
