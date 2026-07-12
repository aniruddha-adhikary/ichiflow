# 00 — Vision & Principles

**What this covers.** The purpose of ichiflow, the shape of enterprise software it
modularizes, why it is being built now (the AI-native inflection), the personas it serves
and what each gets, the named design principles every other doc must uphold, explicit goals
*and* non-goals, and an honest positioning against the incumbent tool classes (IBM
ODM-class BRMS, Camunda-class BPM, Retool-class internal-tool builders).

**Position in the system.** This is the root document. It sets the vocabulary and the value
judgments; [`01-system-overview.md`](01-system-overview.md) turns them into an integrating
map, and docs `02`–`11` are the deep dives. Where a principle here rests on a researched
tradeoff, it cites the source brief under [`../research/`](../research/). This doc describes a
**target design for a system that does not yet exist** — it is written in present tense about
that target, with phasing (v1 vs later) marked where it matters.

---

## 1. What ichiflow is

**ichiflow** ("ichi" = strawberry, "flow" = flow) is an **AI-native enterprise workflow
development framework**. It is not an application; it is the framework you build regulated,
long-running, human-in-the-loop enterprise applications *with* — and the runtime those
applications execute *on*.

The observation it is built on: the great majority of enterprise software is the same four
things wearing different domains.

1. **Back-office interfaces** — the screens staff use to review, approve, correct, and act.
2. **Customer / partner-facing interfaces** — the screens and APIs the outside world submits
   work through.
3. **Rule flows that determine outcomes** — the decisions (approve/deny/price/route) and the
   long-running processes that carry a unit of work from arrival to resolution.
4. **Manual review** — the human judgement inserted where automation should not or cannot
   decide, with assignment, SLAs, and escalation.

A loan origination system, an insurance claims platform, a KYC/onboarding pipeline, a
benefits adjudicator, a trade-exception desk — strip the domain nouns and they are the same
skeleton. ichiflow **modularizes that skeleton** so a team declares the parts specific to
their domain and inherits the rest, correct and audited, from the framework.

**Primary design target — public-sector casework.** ichiflow's first-adopter design target is
**government / public-sector-style casework**: permitting, licensing, registrations, benefits, and
inspections — regulated, human-in-the-loop processes with codified eligibility, obligations, appeals,
and a hard audit mandate. **Regulated financial services** (loan origination, claims, KYC) is the
**adjacent second target**, and every finance example in these docs stays valid. The two share the
skeleton above; choosing public sector first orients the onboarding templates
(permit/licensing/benefits-style first) and confirms that ichiflow's procurement-hard properties —
self-host, air-gap, data residency, full exportability — are load-bearing, not optional. The
**canonical reference product** is the outdoor-event-permit walkthrough in
[`../examples/creating-a-permit-product.md`](../examples/creating-a-permit-product.md). **No real
government system is ever named** in these docs; illustrations are generic by rule. (Product strategy:
ADR-0023.)

The framework is:

- **Schema-centric** — one canonical typed model is the source of truth; every type,
  validator, form, and contract is generated from it (see
  [`../research/03-schema-and-types.md`](../research/03-schema-and-types.md)).
- **Declarative-first** — Decisions are DMN, Flows are a schema'd JSON/YAML DSL, Adapters and
  policies are typed artifacts. Code is the exception (custom transforms), config is the rule.
- **API-first, UI optional-but-integrated** — the contract is useful with no UI at all; the
  UI is auto-generated from the same schemas and can be progressively hand-refined without
  ever being clobbered.
- **Pluggable everywhere** — rule engine, orchestration substrate, persistence, identity
  broker, and authorization are behind SPIs with batteries-included defaults.
- **Independently scalable** — a modular monolith by default whose async-first module
  boundaries let any part be split into its own service later.
- **Deeply auditable** — every case carries a first-class **DecisionRecord** that can explain
  itself to a human, an auditor, or an agent.
- **AI-native at build time *and* run time** — purpose-built so Claude Code and peer agents
  are productive authoring the system and operating the running one.

## 2. Why now — the AI-native inflection

Frameworks are shaped by who their primary author is. A framework designed in 2010 optimized
for a human developer with an IDE. ichiflow is designed for a **human domain expert paired
with an AI coding agent**, and that changes the substrate choices, not just the tooling:

- **Declarative, schema-validated artifacts beat free-form code for agents.** An LLM authoring
  a schema-constrained Flow document or a DMN decision table produces something that can be
  validated, diffed, and rejected deterministically — unlike hand-written orchestration code
  ([`../research/02-workflow-orchestration.md`](../research/02-workflow-orchestration.md) §2).
