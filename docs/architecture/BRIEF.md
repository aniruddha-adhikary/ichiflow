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
   Temporal. Computation that is neither a Decision nor an Adapter runs in a first-class **`compute`
   step** — a typed Kotlin/TS **code activity** (schema'd boundary, versioned `ref`, unit-testable,
   trace-emitting), the *same* unified code-activity contract used by decision feature-functions and
   adapter code-transforms. Flows have three authoring surfaces — a **typed TS/Kotlin flow builder**
   (steps, guards, and event listeners as pure typed code), **YAML**, and **AI chat** — but the
   **canonical flow JSON is the single executed/audited/exported artifact**: the typed builder
   compiles **one-way** to it (mirroring TypeSpec→OpenAPI; simple flows may still be authored as YAML
   directly, no fake round-trip), and every flow carries `authored-in: code | yaml | ai-chat`
   provenance. Human tasks / manual review / case management is a first-party ichiflow module
   (await-signal + SLA timers + escalation; assignment routing is itself a decision).
3. **Deployment target**: self-hosted enterprise first (K8s/Helm/operator, air-gap capable),
   with a single-binary/docker-compose dev mode; progressive ladder from laptop to zoned HA.
4. **Languages**: Kotlin core (rules eval, flow **activity** workers, core domain services),
   TypeScript edges (portals/UI, BFFs, CLI/tooling). The deterministic Temporal **flow-interpreter
   workflow runs in TypeScript** — Temporal has no first-class Kotlin SDK, so workflow (orchestration)
   code is TS and Kotlin is confined to activity workers (see ADRs 0003/0007). Types on both sides
   are generated from one schema source.
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
8. **Authorization**: central PDP driving the SAME entitlements across generated API and generated
   UI (field/row-level); authz decisions produce decision logs (explainable). **v1 = OpenFGA only**
   (ReBAC backbone + list-filtering + simple attribute conditions). **Cedar/OPA ABAC** for richer
   attribute/feature/field-level policy is a **post-v1 capability-profile add-on (open source,
   optional install) behind the same PDP interface** — the PDP contract is unchanged whether one
   engine or two sit behind it; the hybrid
   OpenFGA + Cedar/OPA model remains the target end-state. Design-time artifact access (who may
   edit/approve a CodeSet, Schema, DecisionModel, Flow, uischema, policy) runs through the **same
   PDP** as runtime, via **owning-Team + role-as-relation** ownership (OpenFGA); see doc 06 Part 4,
   ADR-0025.
9. **Audit/explainability**: per-case DecisionRecord is a first-class typed domain object
   stitching workflow event history + fired-rule traces + DMN results + human review + AI-agent
   actions into one causal chain, queryable via a "why" API. Event-source the decision/flow
   core only; audit tables + transactional outbox elsewhere; bitemporal as-of support.
   Observability is **OTel-native, BYO backend**: all signals (traces/metrics/logs/decision events)
   export via standard OTLP and work with AWS CloudWatch/X-Ray, Google Cloud Operations, Grafana,
   Datadog, etc.; ichiflow builds **no proprietary observability store** and ships **no bundled
   Grafana-class stack as a commitment** (integration guidance only) — the Dev tier bundles a minimal
   local viewer.
10. **Persistence**: PostgreSQL-first with storage SPIs (audit/search/analytics swappable);
    correlation via global case_id; CDC via Debezium where needed.
11. **Topology**: modular monolith by default, async-first module boundaries, split-later into
    independently scalable services; explicit DMZ/intranet zone support (portal in DMZ, core in
    intranet, one-way async relay between zones). **v1 is single-org per deployment**, with
    multi-tenant seams designed in now (tenant_id discipline in schemas/persistence, per-Portal IdP
    isolation already present, entitlement scoping) so hosted multi-tenant can follow later without
    rework. Within the single-org deployment, **teams/departments/partner-orgs are sub-structures,
    not tenants** — an ownership/role boundary, distinct from the tenant boundary whose
    multi-tenant seams remain for later (ADR-0025).
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
    ichiflow itself is **fully open source** (Apache-2.0/MIT) end to end — see decision 15.
