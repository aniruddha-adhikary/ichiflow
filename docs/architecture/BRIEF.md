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
   simulation, and explainability layer (the true gap vs IBM ODM Decision Center). DMN 1.6 XML stays
   the **executed/exported/interchange** artifact, but — because DMN XML is LLM-hostile to author
   directly — an LLM-friendly canonical **decision source** projection (a structured markdown/YAML/JSON
   form covering the **full DMN 1.6 feature set**: DRDs, all boxed-expression kinds, item definitions —
   not decision tables only) **compiles deterministically one-way** to it, mirroring TypeSpec→OpenAPI
   and the flow builder→FlowJSON; **100% AI coverage of the DMN surface is a verified metric via a
   projection-coverage harness** (doc 13). `authored-in` provenance extends to DecisionModels
   (`decision-source | dmn-xml | drl | ai-chat`), direct DMN XML authoring stays available, and the
   engine-native escape hatches (DRL / rule units / CEP) are **first-class AI-authorable + testable
   governed paths** — quarantine marks *portability*, never authorability (ADR-0027).
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
   provenance. The canonical step-type set is closed, but new step kinds are **additive at a declared
   seam**: **custom Flow step types** are schema'd, interpreter-registered **compute-variants** under
   a Workspace-declared extension namespace (e.g. `x-<org>/<stepType>`), each backed by the unified
   code-activity contract and validated + trace-emitting like `compute` — so a new step kind is
   discoverable and additive, not a fork to the raw Temporal SDK. Human tasks / manual review / case
   management is a first-party ichiflow module (await-signal + SLA timers + escalation; assignment
   routing is itself a decision). Its **machine analog is a canonical `external-task` (delegation)
   step**: submit a schema'd request to an external system through an outbound Adapter, durably await a
   **correlated** response through an inbound Adapter, validate it, and resume (with timeout / escalation /
   compensation paths) — reusing the same await-signal + pausable-SLA machinery, with *which* external
   system to use itself a Decision. Transport is pluggable beneath the one step via the Adapter
   request-reply bindings (HTTP sync/callback/polling + message-queue request-reply in v1; an **SFTP
   file round-trip** profile is **designed now, implemented post-v1**) (ADR-0028).
3. **Deployment target**: self-hosted enterprise first (K8s/Helm/operator, air-gap capable),
   with a single-binary/docker-compose dev mode; progressive ladder from laptop to zoned HA.
4. **Languages**: Kotlin core (rules eval, flow **activity** workers, core domain services),
   TypeScript edges (portals/UI, BFFs, CLI/tooling). The deterministic Temporal **flow-interpreter
   workflow runs in TypeScript** — Temporal has no first-class Kotlin SDK, so workflow (orchestration)
   code is TS and Kotlin is confined to activity workers (see ADRs 0003/0007). Types on both sides
   are generated from one schema source. The unified **code-activity worker is a declared SPI**: new
   worker languages are **additive behind the schema'd boundary + trace contract**; **Kotlin/TS are
   the only v1 implementations**, and **Python is the expected first post-v1 addition** (ML
   feature-prep). The language is never the audit boundary — the schema'd `ref` boundary + emitted
   trace are.
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
    plugin) + a pinned **`resources` manifest** (version-matched authoritative references,
    `get_resources` at run time) + first-party `ichiflow-mcp` runtime MCP server exposing the
    why/case/flow query APIs with three server-enforced guardrail tiers (read-only /
    sandbox-mutating / prod-mutating with JIT + approval + audit). Agents are non-human
    identities under §7/§8.
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
20. **Harness-first construction**: every subsystem ships a deterministic verification harness
    (fixtures/golden data + executable checks + machine-readable JSON verdict + enumerable progress
    metric) BEFORE its implementation — the agent-era analog of TDD. `ichiflow verify --scope … --json`
    is the single entry point; verdicts are JSON (never prose) and "how much is done" is a
    conformance/coverage count, not a claim. The Decision Engine SPI ships a DMN-TCK conformance suite
    any engine must pass; harness definitions are governed Workspace artifacts that also ship to
    app-builders. Building ichiflow itself runs harness-first (each phase's exit = its harness green in
    CI), and the two v1 acceptance exercises are the outermost harnesses (ADR-0026, doc 13).