- **The "why" store is the debugging API.** Because the framework already models decision
  provenance as a typed object, an agent debugs by *querying structured lineage*, not by
  grepping logs ([`../research/07-ai-native-operations.md`](../research/07-ai-native-operations.md) §0.2).
- **Determinism makes agent action real rather than speculative.** An event-sourced decision
  core plus replay means an agent's hypothesis is *testable* against a reconstructed case, not
  a guess ([`../research/07-ai-native-operations.md`](../research/07-ai-native-operations.md) §0.5).
- **Migration is now assistable.** Brownfield mapping, rule mining, and parity testing — the
  work that historically made enterprise adoption a multi-quarter consulting engagement — is
  exactly the shape of work an agent does well *when bounded by deterministic tools and
  human approval* ([`../research/06-migration-and-onboarding.md`](../research/06-migration-and-onboarding.md) §A.0).

The bet is not "add an AI assistant to a workflow tool." It is: **the primitives that make a
system legible and safe for an AI agent — typed schemas, declarative artifacts, decision
provenance, deterministic replay, non-human identities with least privilege — are the same
primitives that make it legible and safe for auditors, ops engineers, and future maintainers.**
AI-native and enterprise-grade point the same direction.

## 3. Personas — and what each one gets

| Persona | What they do in ichiflow | What ichiflow gives them |
|---|---|---|
| **Business domain user** | Maps their domain; authors and tests Decisions with AI assistance | DMN decision tables + FEEL and a governance/simulation layer (versioning, approval, what-if) that Drools alone lacks (see [`../research/01-rule-engines.md`](../research/01-rule-engines.md) §6) |
| **UX designer** | Refines the auto-generated UI with a first-party toolchain | The **Design Kit**: a schema-driven design-token pipeline, a component workbench (every renderer state, including PDP hidden/read-only states), a live playground that renders real screens against mocked schema data, and a preview-and-safety report per change — on top of the JSON Forms model where uischema + design tokens are versioned artifacts the scaffold never overwrites (see [`07-ui-and-portals.md`](07-ui-and-portals.md), [`../research/03-schema-and-types.md`](../research/03-schema-and-types.md)) |
| **Application developer** | Assembles Schemas, Decisions, Flows, Adapters into an application | One schema source generating Kotlin + TypeScript types and runtime validators; a modular monolith that runs on a laptop |
| **Platform / ops engineer** | Deploys, scales, and separates zones | Helm/operator, air-gap bundle, DMZ/intranet split, per-module scaling, OpenTelemetry across both runtimes |
| **Auditor / compliance officer** | Answers "why was this decided this way, as of when?" | The DecisionRecord and the "why" API — one causal chain, bitemporally queryable (see [`../research/05-audit-observability-deployment.md`](../research/05-audit-observability-deployment.md) §1) |
| **AI coding agent** | Authors artifacts (build time) and operates the live system (run time) | An in-repo agent kit (`AGENTS.md`, `.claude/`) and the `ichiflow-mcp` runtime server with three enforced guardrail tiers (see [`../research/07-ai-native-operations.md`](../research/07-ai-native-operations.md)) |
| **End customer** | Submits work; tracks its progress | A generated customer Portal in the DMZ with its own IdP and entitlements |

## 4. Design principles (named, memorable, binding)

Each principle is a decision filter. When a design choice is unclear, the choice that upholds
more of these wins. They restate the [BRIEF](BRIEF.md)'s locked decisions as values.

### "Declare, don't code."
Control-flow graphs (Flows), rule matrices (Decisions), structural field-mappings (Adapters),
closed governed vocabularies, and boundary-crossing type contracts are **typed, versioned,
schema'd artifacts** a runtime interprets — because for these shapes the declarative artifact *is*
the shared analyst/auditor artifact and its diff shows the change directly. But "declare, don't
code" is a rule about **which shapes go declarative — not a claim that code is always the lesser
choice.** Computation — data reshaping between Flow steps, feature-prep before a rule evaluates,
enrichment in an adapter — is *more* legible as idiomatic typed Kotlin/TS with a unit test than as
sprawling YAML/FEEL, so it belongs in code. What keeps that code safe is not the authoring format
but the **audit spine**: every code extension is schema'd at its boundary and trace-emitting, so it
lands in the DecisionRecord like any declarative step (see the diff-test principle below, and
[`03-decision-layer.md`](03-decision-layer.md) §2.4,
[`04-flow-and-case-layer.md`](04-flow-and-case-layer.md) §2.3,
[`05-adapters.md`](05-adapters.md) §1). Declarative artifacts are diffable, validatable, and
AI-authorable; code earns its place where the work is genuinely computation. (Adapters/auth:
[`../research/04-adapters-and-auth.md`](../research/04-adapters-and-auth.md).)