15. **Fully open source**: ichiflow ships **entirely under Apache-2.0/MIT — all of it**, including
    every capability the docs call "enterprise"/"compliance". There is **no gated feature, no
    open-core, no source-available tier**. Monetization, if ever, is **support / hosting / services**,
    never gated features. The Dev/Team/Enterprise **tiers are technical capability profiles**
    (deployment-complexity ladders), **not commercial editions**; a "compliance profile/add-on" is an
    open-source, optional install (ADR-0022, consistent with the licensing-hygiene ADR-0016).
16. **Design target — public sector first**: the primary first-adopter design target is
    **government / public-sector-style casework** (permitting, licensing, registrations, benefits,
    inspections), with **regulated financial services** the adjacent second target (loan/claims/KYC
    examples stay valid). Onboarding/domain templates prioritize permit/licensing/benefits-style
    templates; procurement realities (self-host, air-gap, data residency) already fit. The permit
    walkthrough ([`../examples/creating-a-permit-product.md`](../examples/creating-a-permit-product.md))
    is the **canonical reference product**. **HARD RULE: no real government systems are named.**
    **v1 acceptance = TWO required exercises, both passing on the actual kernel**: (a) the **reference
    product end-to-end** (schemas→decisions→flows→portal→audit→ichiflow-mcp debug, all real); and (b) a
    **migration exercise, in and out** — a generic legacy database-and-spreadsheet casework source taken
    through Ring 0 declarative mapping (zero/additive DDL), legacy rules re-expressed as DecisionModels,
    **decision-parity testing** against a golden dataset of historical outcomes, plus a verified **exit
    story** (export DMN/Flow JSON/schemas/data, consumable outside ichiflow). Anti-lock-in means
    migration in *and* out are both on the bar (ADR-0023, ADR-0017 amendment).
17. **Prefer proven open source**: when a mature OSS component exists for a **non-differentiating**
    concern, **integrate it rather than build** (BI, IdP, observability backends are the exemplars);
    the **differentiators — decision governance, DecisionRecord, Flow DSL, Copilots — are built**.
    Reporting therefore **embeds proven OSS BI** (Metabase/Superset-class) over ichiflow's
    schema-derived, **governed read-model projections** (cases, outcomes, conditions/obligations,
    SLAs, decision stats) with first-class integration (embedding, SSO via the broker, row/field-level
    security driven by the same PDP); there is **no custom report engine** (ADR-0021).
18. **Production-access posture is a configurable dial**: ichiflow ships the mediation layers (the
    *why* API, the support/ops console, ichiflow-mcp guardrail tiers, env promotion as the artifact
    write path, break-glass that is loud and logged), and each org **configures its posture** —
    e.g. `zero-direct-access` / `agents-mediated-humans-conventional` / `custom` — rather than
    inheriting one forced default (ADR-0020).
19. **LLM-only internal surfaces for v1**: v1 keeps its **human-built UI surface to the absolute
    minimum** — it builds human UI **only for the generated end-user Portals** (customer/partner
    forms + status, and the **back-office manual-review** Task inbox + Case/review view), because
    *generating those Portals is the product*. **Every internal / operator / builder / admin surface**
    (support/ops console, Decision governance/approval, Design Kit playground + component workbench,
    admin/config, standalone auditor query, Copilot UIs) is served **LLM-first** — Claude Code +
    `ichiflow-mcp` + the `ichiflow` CLI + chat — with **live previews as read-only rendered artifacts**
    (an `ichiflow preview` dev-server URL, not an interactive app). This is a *prove-it-fast* posture
    **and** an LLM-first bet. The **capability to add builder-style surfaces later is preserved**: the
    underlying typed APIs / MCP tools **are** the seam, so a post-v1 UI is just another client of a
    contract v1 already ships — **only the v1 phasing of surfaces changes, never a seam or contract**
    (ADR-0024; surface inventory in doc 12).

## Core vocabulary (use these names consistently)

- **Schema** — canonical typed model (TypeSpec-authored; JSON Schema artifact).
- **Decision** — a rule-evaluated determination; authored as DMN; evaluated by an Engine via the
  Decision Engine SPI. A **DecisionModel** is versioned + governed.