21. **Write paths and extension doctrine**: two invariants hold across the whole system. **(a) Version
    control is the write path.** Every governed artifact change lands as a **git commit** — content
    *and* the env pin that activates a released version (promotion = commit-the-pin + deploy of the
    artifact bundle; the runtime registry is a downstream pin/gate, never a write surface). Runtime
    business data (Cases/Tasks/entity rows, Tier-2 actuations) goes through the **audited runtime
    path** (DecisionRecord / append-only ledger), never git. Effective-dating decouples merge-time
    from activation-time; the emergency-change path is an **expedited PR + loud/logged break-glass**,
    reconciled by a back-filled commit — never a bare registry write (doc 03 §5.7, doc 09 §6.3,
    ADR-0020). **(b) Closed core, declared extension points.** Every closed vocabulary is either
    **argued closed** in its doc or carries a **declared, schema'd, discoverable extension point** (an
    `x-`/SPI seam with an extension schema and a discovery affordance) — the review rule behind the
    Decision-Engine SPI, storage SPIs, renderer registry, composition-policy-via-DMN, code-activity
    worker SPI, extension Flow step types, the Adapter-binding SPI, and the MCP tool-extension SPI
    (doc 00 principles).

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
  trace, code participates in the audit spine without the DSL becoming a programming language. The
  worker behind it is a **declared SPI** (Kotlin/TS in v1, Python expected first post-v1 for ML
  feature-prep), and it is the substrate for **extension Flow step types**.
- **authored-in** — provenance on any artifact with multiple authoring surfaces, recording which
  surface produced the canonical artifact. A **Flow**: `code` (typed builder) | `yaml` | `ai-chat`. A
  **DecisionModel**: `decision-source` (the decision source projection) | `dmn-xml` (direct DMN) | `drl`
  (engine-native escape hatch) | `ai-chat`. The canonical DMN-XML (or, for an engine-native model, its
  engine-native text) remains the executed/audited/exported artifact regardless.
- **decision source** — the LLM-friendly canonical **authoring projection** for a DecisionModel: a
  structured markdown/YAML/JSON form (FEEL throughout) that expresses the **full DMN 1.6 feature set** —
  DRDs (decision / input-data / BKM / knowledge-source nodes + dependencies), **all** boxed-expression
  kinds (decision tables, literal FEEL, contexts, invocations, functions/BKMs, lists, relations), and
  item definitions — and **compiles deterministically one-way to DMN 1.6 XML**, the executed/exported
  artifact. Decision tables are the common shape, not the only one; **nothing in DMN is authorable only
  by hand-writing XML** (verified by a projection-coverage harness, doc 13). The Decision-layer mirror
  of TypeSpec→OpenAPI and the flow builder→FlowJSON; no round-trip is promised, and direct DMN XML
  authoring stays available (ADR-0027).
- **Extension step type** — a **custom Flow step type** declared in the Workspace under an extension
  namespace (`x-<org>/<stepType>`): a schema'd, interpreter-registered **compute-variant** backed by
  the unified code-activity contract, validated + trace-emitting like `compute`. The canonical
  step-type set stays closed; new step kinds are additive + discoverable at this declared seam rather
  than a fork.
- **external-task / delegation step** — a **canonical Flow step** (the closed set gains this member, not
  an extension type) that **offloads a unit of work to an external system**: submit a schema'd request
  through an **outbound Adapter**, durably **await a correlated response** through an **inbound Adapter**,
  validate it against a response schema, then resume (or take timeout / escalation / compensation paths).
  It is the **machine analog of the human `Task`** (await-signal + SLA), reusing the pausable-clock +
  escalation machinery; *which* external system is chosen can itself be a Decision (mirror of assignment
  routing). Transport is pluggable underneath via **Adapter request-reply bindings** and the Request-Reply
  EIP — HTTP sync / async-callback / polling, message-queue request-reply, and an SFTP file round-trip
  (the SFTP profile is **designed now, implemented post-v1**). Failure is a first-class taxonomy
  (no-response timeout / negative-ack / malformed → DLQ + Case surfacing). See doc 04 §2.8/§5.8, doc 05
  §11, ADR-0028.
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
- **resources manifest** — a schema'd, versioned agent-kit artifact mapping topics → authoritative
  references (docs, specs, conformance repos, ichiflow's own specs/fixtures), **pinned to the
  dependency version in use** and updated with it; skills consult it before non-trivial authoring,
  `ichiflow-mcp` exposes it at run time via `get_resources(topic)`, and air-gapped installs resolve
  topics to vendored offline copies. Every subsystem gets one; the decision layer (Drools/Apache
  KIE) is the exemplar and the v1-mandatory manifest.
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