### "The diff test — and the audit spine is not the authoring format."
The litmus for any change, declarative or code: *can a reviewer — human OR agent — reading only the
PR diff answer (a) WHAT the system will now do differently, and (b) WHY (against which rule /
contract / policy), without running the code or loading extra context?* Two properties satisfy it:
**WHAT-legibility** (the behavioral effect is visible in the diff) and **WHY-traceability** (the
change references a governed artifact — a CodeSet `@version`, a DecisionModel, a schema version — so
the reviewer can locate the authority). Crucially, **auditability lives in the trace / DecisionRecord
spine and the schema'd boundary, not in whether the artifact is YAML or Kotlin.** A declarative
artifact passes the diff test while it stays declarative (a graph of named steps, a table of rules)
and *fails* it once it encodes computation; typed code passes it when the code is schema'd at its
boundary and emits a trace. This is why moving computation to code costs legibility-for-analysts but
**not** auditability.

### "One schema, many types — no drift."
There is a single canonical model (authored in TypeSpec; emitted OpenAPI 3.1 / JSON Schema
2020-12 / AsyncAPI 3.1 as the checked-in contract of record). Kotlin types, TypeScript types,
runtime validators on both sides of every boundary, generated forms, and docs all derive from
it. CI fails on divergence. Nothing downstream depends on the authoring tool, so any tool can
be swapped. The canonical schema is required for types that **cross a governed boundary** — where a
second, independently-deployed or independently-versioned consumer reads them; a module-internal
shape with a single language and a single consumer stays a native Kotlin `data class` / TS
`interface` (the boundary-crossing test, [`02-schema-foundation.md`](02-schema-foundation.md) §1.1),
so schema is not forced where it only adds ceremony. (Schema:
[`../research/03-schema-and-types.md`](../research/03-schema-and-types.md).)

### "API-first; UI auto-generated but never clobbered."
The contract is complete and useful with zero UI. The UI is derived from the same schemas via
the JSON Forms model (independent data schema + uischema). Designer overrides live *outside*
the generated artifacts and survive regeneration; scaffolding never overwrites hand work; CI
lints uischema scopes against the data schema.

### "AI proposes, deterministic tools and humans dispose."
Every Copilot (Domain Modeling, Migration, Rule Authoring) is an *assistant over deterministic
tools*, never a code generator writing to production. The LLM proposes; a deterministic tool
plans/lints/validates (Atlas/pgroll for migrations, DMN validators for rules, oasdiff for
contracts); a human approves; a harness verifies. Provenance is recorded for every proposal. (The
Copilots themselves are **post-v1**; in v1 their inputs are authored as plain declarative data under
the doctrine below — [`03-decision-layer.md`](03-decision-layer.md), ADR-0017.)

### "Chat to author, preview to judge."
Every persona — business user, designer, developer — authors the **same way**: the AI writes the
artifact from a **conversation**, and the human steers in chat and judges via **live preview**. There
is **no drag-and-drop or visual-builder canvas** anywhere. Previews — flow diagrams, decision-table
views, rendered screens, simulation/what-if results — are **read-only projections rendered *from* the
canonical artifacts**, never a second editable representation that could drift from them. The approval
surface is the **diff (AI-explained in plain language) + preview/simulation** pair. Direct editing of
the canonical artifact stays available to developers (it is text under version control). This is the
same "AI proposes; humans dispose" contract, stated as the interaction model (ADR-0019).

### "Every decision can explain itself."
Provenance is a first-class **DecisionRecord** domain object, not a logging side effect. It
stitches workflow event history + fired-rule traces + DMN results + human review + AI-agent
actions into one causal chain keyed by `case_id`, queryable via the "why" API, answerable
*as-of* the decision time. If a step cannot be reconstructed, it is a bug.

### "Map first, migrate last."
Adoption never begins with "alter your production schema." A declarative schema-mapping / ACL
layer projects the legacy database onto the canonical model with zero or additive-only DDL
(Ring 0). Coexistence via CDC + outbox + strangler is Ring 1; assisted structural migration is
Ring 2, always opt-in and behind guardrails.