- **Outcome** — the typed result of a Decision: `{ type (approve | deny | refer | conditional-approve
  | partial | …), reasons[], conditions[], authority? }`. Replaces ad-hoc `{outcome, reasonCodes}`.
  A **CompositeOutcome** aggregates N per-authority Outcomes under a declared composition policy
  (all-must-approve / any-blocks / quorum(k) / weighted); each member's codes stay attributed to their
  originating authority.
- **Condition** — an individually typed, stateful obligation carried by an Outcome:
  `kind ∈ {blocking, post-approval-obligation}`, `state ∈ {pending, fulfilled, waived, breached}`.
  Blocking Conditions gate a later Flow step; post-approval obligations are deadline-bearing and
  tracked after the Case closes.
- **CodeSet / ReferenceData** — a schema'd, row-structured, semver-versioned + effective-dated
  reference table (reason codes, condition codes, cancellation reasons, field-eligibility rules,
  fee/rate tables) governed like any other contract; Decisions, Flows, and the UI reference a CodeSet
  by `id@version` rather than inlining its rows. Each row carries per-audience display metadata.
  CodeSets are **interdependent** — a row may carry `codeRef` columns (foreign-key-like references
  to a row in another `CodeSet@version`), whose cross-version, effective-dated **referential
  integrity is validated at publish** and whose **dependency graph** is queryable ("what depends on
  this code?") by humans and `ichiflow-mcp`; deprecating a referenced row triggers publish-time
  impact analysis (blocked publish or forced dependent review). Every CodeSet has an **owning Team +
  named stewards** and may override the governance dial per artifact.
- **Flow** — declarative long-running process definition interpreted on Temporal.
- **Compute step / code activity** — the unified typed-code extension primitive: a versioned,
  schema'd-at-the-boundary, trace-emitting Kotlin/TS unit (`ref: <lang>://<module>/<Name>@<version>`
  + input/output JSON Schema) used identically as a Flow `compute` step, a Decision feature-function,
  and an Adapter code-transform. Computation lives here; declarative artifacts stay for control-flow
  graphs, rule tables, and structural mappings. Because it is schema'd at its boundary and emits a
  trace, code participates in the audit spine without the DSL becoming a programming language.
- **authored-in** — provenance on a Flow (and any artifact with multiple authoring surfaces)
  recording which surface produced the canonical artifact: `code` (typed builder), `yaml`, or
  `ai-chat`. The canonical JSON/DMN remains the executed/audited/exported artifact regardless.
- **Case** — a unit of business work flowing through Flows (incl. manual review); carries the
  global `case_id` and its DecisionRecord. Supports post-submission operations (amend, cancel,
  withdraw, appeal, correct).
