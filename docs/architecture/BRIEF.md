# ichiflow Architecture Brief (shared context for all architecture docs)

> Internal coordination document. Every architecture doc must be consistent with this brief.
> Research inputs live in `docs/research/01..07`. Cite them by relative path where relevant.

## What ichiflow is

ichiflow ("ichi" = strawberry, "flow" = flow) is an AI-native enterprise workflow development
framework. Most enterprise software = back-office interfaces + customer-facing interfaces +
rule flows that determine outcomes + manual review. ichiflow modularizes that whole shape:
schema-centric, declarative-first, API-first (UI optional but deeply integrated and
auto-generatable), pluggable everywhere, independently scalable, deeply auditable, and
purpose-built so AI coding agents (Claude Code first) are productive at build time AND run time.

## Locked decisions (do not re-litigate; record as ADRs)

1. **Rule engine**: pluggable engine SPI; canonical rule representation is DMN 1.6 (DRD + FEEL);
   Apache KIE / Drools is the default/reference engine (JVM, inference, CEP); GoRules ZEN is the
   planned second engine (TS/edge/embedded). ichiflow builds its own governance, authoring,
   simulation, and explainability layer (the true gap vs IBM ODM Decision Center).
2. **Orchestration**: Temporal is the durable-execution substrate. ichiflow ships a declarative
   flow definition (JSON/YAML, CNCF-Serverless-Workflow-aligned, schema'd) interpreted on
   Temporal. Human tasks / manual review / case management is a first-party ichiflow module
   (await-signal + SLA timers + escalation; assignment routing is itself a decision).
3. **Deployment target**: self-hosted enterprise first (K8s/Helm/operator, air-gap capable),
   with a single-binary/docker-compose dev mode; progressive ladder from laptop to zoned HA.
4. **Languages**: Kotlin core (rules eval, flow workers, core domain services), TypeScript edges
   (portals/UI, BFFs, CLI/tooling). Types on both sides are generated from one schema source.
5. **Schema strategy**: author in TypeSpec; emitted OpenAPI 3.1+ / JSON Schema 2020-12 are the
   canonical checked-in contract artifacts; AsyncAPI 3.1 for message contracts ($ref shared
   schemas). Codegen: Fabrikt (Kotlin), hey-api or orval (TS, pinned). Runtime validation from
   the same JSON Schema at every adapter boundary (Ajv/TypeBox on TS; networknt/OptimumCode on
   Kotlin). Registry: Apicurio, FULL_TRANSITIVE for events; oasdiff breaking-change CI gates.
6. **UI generation**: JSON Forms model — data schema and UI schema are two independent,
   versioned documents; overrides via tester/priority renderer registry + design tokens;
   scaffold never clobbers designer work; CI lint validates uischema scopes against schemas.
7. **Identity**: broker per audience/portal (Keycloak primary; Zitadel noted for B2B2C),
   OIDC/SAML/LDAP/legacy username-password via broker strategies; Better Auth pattern on TS
   edges; OAuth2 Token Exchange (RFC 8693) for identity propagation.
8. **Authorization**: central PDP; hybrid model — OpenFGA (ReBAC backbone, list-filtering) +
   Cedar or OPA for ABAC/feature/field-level policies; the SAME PDP drives generated API and
   generated UI (field/row-level); authz decisions produce decision logs (explainable).
9. **Audit/explainability**: per-case DecisionRecord is a first-class typed domain object
   stitching workflow event history + fired-rule traces + DMN results + human review + AI-agent
   actions into one causal chain, queryable via a "why" API. Event-source the decision/flow
   core only; audit tables + transactional outbox elsewhere; bitemporal as-of support.
10. **Persistence**: PostgreSQL-first with storage SPIs (audit/search/analytics swappable);
    correlation via global case_id; CDC via Debezium where needed.
11. **Topology**: modular monolith by default, async-first module boundaries, split-later into
    independently scalable services; explicit DMZ/intranet zone support (portal in DMZ, core in
    intranet, one-way async relay between zones).
12. **AI-native surfaces**: in-repo agent kit (AGENTS.md, .claude/ skills, hooks, subagents,
    plugin) + first-party `ichiflow-mcp` runtime MCP server exposing the why/case/flow query
    APIs with three server-enforced guardrail tiers (read-only / sandbox-mutating /
    prod-mutating with JIT + approval + audit). Agents are non-human identities under §7/§8.
13. **Migration**: "map first, migrate last." Ring 0 declarative schema-mapping/ACL over the
    existing DB (zero/additive DDL); Ring 1 coexist via CDC + outbox + strangler; Ring 2
    assisted expand/contract structural migration (Atlas + pgroll). Migration Copilot and
    Domain Modeling Copilot are framework features with hard guardrails (human approval,
    dry-run, shadow-read, provenance, never-touch-prod). Decision parity testing (legacy vs
    migrated rules on golden datasets) is a first-class capability. Exit story: everything
    exportable (DMN, flow DSL, schemas, data) — migration OUT is as supported as migration IN.
14. **Licensing hygiene**: avoid Camunda 8 (paid license), Liquibase 5 (FSL), KurrentDB (KLv1
    needs legal review), openapi-fetch (maintenance mode). Prefer Apache-2.0/MIT substrates.

## Core vocabulary (use these names consistently)

- **Schema** — canonical typed model (TypeSpec-authored; JSON Schema artifact).
- **Decision** — a rule-evaluated determination; authored as DMN; evaluated by an Engine via the
  Decision Engine SPI. A **DecisionModel** is versioned + governed.
- **Flow** — declarative long-running process definition interpreted on Temporal.
- **Case** — a unit of business work flowing through Flows (incl. manual review); carries the
  global `case_id` and its DecisionRecord.
- **Task** — a human work item within a Case (assignment, SLA, escalation).
- **Adapter** — declared (schema'd, versioned) port in/out: REST, MQ/JMS/Kafka/AMQP, file/SFTP,
  SOAP, webhook, CDC. Inbound → canonical command/event; outbound from canonical.
- **Portal** — an audience-scoped UI + BFF (back-office, customer, partner) with its own IdP
  config and entitlements.
- **Workspace** — the design-time project (schemas, decisions, flows, uischemas, adapters,
  policies) — a git repo an AI agent can operate on.
- **DecisionRecord / why API** — the audit/explainability object and its query surface.
- **Copilots** — Domain Modeling Copilot (greenfield), Migration Copilot (brownfield), Rule
  Authoring assistance for business users; all follow "AI proposes, deterministic tools +
  humans dispose," with provenance.
- **Tiers** — Dev (single binary, SQLite/embedded), Team (docker compose/small K8s, Postgres),
  Enterprise (HA, zones, SSO, compliance packs). Same app code across tiers; config only.

## Personas

Business domain user (maps their domain, authors/tests rules with AI assistance) · UX designer
(overrides generated UI safely) · Application developer · Platform/ops engineer · Auditor /
compliance officer · AI coding agent (build + runtime) · End customer.

## Doc conventions

- Location: `docs/architecture/NN-name.md`; ADRs in `docs/adr/NNNN-title.md` (MADR-style:
  Context, Decision, Alternatives considered, Consequences; cite research docs).
- Each doc: front summary ("What this covers / Position in the system"), then substance;
  Mermaid diagrams welcome (```mermaid); cross-reference sibling docs and research by relative
  path; explicit "Open questions" section at the end where genuinely undecided.
- Write for two readers at once: senior engineers and AI coding agents. Precise nouns from the
  vocabulary above; no marketing fluff. Declarative artifacts > code; when showing an artifact
  example, YAML/JSON/DMN/TypeSpec snippets are encouraged, implementation code is not.
- These are design docs for a system that does not exist yet — write in present tense about the
  target design, and mark phasing (v1 vs later) where it matters.