### "Migration out is as supported as migration in."
The framework is a home, not a trap. Everything is exportable in neutral formats — Decisions
as DMN, Flows as the JSON/YAML DSL, Schemas as OpenAPI/JSON Schema, data via standard dumps.
Lock-in is treated as a design defect. This is why the canonical rule format is DMN and the
canonical flow format is CNCF-Serverless-Workflow-aligned, not any engine's native format.

### "Pluggable by SPI, batteries included."
Rule engine, orchestration, persistence, identity broker, and authorization are all behind
SPIs — but every SPI ships a supported default (Apache KIE/Drools, Temporal, PostgreSQL,
Keycloak, OpenFGA). A newcomer is productive with zero plugin choices; an enterprise
can swap any layer without forking. (**v1 authz is OpenFGA only**; Cedar/OPA ABAC is a post-v1 /
Enterprise add-on behind the same PDP interface — ADR-0010, ADR-0017.)

### "Same code from laptop to zoned HA."
There is one application codebase. The Dev tier (single binary, embedded store), Team tier
(compose/small K8s, Postgres), and Enterprise tier (HA, DMZ/intranet zones, SSO, the compliance
profile) differ by **configuration only**. Tiers are **technical capability profiles, not commercial
editions** — every tier is the one open-source build. What you debug on a laptop is what runs in
production.

### "Fully open source; no gated features."
ichiflow ships **entirely under Apache-2.0/MIT — all of it**, including everything the docs call
"enterprise" or "compliance." There is **no open-core split, no source-available tier, no paywalled
capability**: the compliance profile is an open-source optional install, not a paid pack. Any future
monetization is **support / hosting / services**, never gated features. This is the natural extension
of the licensing-hygiene stance (ADR-0016) from "don't embed lock-in" to "don't *be* lock-in"
(ADR-0022).

### "Prefer proven open source."
When a **mature open-source component exists for a non-differentiating concern, integrate it rather
than build it.** Business intelligence, the identity provider, and observability backends are the
exemplars — ichiflow embeds proven OSS (Metabase/Superset-class BI, Keycloak, any OTLP backend)
rather than reinventing them. What ichiflow *does* build is the **differentiators**: decision
governance, the DecisionRecord, the Flow DSL, and the Copilots. The test for "build vs. integrate" is
whether the concern is where ichiflow's value actually lives (ADR-0021).

### "Async-first boundaries; split later."
The default topology is a modular monolith, but module boundaries are async-first from day one,
so any module can be promoted to an independently scalable service without a rewrite. You do
not pay the distributed-systems tax until you need to.

### "Agents are identities, not exceptions."
An AI agent is a **first-class non-human identity** under the same identity and authorization
model as a human — with JIT-scoped, short-lived credentials, a human owner, a kill switch, and
per-action audit. Agent capabilities are gated by three **server-enforced** guardrail tiers
(read-only / sandbox-mutating / prod-mutating-with-approval); client-side hints are never the
enforcement boundary.

## 5. Goals

- **G1** — Collapse the enterprise-app skeleton (back-office + customer UI + decisions + flows
  + manual review + audit) into declared, framework-provided modules.
- **G2** — Make AI coding agents first-class at build time and run time, safely.
- **G3** — Zero-drift type safety across Kotlin and TypeScript from one schema source.
- **G4** — Turnkey decision governance and explainability that approaches IBM ODM's Decision
  Center on open substrates.
- **G5** — Brownfield adoption without a precondition schema migration; parity-tested cutover.
- **G6** — No lock-in: full export of every artifact class; DMN and portable DSLs as canonical.
- **G7** — One codebase from laptop to zoned, air-gapped HA; self-hostable end to end.
- **G8** — Deep, bitemporal auditability sufficient for regulated decisioning (FCRA/ECOA/GDPR
  Art. 22-class requirements).

## 5.1 Phasing overview — v1 kernel · v1-optional · post-v1

Not everything ships at once. ichiflow has an explicit, ruthless **v1 kernel**, a **v1-optional** ring
(ships, off by default, behind SPIs), and a **post-v1** ring (ADR-0017). Each deep-dive doc carries a
phasing table aligned to this overview.

