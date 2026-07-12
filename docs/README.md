# ichiflow documentation

ichiflow is an AI-native enterprise workflow development framework. It modularizes the recurring
shape of enterprise software — back-office and customer-facing interfaces, rule flows that
determine outcomes, and manual review — into a schema-centric, declarative-first, API-first,
pluggable, deeply auditable system that is productive for AI coding agents at both build time and
run time.

## How to read this set

- **Start at [`architecture/00-vision-and-principles.md`](architecture/00-vision-and-principles.md)**,
  then read the architecture docs in numeric order (`00`–`13`). `01-system-overview.md` gives the
  container-level map; each later doc drills into one layer.
- **[`architecture/BRIEF.md`](architecture/BRIEF.md) is the canonical quick-reference** — the locked
  decisions, core vocabulary, personas, and doc conventions the whole set is written against (and
  referenced throughout, by section). Read it first if you want the decisions and shared nouns
  without the prose; the normative record of each decision is still its ADR.
- **[`adr/`](adr/) records the decisions** in MADR style (Context, Decision, Alternatives,
  Consequences), each citing the research that grounds it. See [`adr/README.md`](adr/README.md).
- **[`examples/`](examples/) shows the design in use** — a canonical reference-product walkthrough
  plus [`examples/case-studies/`](examples/case-studies/), a living set of design-validation
  fixtures that stress the design against realistic domains.
- **[`research/`](research/) is the raw market/technology research** that fed the decisions. These are
  point-in-time historical inputs (July 2026), not kept in sync; the architecture docs and ADRs are
  the authoritative, current design.

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
| [12 — System Map & v1 Surfaces](architecture/12-system-map-and-v1-surfaces.md) | Complete inventory of every human-facing surface (build / LLM-only / integrated third-party / post-v1), the system map, and the per-capability placement classification table (ADR-0033 §6). |
| [13 — Agent Harness Loops](architecture/13-agent-harness-loops.md) | Harness-first construction: how every subsystem ships a deterministic verification harness before its implementation; `ichiflow verify`, the verdict schema, and the per-subsystem harness catalogue. |

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
| [0010](adr/0010-hybrid-authorization-openfga-plus-policy.md) | Hybrid authorization: one PDP for API and UI; v1 = OpenFGA ReBAC only, Cedar/OPA ABAC a post-v1 add-on behind the same interface. |
| [0011](adr/0011-decisionrecord-and-selective-event-sourcing.md) | Per-case DecisionRecord + "why" API; event-source the core only; bitemporal as-of; observability is OTel-native, BYO backend. |
| [0012](adr/0012-postgresql-first-storage-spis.md) | PostgreSQL-first storage with SPIs; multi-DB correlation via global case_id. |
| [0013](adr/0013-modular-monolith-split-later.md) | Modular monolith by default, async-first boundaries, split later; tier ladder; zones. |
| [0014](adr/0014-map-first-migrate-last.md) | Map first, migrate last: three-ring brownfield model; decision parity testing; exit story. |
| [0015](adr/0015-first-party-mcp-server-and-agent-kit.md) | First-party `ichiflow-mcp` server + in-repo agent kit; three server-enforced guardrail tiers. |
| [0016](adr/0016-license-hygiene-policy.md) | License hygiene: Apache-2.0/MIT substrate preference; the avoid-list and CI allowlist. |
| [0017](adr/0017-v1-kernel-and-governance-dial.md) | The v1 kernel cut + governance-level dial; single-org per deployment; v1 acceptance = reference product end-to-end + migration in/out. |
| [0018](adr/0018-domain-entity-store.md) | Domain entity store: schema-defined entities, PostgreSQL-first generated repositories; CRUD+outbox not event-sourced. |
| [0019](adr/0019-ai-chat-first-authoring.md) | AI-chat-first authoring for all personas; live preview to judge; no visual-builder canvases; designer flow prompt-first, Figma optional. |
| [0020](adr/0020-prod-access-posture-dial.md) | Production-access posture is a configurable dial; ichiflow ships the mediation layers (why API, ops console, MCP tiers, env promotion, loud/logged break-glass). |
| [0021](adr/0021-reporting-via-oss-bi.md) | Reporting = embed proven OSS BI over governed read models; SSO via broker + row/field security via the same PDP; no custom report engine. |
| [0022](adr/0022-fully-open-source.md) | ichiflow is fully open source (Apache-2.0/MIT), all of it; tiers are technical capability profiles, not commercial editions; monetize services not features. |
| [0023](adr/0023-public-sector-first.md) | Design-target first adopter is government / public sector; regulated finance is the adjacent second; permit walkthrough is the canonical reference product. |
| [0024](adr/0024-llm-only-internal-surfaces-v1.md) | LLM-only internal surfaces for v1: build human UI only for the generated end-user Portals; every internal/operator/builder surface is served by Claude Code + `ichiflow-mcp` + CLI + chat with read-only previews. |
| [0025](adr/0025-reference-data-ownership-and-teams.md) | Reference data as interdependent, owned, governed assets (CodeSet `codeRef` links, referential integrity, dependency graph); Teams as first-class sub-org structure through one PDP; per-team env-pin activation. |
| [0026](adr/0026-harness-first-construction.md) | Harness-first construction: every subsystem ships a harness (fixtures + executable checks + JSON verdict + progress metric) before its implementation; single `ichiflow verify` entry point. |
| [0027](adr/0027-dmn-authoring-projection.md) | LLM-friendly **decision source** projection compiles one-way to DMN 1.6 XML (the executed/exported artifact); full-DMN coverage is a verified metric; DRL/CEP escape hatches are first-class governed paths. |
| [0028](adr/0028-delegation-step.md) | Canonical **`external-task`** (delegation) step: submit → await a correlated response → validate → resume; the machine analog of `human-task`; transport-pluggable via adapter request-reply bindings. |
| [0029](adr/0029-document-issuance.md) | Document issuance: immutable versioned **`Document`**, the **`doctemplate`** designer artifact + rendering-engine SPI, and the canonical **`issue-document`** step; three placement profiles. |
| [0030](adr/0030-quota-ledger.md) | **`QuotaLedger`** — a first-class multi-dimensional resource-ledger artifact with atomic invariants; the canonical **`quota-op`** step; monetary dimensions, ranked reserve-list draw, release-back reflow. |
| [0031](adr/0031-set-level-cases.md) | Set-level Cases: **`cohort`** (gather-barrier → one set-level decision → scatter) and **`bundle`** (heterogeneous sub-Case fan-out with partial-tolerant roll-up); the CaseType catalog. |
| [0032](adr/0032-case-association.md) | **`Case association`** — first-class many-to-many peer links between independent Cases; typed link kinds, PDP-scoped visibility, cross-Case invariant checks; distinct from correlation and bundles. |
| [0033](adr/0033-packaging-and-placement.md) | Packaging & placement doctrine: a decision tree (core / first-party optional / SPI+thin default / external-delegation) classifying semantics not product areas; a living classification table in doc 12 §6. |