- **Task** — a human work item within a Case (assignment, SLA, escalation; SLA clocks are pausable).
- **Adapter** — declared (schema'd, versioned) port in/out: REST, MQ/JMS/Kafka/AMQP, file/SFTP,
  SOAP, webhook, CDC. Inbound → canonical command/event; outbound from canonical.
- **Portal** — an audience-scoped UI + BFF (back-office, customer, partner) with its own IdP
  config and entitlements.
- **Team** — a first-class sub-structure *within* the single deployed org (department,
  line-of-business, or partner organization; teams nest) — **not** a tenant. Membership and
  **role-as-relation** (steward / approver / editor / viewer) plus artifact/resource **ownership**
  relations drive who may **view / modify / approve**, at **design time** (Workspace artifacts) and
  **run time** (Cases, Tasks, entity rows), through the **same PDP** (§8). Every governed artifact
  (CodeSets, Schemas, DecisionModels, Flows, uischemas, policies) is **owned by a Team** with named
  stewards (ADR-0025).
- **Design Kit** — the first-party UX-designer toolchain (parallel to the AI-native agent kit):
  a DTCG design-token pipeline, a component workbench, a live playground (real screens over
  schema-driven mocks), and a designer-facing safety contract (see doc 07). uischema/viewschema
  are the canonical artifacts; **AI chat authors them and the live playground is the read-only
  judgment surface** (no visual-builder canvas — Authoring doctrine; ADR-0019). The **chat +
  live-preview playground is THE designer surface** (prompt-first, rapid low-fi exploration against
  real schemas/mock data). **Figma is optional**: it imports brand tokens/variables *in* (the DTCG
  pipeline stays) and exports rendered screens/specs *out* for stakeholder review — there is **no
  two-way hi-fi round-trip / Code-Connect-class bridge** (ADR-0019 amendment). **v1 phasing (ADR-0024):
  the workbench and playground are not built as interactive apps in v1** — the designer's v1 surface is
  **chat + a read-only `ichiflow preview` URL** that renders real screens/stories from the canonical
  artifacts; the interactive Design Kit apps are a **post-v1** builder surface (the DTCG token
  pipeline, the uischema/viewschema/pageschema/copyset artifacts, and the CI checks are all v1).
- **pageschema / copyset** — first-class **governed designer artifact classes** (see doc 07 §13):
  `pageschema` composes multiple uischema/viewschema regions into a screen; `copyset` is a
  translator-friendly, i18n-keyed microcopy catalog referenced by key (sharing the CodeSet
  `plainLanguage` i18n substrate). Versioned and CI-gated like any other contract.
- **Workspace** — the design-time project (schemas, decisions, flows, uischemas, adapters,
  policies) — a git repo an AI agent can operate on.
- **DecisionRecord / why API** — the audit/explainability object and its query surface.
- **Copilots** — Domain Modeling Copilot (greenfield), Migration Copilot (brownfield), Rule
  Authoring assistance for business users; all follow "AI proposes, deterministic tools +
  humans dispose," with provenance. (A design-facing UI/Design Copilot on the same contract is
  documented in docs 07/10.) **All Copilots are post-v1**; in v1 their artifacts (Ring-0 mappings,
  DMN, uischema/pageschema) are authored as plain declarative data by a human or agent without the
  Copilot. The AI-chat authoring doctrine (below) is the v1 assistance surface.
- **Authoring doctrine** — every persona (business user, designer, developer) authors by **AI chat
  + live preview**, not drag-and-drop or visual-builder canvases. The AI authors the artifact from
  conversation; the human steers in chat and judges via **read-only live previews** — flow diagrams,
  decision-table views, rendered screens, simulation results — rendered *from* the canonical
  artifacts, never a second editable representation. The approval surface is the **diff (AI-explained
  in plain language) + preview / simulation** pair. Direct artifact editing remains available to
  developers. (See doc 00 "Chat to author, preview to judge"; ADR-0019.)
- **Tiers** — **technical capability profiles (deployment-complexity ladders), not commercial
  editions**: Dev (single binary, SQLite/embedded), Team (docker compose/small K8s, Postgres),
  Enterprise (HA, zones, SSO, compliance profile). Same app code across tiers; config only; **all
  tiers are the one open-source build** (decision 15). A **compliance profile/add-on** is an
  open-source, optional install, not a paid pack.

## Personas

Business domain user (maps their domain, authors/tests rules with AI assistance) · UX designer
(overrides generated UI safely via the first-party **Design Kit** — token pipeline, component
workbench, live playground) · Application developer · Platform/ops engineer · Auditor /
compliance officer · AI coding agent (build + runtime) · End customer.

## Doc conventions

- Location: `docs/architecture/NN-name.md`; ADRs in `docs/adr/NNNN-title.md` (MADR-style:
  Context, Decision, Alternatives considered, Consequences; cite research docs).
- Each doc: front summary ("What this covers / Position in the system"), then substance;
  Mermaid diagrams welcome (fenced `mermaid` blocks); cross-reference sibling docs and research by relative
  path; explicit "Open questions" section at the end where genuinely undecided.
- Write for two readers at once: senior engineers and AI coding agents. Precise nouns from the
  vocabulary above; no marketing fluff. Declarative artifacts > code; when showing an artifact
  example, YAML/JSON/DMN/TypeSpec snippets are encouraged, implementation code is not.
- These are design docs for a system that does not exist yet — write in present tense about the
  target design, and mark phasing (v1 vs later) where it matters.