- **v1 kernel** — the schema core (TypeSpec→OpenAPI/JSON Schema) · Decisions (DMN/Drools behind the
  SPI) · Flows/Cases (interpreter, human-task/SLA/escalation) · the **domain entity store**
  (ADR-0018) · **one Portal** archetype (back-office) · **basic Adapters** (native REST, one message
  broker, webhook) · DecisionRecord / *why* API · the Dev tier. Governance defaults **off** at Dev.
- **v1-optional** — ships but off by default, behind SPIs: Apicurio registry, Keycloak broker,
  Cedar/OPA ABAC layer, Camel-on-Quarkus heavy adapters, Debezium CDC, immudb ledger.
- **post-v1** — GoRules ZEN second engine, Zitadel, self-service SSO/SCIM, Atlas/pgroll Ring-2, all
  **Copilots** (Domain Modeling, Migration, Rule Authoring, UI/Design — Ring-0 mapping ships as
  declarative data without the Copilot), MCP Tier-2 prod-mutating, and the **compliance profile**
  (an open-source, optional install — OpenLineage/BCBS-239 lineage, wide-event store, trigger-based
  bitemporal history), plus **BI reporting via embedded OSS BI over governed read models**
  ([`08-audit-and-observability.md`](08-audit-and-observability.md) Part 7; ADR-0021).

**Governance scales with tier, not by fiat:** the governance-level dial defaults to **off** (Dev),
**light** (Team), **full** (Enterprise) — ADR-0017, [`03-decision-layer.md`](03-decision-layer.md)
§5.6.

**v1 acceptance test — two real exercises, both required.** The v1 milestone is not a feature
checklist; **v1 is accepted only when *both* of these pass on the actual kernel** (ADR-0017 amendment):

1. **The reference product, end-to-end.** The canonical outdoor-event-permit product
   ([`../examples/creating-a-permit-product.md`](../examples/creating-a-permit-product.md)) runs with
   **every layer real** — schemas → decisions → flows → portal → audit → `ichiflow-mcp` debug — not
   mocked or stubbed: a permit application flows arrival-to-resolution and an agent debugs a stuck case
   through the *why* API.
2. **The migration exercise — in *and* out.** A realistic legacy source (a generic
   database-and-spreadsheet permitting/casework system with existing data and rules — **no real system
   named**) goes through the brownfield path: **Ring 0 declarative mapping** over the existing database
   (zero/additive DDL), legacy rules **re-expressed as DecisionModels**, and **decision-parity testing**
   against a **golden dataset of historical outcomes** ([`11-migration-in-and-out.md`](11-migration-in-and-out.md)).
   The **exit story** is verified on the same Workspace: export DMN / Flow JSON / schemas / data and
   demonstrate they are consumable outside ichiflow. Anti-lock-in is a core promise, so **migration in
   and out are both on the acceptance bar.**

## 6. Non-goals (explicit)

- **Not a general-purpose PaaS or app builder.** ichiflow is opinionated about the enterprise-
  workflow shape; it is not a substitute for a web framework or a drag-and-drop app platform
  for arbitrary CRUD apps.
- **Not a hosted-only SaaS.** Self-hosted enterprise is the first-class target; a managed
  offering, if any, comes later and never becomes the only path.
- **Not a new rule language or a new orchestration engine.** ichiflow standardizes on DMN/FEEL
  and builds on Temporal; it does not invent a proprietary engine to lock users into.
- **Not a BPMN modeling tool.** Flows are a declarative DSL interpreted on Temporal, not BPMN
  diagrams; BPMN interchange is at most an import/export concern, not the authoring surface.
- **Not "AI decides."** Copilots propose and explain; they never hold unilateral authority over
  production data or over a business Decision's outcome. Determinism and human approval are the
  spine.
- **Not exactly-once magic.** The framework designs for at-least-once + idempotent consumers +
  transactional outbox, and treats exactly-once as something emulated, never relied upon across
  heterogeneous brokers.
- **Not a fixed database vendor.** PostgreSQL-first, but audit/search/analytics are behind
  storage SPIs; ichiflow does not assume one warehouse or ledger.
- **Not a low-code black box.** Declarative does not mean opaque: every artifact is human- and
  agent-legible text under version control.