## Examples

Design-in-use narratives and validation fixtures. The permit walkthrough is the **canonical
reference product**; the case studies are **living design-validation fixtures** (not shipped
products, not normative) that stress the design against realistic multi-domain scenarios.

| Doc | Shows |
|---|---|
| [Creating a Permit Product](examples/creating-a-permit-product.md) | End-to-end "show me" walkthrough of the canonical reference product: schemas → decisions → flows → portal → audit → `ichiflow-mcp` debug. |
| [Case study — customs declaration](examples/case-studies/customs-declaration.md) | Multi-authority declaration processing: parallel authority reviews, `external-task` delegation (MQ / SFTP), CompositeOutcome, clock-stop SLAs. |
| [Case study — competitive grant program](examples/case-studies/grant-program.md) | Multi-stage panel review: COI-filtered reviewer assignment, budget-pool QuotaLedger, Case associations, staged claims/acquittal. |
| [Case study — motor insurance claim](examples/case-studies/motor-insurance-claim.md) | Enterprise brownfield claim processing: migration-in modeling, adapters, and decisioning over a legacy estate. |
| [Case study — multi-agency licensing](examples/case-studies/multi-agency-licensing.md) | A licensing platform fanning out to multiple agencies: bundle sub-Cases, mixed internal `human-task` vs `external-task` review modes. |
| [Case study — public-housing ballot](examples/case-studies/public-housing-ballot.md) | A ballot draw: cohort gather-barrier, ranked reserve-list draw against the QuotaLedger, reproducible seeded ordering. |
| [Case study — points-based work pass](examples/case-studies/work-pass-compass.md) | A points-based work-pass determination: scored DRD Outcome with `scoreBreakdown`, exemptions, clock-stop applicant waits, Case operations. |

## Research inputs (read-only)

Background research that fed the decisions above. These are **point-in-time inputs (July 2026)**,
preserved as a historical record and not kept in sync — each carries a banner to that effect. The
authoritative, current design lives in the architecture docs and ADRs; where research and an ADR
disagree, the ADR wins.

| Doc | Topic |
|---|---|
| [01 — Rule Engines](research/01-rule-engines.md) | Business rule engine market and feature assessment (DMN, Drools/KIE, GoRules ZEN, ODM). |
| [02 — Workflow Orchestration](research/02-workflow-orchestration.md) | Durable-execution vs BPMN/CMMN engines; Temporal, Camunda, Flowable, Conductor, DBOS; SDK/language notes. |
| [03 — Schema and Types](research/03-schema-and-types.md) | Schema-first IDL, cross-language type generation, and UI generation. |
| [04 — Adapters and Auth](research/04-adapters-and-auth.md) | Integration adapters and pluggable auth / access control. |
| [05 — Audit, Observability, Deployment](research/05-audit-observability-deployment.md) | Audit/explainability, observability, deployability, multi-database, and zone separation. |
| [06 — Migration and Onboarding](research/06-migration-and-onboarding.md) | Brownfield migration and progressive developer/user experience. |
| [07 — AI-Native Operations](research/07-ai-native-operations.md) | Making coding agents first-class at build time and run time. |