- **Not a visual/drag-and-drop authoring tool.** There is no visual-builder canvas for flows,
  decisions, or screens. Authoring is AI-chat-first; previews are read-only projections of the
  canonical artifacts, and developers edit those artifacts directly ("Chat to author, preview to
  judge"; ADR-0019).

## 7. Positioning — one honest paragraph each

These are grounded in the research, not in marketing. ichiflow does not claim to dominate these
tools on their home turf; it claims a different center of gravity.

### vs. IBM ODM / FICO Blaze (enterprise BRMS)
ODM is the governance benchmark: its **Decision Center** — a business-user rule repository with
versioning, permissions, approval workflows, released baselines, and analyst-run simulation —
is a capability the open Drools stack does not match, and its RETE engine and business-readable
BAL are genuinely strong ([`../research/01-rule-engines.md`](../research/01-rule-engines.md)
§3.2, §6). ichiflow's honest position: it **must build a governance/simulation layer that
approaches Decision Center** (this is explicitly the hardest gap to close), while beating ODM on
the axes ODM is weakest — open licensing, DMN L3 interchange, cloud-native footprint,
AI-friendliness (readable DMN/FEEL vs opaque BOM/XOM), and above all **migration out**. ODM's
lock-in is real: there is no clean lossless export from BAL/XOM to any neutral format, so getting
rules *out* means rule mining and re-expression. ichiflow treats ODM and Blaze primarily as
**migration-IN sources** and as **feature benchmarks**, not as engines to embed.

### vs. Camunda (BPM / process orchestration)
Camunda 8/Zeebe is technically strong and horizontally scalable, and its BPMN diagram is a
genuine shared artifact between analysts and engineers with a turnkey human-task Tasklist
([`../research/02-workflow-orchestration.md`](../research/02-workflow-orchestration.md) §3).
ichiflow declines to embed it for two grounded reasons: **licensing** — since v8.6 (Oct 2024)
production self-managed use requires a paid Camunda Enterprise license, which would make every
ichiflow adopter liable for Camunda's terms, an unacceptable coupling for a self-hostable
framework — and **authoring model** — BPMN XML is verbose, positional, and error-prone for LLMs
to author and validate, against ichiflow's AI-native grain. ichiflow instead layers a schema'd,
CNCF-Serverless-Workflow-aligned Flow DSL on **Temporal** (MIT-licensed durable execution),
capturing BPMN's comprehension and interchange benefits via a portable, diffable DSL while
keeping durable-execution and replay-as-audit underneath. Camunda 7 is community-EOL (Oct 2025)
and not a green-field option. Where a buyer values turnkey BPMN interchange above all, Flowable
(Apache-2.0) is the honest alternative — but it is not ichiflow's grain.

### vs. Retool / Appsmith / low-code internal-tool builders
Retool-class tools are excellent at *fast internal CRUD UIs over a database or API*, and they
are a real yardstick for ichiflow's generated back-office Portals. But they solve a different
problem: they generate an app-shaped bundle of JSON with **no semantic separation between data
schema and UI schema**, they re-scaffold (clobbering hand work), they carry no decision engine,
no durable orchestration, no case/manual-review model, and no audit/provenance spine — and
Retool in 2026 is commercial-only, not embeddable as a framework substrate
([`../research/03-schema-and-types.md`](../research/03-schema-and-types.md) §3). ichiflow's UI
is a *consequence* of the schema and the authorization model, not the product: the same PDP that
guards the API guards the generated UI down to field and row level, and the UI is one output of
a system whose center is Decisions, Flows, Cases, and DecisionRecords. ichiflow is not competing
to build a dashboard faster; it is building the regulated system of record the dashboard is a
window onto.

---

## Open questions

- **How close to Decision Center must v1 get?** The governance/simulation layer is the hardest
  and most differentiating build. What is the minimum viable governance surface for v1 vs later?
  The **governance-level dial** (off/light/standard/full) in
  [`03-decision-layer.md`](03-decision-layer.md) §5.6 answers this: governance ceremony scales with
  tier, and the **defaults are now decided — Dev=off, Team=light, Enterprise=full** (ADR-0017). The
  residual question is only *how close the `full` surface gets to Decision Center*, not the dial.
- **Second rule engine timing.** DMN is canonical and Drools is the reference engine; when does
  the GoRules ZEN (TS/edge) engine become a supported tier rather than a planned one?
- **Managed offering.** Non-goal for now — and constrained by the fully-open-source stance
  (ADR-0022): any future revenue is **support / hosting / services over the same open build**, never
  gated features, so a managed control plane could only ever be a convenience, not a feature paywall.
  The boundary between "self-hosted framework" and any such hosted convenience still needs an explicit
  line before it blurs.
- **BAL-like authoring.** Whether ichiflow ships a controlled-natural-language authoring surface
  that compiles to DMN, or standardizes on DMN decision tables + FEEL only, is undecided.
