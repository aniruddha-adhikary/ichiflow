# 12 — System Map & v1 Human Surfaces

## What this covers

Two things, in one place. **(1) A surface assessment** — a complete inventory of *every*
human-facing surface across these architecture docs, each classified by whether v1 **builds** it,
serves it **LLM-only** (chat / CLI / `ichiflow-mcp` + read-only preview), inherits it from an
**integrated third-party** component, or defers it to a **post-v1 builder** surface. **(2) A system
map** — Mermaid diagrams of every runtime component grouped by deployability unit with every swap
point marked, and of which persona touches which surface in v1.

The organizing decision this doc records (ADR-0024): **v1 keeps its human-built UI surface to the
generated end-user Portals only** — the customer-facing forms/status and the back-office manual-review
inbox, because *generating those is the product*. **Every internal / operator / builder / admin
surface is served LLM-first in v1**: Claude Code + `ichiflow-mcp` + the `ichiflow` CLI + chat, with
live previews as **read-only rendered artifacts** (an `ichiflow preview` dev-server URL, not an
interactive app). This is both a *prove-it-fast* posture (minimize human-built UI to validate the
framework cheaply) and an LLM-first bet. The **capability** to add builder-style surfaces later is
preserved by construction: the underlying typed APIs and MCP tools **are** the seam, so a post-v1 UI
is just another client of a contract v1 already ships.

## Position in the system

This is the phasing companion to [`07-ui-and-portals.md`](07-ui-and-portals.md) (which owns the
*mechanism* of every surface) and [`10-ai-native-experience.md`](10-ai-native-experience.md) (which
owns the LLM path — the agent kit, `ichiflow-mcp`, guardrail tiers). It sits atop
[`01-system-overview.md`](01-system-overview.md)'s module map and realizes the authoring doctrine of
[`00-vision-and-principles.md`](00-vision-and-principles.md) ("Chat to author, preview to judge") and
ADR-0019. It changes **only the v1 phasing of *surfaces*** — every seam, contract, SPI, and MCP tool
the other docs describe is unchanged and remains v1. Cross-refs by layer:
[`03-decision-layer.md`](03-decision-layer.md) (Decision governance/authoring/simulation surfaces),
[`04-flow-and-case-layer.md`](04-flow-and-case-layer.md) (Case, Task, manual review),
[`05-adapters.md`](05-adapters.md) (declared ports),
[`06-identity-and-access.md`](06-identity-and-access.md) (PDP, IdP broker, admin surfaces),
[`08-audit-and-observability.md`](08-audit-and-observability.md) (why API, dashboards, BI),
[`09-deployment-and-topology.md`](09-deployment-and-topology.md) (tiers, zones, substrates). Target
design, present tense; v1 vs post-v1 marked throughout.

Governing decisions: [`BRIEF.md`](BRIEF.md) locked decisions §6 (UI generation), §12 (AI-native
surfaces), §17 (prefer proven open source), §18 (production-access posture dial), and the new
**decision #19** (LLM-only internal surfaces for v1). ADRs: **0024** (this decision), 0019 (authoring
doctrine), 0015 (`ichiflow-mcp` + agent kit), 0017 (v1 kernel), 0021 (OSS BI), 0020 (posture dial).

---

## 1. The rule that classifies every surface

Two questions decide the class of any human-facing surface:

1. **Is the surface itself the product output** — a screen a member of the public, a partner, or an
   operational caseworker uses to *do the domain work* the application exists for? If yes, ichiflow
   **generates** it, and generating it is the point. → **class (A)**.
2. **Is the surface an internal / builder / operator / admin control** that a developer, designer,
   business author, ops engineer, or auditor uses to *build, govern, or operate* the system? If yes,
   its **v1 form is LLM interaction** — chat + CLI + `ichiflow-mcp` + a read-only `ichiflow preview`
   artifact — not a human-built app. → **class (B)**. If a mature OSS component already provides it,
   ichiflow **integrates** rather than builds → **class (C)**. A richer human app for a (B) surface
   may arrive **post-v1** → **class (D)**, and the (B) contract is the seam that lets it.

The distinction inside the back-office is the one to get right: a **caseworker doing manual review**
(open case, read the decision trace, approve/refer, fulfil an obligation) is an *end user of the
generated product* → (A). A **support/ops operator re-driving a stuck Case** (retry an adapter, replay
a workflow, reassign, patch data) is *operating the system* → (B), served by the same `ichiflow-mcp`
Tier-2 actuators an agent uses.

---

## 2. TASK 1 — Surface assessment

### 2.A — v1 BUILT UI (generated Portals only)

These are the only human surfaces v1 **builds**. Each is a generated Portal screen
([`07-ui-and-portals.md`](07-ui-and-portals.md) §5, §7, §8) over the JSON Forms model, guarded
field/row-level by the same PDP as the API. **Why each cannot be chat:** the user is an *end user of
the product*, not a builder — a member of the public or a caseworker processing work at volume — for
whom a chat/agent surface is neither available (external, un-credentialed) nor appropriate (repetitive,
high-throughput operational work); and *generating these Portals is the framework's product*, so they
are also the v1 acceptance deliverable ([`00-vision-and-principles.md`](00-vision-and-principles.md)
§5.1: reference product end-to-end, manual review real).

| # | Surface | Who uses it | Defined in | Why it cannot be chat (v1 = built) |
|---|---|---|---|---|
| **A1** | **Customer Portal** — application forms + the customer-safe **status model** (submitted / delayed / needs-attention / error, with next-step messaging) | End customer (public, external, un-credentialed for agents) | 07 §7.2, §8; 01 §4a; 00 §3 | External public users have no Claude Code / MCP access; submitting and tracking a case *is* the product. A chat surface for the general public is neither deployable in the DMZ nor desirable. |
| **A2** | **Partner Portal** — B2B intake + status, own IdP (SAML / brought-own) | External B2B partner staff | 07 §8 | Same as A1: external audience, own IdP realm, product-output intake surface; not an internal builder surface. |
| **A3** | **Back-office Task inbox** — generated list over the Task schema, PDP-filtered, SLA-ordered | Operational caseworker / reviewer (staff, high volume) | 07 §5, §7; 04 (Task, manual review) | Manual review is repetitive, high-throughput, product-defining work by a non-technical operator; it is the **(b) manual-review** half of the v1 acceptance test. A caseworker triaging a queue all day needs a purpose-built inbox, not a conversation per case. |
| **A4** | **Back-office Case / review view** — case detail, decision-trace view, action form (submit *signals* the Flow), obligation/condition checklist, permitted case operations (amend / cancel / withdraw / appeal) | Operational caseworker / reviewer | 07 §7, §7.1; 04 §5.5–§5.6 | The reviewer's judgement surface for the actual domain decision; product output and acceptance-critical. The embedded DecisionRecord/why rendering here is part of the generated product (distinct from the standalone auditor query surface, B8). |

Everything else below is **not** built in v1.

### 2.B — v1 LLM-ONLY (internal surfaces served by chat / CLI / MCP + read-only preview)

For each, the **v1 LLM path is stated exactly.** The surface's mechanism, contracts, and SPIs are
unchanged from the owning doc — only its *v1 human form* is LLM interaction plus a read-only rendered
artifact. Read-only preview means an `ichiflow preview` dev-server URL that **renders** the canonical
artifact (flow diagram, decision-table view, rendered screen, simulation trace) — a projection to
judge, never a second editable app (ADR-0019; 00 "Chat to author, preview to judge").

| # | Surface (as documented) | Who used it | Defined in | **v1 LLM path** |
|---|---|---|---|---|
| **B1** | **Human support / ops console** — the "human twin" of the MCP Tier-2 actuators (signal / retry / cancel / re-drive / reassign / patch) | Platform / ops engineer, support operator | 07 §7.2; 09 §6.3; 10 §3.2 | **`ichiflow-mcp` Tier-2 tools in Claude Code**, gated by JIT NHI + human approval + audit (10 §3.3), with the **why API** (Tier-0 `get_case_trace` / `explain_decision` / `list_stuck_cases`) as the read path. The operator drives re-drive/retry/reassign through chat; every call is audited to the DecisionRecord exactly as the console would have been. |
| **B2** | **Decision governance & approval surface** (Decision Center-class): versioning, approval workflows, reviewer assignment, released baselines, coverage | Business author, approver/reviewer, auditor | 03 §5.1–§5.2, §5.5, §6 | **PR review + chat approval.** Governance states (`draft→in-review→released→deprecated`) live in the Workspace git repo; approval = PR merge at `light`, or an approval-**Flow** whose Tasks are actioned via `ichiflow-mcp` at `full` (03 §5.6 dial). The approval record, diff, and simulation evidence land in the DecisionRecord as documented — via chat/PR, not a governance web app. |
| **B3** | **Business-user rule authoring UX** — decision-table view + what-if judging | Business domain user | 03 §5.3 | **Already the doctrine, kept as-is:** describe intent in chat → AI proposes DMN + FEEL → judge via a **read-only decision-table view** (dmn-js render, non-editable) + what-if simulation on an `ichiflow preview` URL → approve the diff. No table-editor canvas; no dedicated rule-authoring portal in v1. |
| **B4** | **Analyst simulation / scenario surface** — what-if, scenario specs, golden-dataset replay, coverage | Business author / analyst | 03 §5.4 | **CLI + MCP:** `ichiflow simulate` / `dry_run_rule` / `simulate_decision` and `run-parity-tests` produce a **read-only rendered trace + coverage report** (preview artifact). The judgement surface is the projection, driven from chat. |
| **B5** | **Design Kit live playground** — real screens over schema-driven mocks, token/audience toggles | UX designer | 07 §11.3, §14 | **`ichiflow preview` URL, chat-driven.** The designer describes intent in chat; the AI authors uischema/pageschema/tokens; the dev-server **renders the real screen read-only** (MSW-mocked, sample-Case fixtures). v1 ships the *rendered preview*, not an interactive playground app. |
| **B6** | **Design Kit component workbench** (Storybook-class): one story per renderer × state incl. PDP-hidden / PDP-read-only | UX designer | 07 §11.2 | **Rendered stories as a read-only `ichiflow preview` artifact**, generated from the real renderers + sample data + PDP verdicts; a11y/contrast checks run in CI and surface in the preview report. v1 builds no interactive Storybook-class app — the stories are a rendered gallery driven from chat. |
| **B7** | **Designer safety contract / preview-environment-per-change** — drift, a11y, contrast, i18n, PDP-state reports | UX designer, design lead | 07 §12 | **CI report + rendered preview.** The `contracts/ui`+`tokens` PR (same Workspace PR flow, 10 §2) spins the `ichiflow preview` and attaches the a11y/contrast/drift/i18n verdicts — a *screen + report*, judged from chat, not a bespoke design-review app. |
| **B8** | **Auditor "why" / DecisionRecord query surface** (standalone) | Auditor / compliance officer | 08 §1; 01 §4f; 00 §3 | **`ichiflow-mcp` why/case tools + `ichiflow` CLI:** `get_case_trace(case_id, as_of?)`, `explain_decision`, bitemporal as-of queries, returning the same DecisionRecord object the back-office view renders. In v1 the auditor's *dedicated* console is the query API through chat/CLI; the rendered why view inside the back-office Case view (A4) is the built one. |
| **B9** | **Admin / config surfaces** — Portal declarations, IdP broker config, entitlement (OpenFGA relationships / policies) authoring, self-service SSO/SCIM onboarding | Platform/ops engineer, developer, (future) customer IT admin | 06 §2.3, §5 (self-service SSO, post-v1); 07 §8 (Portal declaration) | **Declarative artifacts authored via chat + PR.** A Portal, a broker realm, an Entitlement, an SSO connection are **versioned Workspace artifacts** (YAML/policy), AI-authored and human-approved as a PR — "declare, don't code." No admin web console in v1; the self-service SSO *embeddable admin flow* remains post-v1 (06). |

**Note on Copilots.** The Domain Modeling / Migration / Rule Authoring / UI-Design **Copilots are
already post-v1** (10 §7, ADR-0017). Their **v1 form is exactly the (B) chat doctrine above** — the
same AI-proposes / human-judges loop, unpackaged. The *packaged Copilot UX* is a post-v1 builder
surface (D4).

### 2.C — THIRD-PARTY / UNAFFECTED (integrated OSS we do not build)

These surfaces exist but ichiflow **integrates** them (locked decision §17; "prefer proven open
source"); the LLM-only decision does not touch them because we never built them. Several are also
post-v1 to *adopt*, but the point here is *we don't build the UI either way*.

| # | Surface | Who uses it | Defined in | Component |
|---|---|---|---|---|
| **C1** | **Embedded BI dashboards** (counts, cycle times, breach/decision stats) over governed read models | Business, ops, auditor | 07 §5; 08 §4.4, Part 7; ADR-0021 | Metabase/Superset-class OSS, embedded in the back-office Portal, SSO via the broker, row/field-scoped by the same PDP. No custom report engine. (Adopt: post-v1.) |
| **C2** | **Observability dashboards / trace viewers** | Platform/ops engineer | 08 §4.1, §4.4; 09 §3.1 | OTel-native, **BYO backend** via OTLP (Grafana / Datadog / CloudWatch-X-Ray / Google Cloud Operations). Dev tier bundles a **minimal local OTel viewer** only; no proprietary store, no bundled Grafana-class stack. |
| **C3** | **Temporal Web UI** — workflow history / execution inspection | Platform/ops engineer | 09 §2.2, §3 (Temporal substrate) | Temporal's own web UI over the durable-execution substrate. ichiflow surfaces workflow history to agents via `get_workflow_history`, but the human web UI is Temporal's. |
| **C4** | **Keycloak admin console** — realms, IdP strategies, clients | Identity/ops admin | 06 §2; 09; BRIEF §7 | Keycloak's admin UI. ichiflow configures brokers as declared artifacts (B9) but the raw admin console is Keycloak's. |
| **C5** | **Apicurio registry UI** — schema/version browsing | Developer/ops | 09 §3.1 (Team+); BRIEF §5 | Apicurio's own UI (Team+; Dev uses file-based artifacts). |

*(OpenFGA is a substrate with no first-party human console in scope; its store is driven by
declared entitlement artifacts, B9.)*

### 2.D — POST-V1 BUILDER SURFACES (may get a real UI later; the seam keeps it possible)

Each is a (B) surface whose *richer human app* may be built after v1. **The seam that makes this a
phasing choice rather than a rewrite: the underlying typed API / MCP tool / PR flow that v1 already
ships IS the contract, and a post-v1 UI is just another client of it.** No (D) surface requires new
core capability — only a new front end over an existing contract. The same seam runs the *other* way
too: the MCP surface is not a closed shim but an **extension point** — an app built on ichiflow
registers its own schema'd domain tools into `ichiflow-mcp` through the **MCP tool-extension SPI**
(each declaring its guardrail tier, enforced server-side identically to first-party tools;
[`10-ai-native-experience.md`](10-ai-native-experience.md) §3.5), so both a later human UI *and* an
app's own agent tooling are additive clients/extensions of a v1 contract, never a fork (the "closed
core, declared extension points" doctrine, BRIEF §21).

| # | Post-v1 surface | v1 (B) form it graduates from | The seam (its already-shipped contract) |
|---|---|---|---|
| **D1** | **Interactive designer playground + Storybook-class workbench apps** | B5, B6 (rendered `ichiflow preview`) | `contracts/ui`/`tokens` artifacts + the mock/preview build (07 §14) + drift/a11y CI — a UI is a new renderer of the same artifacts. |
| **D2** | **Decision governance console** (Decision Center-class approval UI) | B2 (PR/chat approval; git governance states) | Governance-state model + approval-Flow + DecisionRecord (03 §5) — a console is a client of the same state API and Task/approval Flow. |
| **D3** | **Human support / ops console** (back-office operator app) | B1 (`ichiflow-mcp` Tier-2 in Claude Code) | The **Tier-2 actuator API + why API** (10 §3.2–§3.3) — the console is the "human PEP" over the *same* actuators (07 §7.2 states this explicitly). |
| **D4** | **Packaged Copilots** (Domain Modeling / Migration / Rule Authoring / UI-Design) | B3, B4, B5 + the chat doctrine (10 §7) | The Copilot guardrail DNA + the artifact APIs they propose against — packaging, not new capability (ADR-0017). |
| **D5** | **Self-service SSO/SCIM onboarding admin** (embeddable customer-IT flow) | B9 (broker config as PR'd artifact) | Broker-config-as-versioned-artifact (06) — the admin flow writes the same artifact a PR does. |
| **D6** | **Business-user rule-authoring portal** (domain-owner self-serve, no agent) | B3 (chat + decision-table preview) | DMN authoring + simulation + governance APIs (03) — a portal is a non-agent client of the same author/simulate/approve loop. |

---

## 3. Honest v1 UX costs (accepted tradeoffs, with revisit triggers)

Chat-only for internal surfaces is a real cost for some personas. Stated plainly, each with the
**trigger** that should reopen the decision:

- **The business/domain owner ("permits-manager" persona) tweaking rules has no dedicated portal.**
  In v1 they work through **chat + a read-only decision-table/simulation preview URL** (B3). A
  non-technical domain owner who is uncomfortable in a chat/CLI loop, or who cannot run Claude Code,
  is **dependent on an agent or developer intermediary** for rule changes.
  **Accepted for v1** (prove-it-fast; the reference product's rule authoring is exercised via chat).
  **Trigger to build D6:** a non-technical domain owner must self-serve routine rule/threshold changes
  at scale *without* an agent in the loop, evidenced in the reference-product exercise or a design
  partner.

- **The support/ops operator has no console — they operate through Claude Code + `ichiflow-mcp`
  (B1).** A support operator who is not comfortable with an agent-mediated Tier-2 flow pays a
  learning cost, and "the agent out-tools the human" (07 §7.2) is temporarily true for non-agent
  operators. **Accepted for v1.** **Trigger to build D3:** support/incident volume, or a non-technical
  operator population, makes chat-mediated re-drive/retry too slow or too error-prone.

- **The designer judges via a rendered preview, not an interactive workbench/playground app (B5,
  B6).** Rapid low-fi exploration works through chat + `ichiflow preview`, but there is no
  click-through component explorer in v1. **Accepted** (ADR-0019 already makes the playground
  read-only; this only defers the *interactive app* shell). **Trigger to build D1:** designer
  throughput or stakeholder-review needs exceed what a rendered gallery + chat can carry.

- **The auditor uses query tools, not a forensic console (B8).** As-of queries via CLI/MCP are
  complete but demand query literacy for standalone (non-back-office) forensic work. **Accepted.**
  **Trigger:** an auditor persona without CLI/agent access is a hard requirement of a regulated design
  partner.

- **Governance approval is PR/chat, not a governance app (B2).** Fine at `off`/`light`; at `full`
  the approval-Flow is actioned through `ichiflow-mcp` rather than an approval inbox UI. **Accepted;
  aligned with the governance dial** (03 §5.6). **Trigger to build D2:** an Enterprise adopter running
  `full` governance needs a non-agent approver population.

The unifying point: **none of these tradeoffs removes a capability** — the API/MCP/PR contract is
present in v1. They defer the *human front end*, and the seam (§2.D) keeps the front end a later,
additive build.

---

## 4. TASK 2 — System map

### 4.1 Component map — deployability units and swap points

Every runtime component, grouped by what ships together in the default **modular monolith**
([`09-deployment-and-topology.md`](09-deployment-and-topology.md) §2), what splits out later, and
what is an **external substrate**. Swap points carry the consistent marker **⟨SPI⟩** (a pluggable
seam: an SPI, a broker interface, or an adapter binding).

```mermaid
flowchart TB
  subgraph EDGE["Edge deployables (TS + JVM) — split 1st/2nd (09 §2.4)"]
    direction TB
    PORT["Portal + BFF (per audience)<br/>generated UI · splits 1st (DMZ)"]
    ADP["Adapter runtime ⟨SPI⟩<br/>declared ports: REST/MQ/JMS/Kafka/AMQP/<br/>file/SFTP/SOAP/webhook/CDC · splits 2nd"]
  end

  subgraph MONO["Core modular monolith — one deployable (Kotlin core + TS interpreter)"]
    direction TB
    BUS(["Canonical command/event bus<br/>(async-first module boundaries)"])
    FLOW["Flow core — interpreter workflow (TS)<br/>+ Case services (Kotlin)"]
    DEC["Decision core ⟨SPI⟩<br/>DMN via Decision Engine SPI<br/>(Drools default; ZEN post-v1)"]
    CASE["Task / Case management<br/>(manual review · SLA · escalation)"]
    AUD["Audit / why + DecisionRecord<br/>(append-only · bitemporal · case_id)"]
    IDP["Identity broker ⟨SPI⟩ + Central PDP ⟨SPI⟩<br/>(v1 OpenFGA; Cedar/OPA post-v1,<br/>same PDP interface)"]
    SCH["Schema authoring layer ⟨SPI⟩<br/>TypeSpec → OpenAPI/JSON Schema/AsyncAPI<br/>(authoring tool swappable)"]
    MCP["ichiflow-mcp (stateless facade)<br/>Tier-0/1/2 tools"]
  end

  subgraph SCALE["Split-out worker pools (same async contracts)"]
    direction TB
    REVAL["Rule-eval workers · split 3rd"]
    TW["Temporal Flow workers · split last"]
  end

  subgraph SUB["External substrates (not built by ichiflow)"]
    direction TB
    TMP[["Temporal<br/>(durable execution)"]]
    PG[("PostgreSQL + storage SPIs ⟨SPI⟩<br/>case / audit-ledger / read-model /<br/>search / analytics — each swappable")]
    KC[["Keycloak ⟨SPI⟩<br/>(IdP broker)"]]
    FGA[["OpenFGA<br/>(ReBAC store, PDP backend)"]]
    BRK[["Message broker ⟨SPI⟩<br/>(Kafka/AMQP/NATS — split/zone relay)"]]
    OTEL[["OTel backend ⟨SPI⟩<br/>(OTLP BYO: Grafana/Datadog/<br/>CloudWatch/GCO)"]]
    BI[["OSS BI ⟨SPI⟩<br/>(Metabase/Superset-class,<br/>embedded · post-v1)"]]
  end

  PORT -- events --> BUS
  ADP -- canonical cmd/evt --> BUS
  BUS --> FLOW --> DEC
  FLOW --> CASE
  FLOW --> AUD
  DEC --> AUD
  IDP -. guards .- PORT
  IDP -. guards .- ADP
  IDP -. guards .- MCP
  SCH -. contracts .-> BUS
  MCP --> AUD
  MCP --> FLOW

  DEC -. eval offload .-> REVAL
  FLOW -. worker pool .-> TW
  FLOW --> TMP
  TW --> TMP
  AUD --> PG
  CASE --> PG
  IDP --- KC
  IDP --- FGA
  BUS -. externalized .-> BRK
  AUD -. OTLP .-> OTEL
  AUD -. read models .-> BI
```

**Reading it.** The **core monolith** ships as one deployable; **Portals** split first (usually forced
by DMZ zone separation), **Adapter runtimes** second, **rule-eval workers** third, **Temporal
workers** last (09 §2.4). Everything marked **⟨SPI⟩** is a swap point with a batteries-included
default: Decision Engine SPI (Drools), the five **storage SPIs** on Postgres (case / audit-ledger /
read-model / search / analytics), the **IdP broker** (Keycloak), the **PDP interface** (OpenFGA v1;
Cedar/OPA behind the same interface post-v1), **adapter bindings** (declared ports), the
**observability backend** (OTLP BYO), the **BI tool** (embedded OSS), and the **schema authoring
layer** (TypeSpec, swappable because the emitted JSON Schema/OpenAPI is canonical). External
substrates — Temporal, Postgres, Keycloak, OpenFGA, broker, OTel backend, BI — are integrated, not
built.

### 4.2 Surfaces map — who touches what in v1

Color-coded by class. In v1 the **business user, designer, developer, ops engineer, and auditor
converge on Claude Code / chat + `ichiflow-mcp` + CLI + read-only preview**; only the **end customer /
partner** and the **caseworker** touch built UI; third-party consoles serve ops; (D) is dashed
(post-v1).

```mermaid
flowchart TB
  classDef built fill:#1f7a4d,stroke:#0d3d26,color:#fff;
  classDef llm fill:#2b5d99,stroke:#16304d,color:#fff;
  classDef third fill:#6b6f76,stroke:#33363b,color:#fff;
  classDef post fill:#8a6d1f,stroke:#4d3c0d,color:#fff,stroke-dasharray:5 3;

  CUST(["End customer"])
  PART(["B2B partner"])
  CASEW(["Caseworker / reviewer"])
  BIZ(["Business / domain user"])
  DES(["UX designer"])
  DEV(["Developer"])
  OPS(["Platform / ops engineer"])
  AUD(["Auditor / compliance"])
  AGENT(["AI coding agent"])

  CC{{"Claude Code + ichiflow-mcp<br/>+ ichiflow CLI + chat<br/>+ read-only ichiflow preview"}}

  A1["A1 Customer Portal<br/>(forms + status)"]:::built
  A2["A2 Partner Portal"]:::built
  A3["A3 Back-office Task inbox"]:::built
  A4["A4 Case / review view"]:::built

  B1["B1 support/ops → MCP Tier-2"]:::llm
  B2["B2 governance/approval → PR/chat"]:::llm
  B3["B3 rule authoring → chat+table view"]:::llm
  B4["B4 simulation → CLI/MCP+trace"]:::llm
  B5["B5 playground → preview URL"]:::llm
  B6["B6 workbench → rendered stories"]:::llm
  B7["B7 safety report → CI+preview"]:::llm
  B8["B8 auditor why → MCP/CLI"]:::llm
  B9["B9 admin/config → PR'd artifacts"]:::llm

  C1["C1 embedded BI"]:::third
  C2["C2 OTel dashboards"]:::third
  C3["C3 Temporal Web UI"]:::third
  C4["C4 Keycloak admin"]:::third
  C5["C5 Apicurio UI"]:::third

  D1["D1 playground/workbench apps"]:::post
  D2["D2 governance console"]:::post
  D3["D3 support/ops console"]:::post
  D4["D4 packaged Copilots"]:::post
  D5["D5 self-service SSO admin"]:::post
  D6["D6 rule-authoring portal"]:::post

  CUST --> A1
  PART --> A2
  CASEW --> A3
  CASEW --> A4

  BIZ --> CC
  DES --> CC
  DEV --> CC
  OPS --> CC
  AUD --> CC
  AGENT --> CC

  CC --> B1 & B2 & B3 & B4 & B5 & B6 & B7 & B8 & B9

  OPS --> C2 & C3 & C4 & C5
  BIZ --> C1
  AUD --> C1

  B1 -. post-v1 .-> D3
  B2 -. post-v1 .-> D2
  B3 -. post-v1 .-> D6
  B5 -. post-v1 .-> D1
  B6 -. post-v1 .-> D1
  B9 -. post-v1 .-> D5
  B3 -. post-v1 .-> D4
```

### 4.3 Deployability / zones

The DMZ/intranet zone split, the tier ladder (Dev/Team/Enterprise), and the independent-scalability
map are owned by [`09-deployment-and-topology.md`](09-deployment-and-topology.md) §3, §6, §7 and are
not re-drawn here. The surface phasing overlays cleanly on that topology: the **generated Portals
(A1–A4)** are the DMZ tenants that split first; the **LLM surfaces (B)** are Workspace/`ichiflow-mcp`
interactions against the intranet core through the why API and Tier-0/1/2 tools (the mediated
production-access paths of the posture dial, 09 §6.3 / ADR-0020); the **third-party consoles (C)** run
against their own substrates. No new zone or deployable is introduced by the LLM-only decision — it
*removes* internal web deployables from v1, if anything.

---

## 5. Count summary

| Class | Count | What |
|---|---|---|
| **(A) v1 BUILT UI** | **4** | Customer Portal, Partner Portal, Back-office Task inbox, Back-office Case/review view |
| **(B) v1 LLM-ONLY** | **9** | support/ops console, governance/approval, rule authoring, analyst simulation, designer playground, component workbench, designer safety report, auditor why-query, admin/config |
| **(C) THIRD-PARTY** | **5** | embedded BI, OTel dashboards, Temporal Web UI, Keycloak admin, Apicurio UI |
| **(D) POST-V1 BUILDER** | **6** | playground/workbench apps, governance console, support/ops console, packaged Copilots, self-service SSO admin, rule-authoring portal |

---

## 6. Packaging & placement doctrine

Section §1 classifies human **surfaces** (is a screen the product output, or an internal
control?). **This section classifies capability placement** — does a capability live in the kernel,
ship as a first-party optional component, sit behind an SPI with a thin default, or delegate to a
system the enterprise already runs? The two rules are **complementary**: one decides *who builds the
UI*, the other decides *where the capability lives*, and both hold the v1 kernel to its minimum. This
is the **living copy** of the doctrine recorded in
[`../adr/0033-packaging-and-placement.md`](../adr/0033-packaging-and-placement.md) (the source of
record); the classification table below is the map the doctrine maintains.

### 6.1 The placement decision tree

For each capability — or, more precisely, each **semantic within a capability** — ask in order:

- **(i) Does the audit spine depend on its semantics?** → **CORE**, hard-shipped. If the
  DecisionRecord, deterministic replay, `case_id` correlation, number/ledger allocation, or
  lifecycle/verification integrity depend on it, it cannot leave ichiflow (Document numbering +
  lifecycle + verification; `QuotaLedger` invariants; the Flow interpreter; the DecisionRecord
  itself).
- **(ii) Is it an ichiflow-differentiating capability?** → **FIRST-PARTY OPTIONAL COMPONENT**, shipped
  by ichiflow but installable/optional, not baked into the kernel. The differentiators ichiflow
  **builds** ([`BRIEF.md`](BRIEF.md) §17): decision governance, the Copilots, the Design Kit — and the
  *default* implementations of core SPIs where ichiflow's version is itself the selling point.
- **(iii) Is it a commodity with mature OSS?** → **SPI + THIN DEFAULT + integration guidance**. Ship a
  small, licensing-vetted default behind an SPI and document integrating the proven OSS (document
  rendering → Typst default; search → Postgres FTS; BI → embed Metabase/Superset).
- **(iv) Does the enterprise already own one?** → **DESIGNED EXTERNAL-DELEGATION PATH** (an Adapter or
  `external-task` seam). Provide a designed seam so an enterprise's existing platform owns the concern
  while ichiflow keeps the audit anchor (an enterprise CCM owning issuance; a corporate IdP federated
  in; an external finance system reached by `external-task`).

**This classifies a *semantic*, not a product area monolithically.** Most real capabilities are
**hybrid** across the tree — issuance is (i) numbering/lifecycle/verification **core** + (ii)/(iii)
rendering **component/SPI** + (iv) **delegated** full issuance; the audit-spine core is invariant
across placements, and only *who does the non-core part* moves. The doctrine's job is to keep the
**core minimal** (only what the audit spine depends on) and give everything else a **declared seam
with a delegation path** — the "closed core, declared extension points" rule ([`BRIEF.md`](BRIEF.md)
§21b) applied to packaging, and the generalization of ADR-0029's three issuance placement profiles.

### 6.2 The classification table

Each row places the capability **per semantic** (the primary quadrant in **bold**), its v1 default,
its external-delegation path, and — because this doc is the phasing map — its **v1 phasing**. It is the
capability-placement companion to the **⟨SPI⟩** swap points already marked on the §4.1 component map.
Placement is a **technical** call, never a paywall: every quadrant ships under Apache-2.0/MIT
([`../adr/0022-fully-open-source.md`](../adr/0022-fully-open-source.md)); and where a row reads
"post-v1," that is a **phasing** of the surface/adoption, not a change of placement
([`../adr/0024-llm-only-internal-surfaces-v1.md`](../adr/0024-llm-only-internal-surfaces-v1.md)).

| Capability | Placement (per semantic) | v1 default | External-delegation path | v1 phasing |
|---|---|---|---|---|
| **Document rendering** | render **(iii)** SPI; numbering/lifecycle/verification **(i)** core | Typst behind rendering SPI | delegated rendering / full issuance → enterprise CCM (ADR-0029) | **v1**: issuance core + Typst default; the delegation seam is designed, deep CCM integrations post-v1 |
| **Notifications** | delivery **(iii)** SPI; issuance-of-record **(i)** core when it *is* a Document | notification adapters (05 §4.2) | enterprise notification / CCM platform via outbound Adapter | **v1** |
| **BI / reporting** | **(iii)** embed OSS BI over **(i)** governed read models | Metabase/Superset-class over read-model projections (ADR-0021) | enterprise BI tool over the same governed read models | governed read models **v1**; embedded BI **adopted post-v1** (C1) |
| **Observability backend** | **(iii)/(iv)** OTel-native, BYO backend; no proprietary store | minimal local viewer (Dev); OTLP export (ADR-0011) | any OTLP backend (CloudWatch/GCO/Grafana/Datadog) | **v1** (OTLP export + Dev-tier local viewer) |
| **Identity broker** | **(iv)** broker per audience; propagation **(i)**-adjacent | Keycloak (ADR-0009) | federate the enterprise/agency corporate IdP upstream | **v1** |
| **AuthZ engine(s)** | **(i)** one PDP contract; engines **(iii)** behind it | OpenFGA only (ADR-0010) | Cedar/OPA ABAC behind the same PDP | OpenFGA **v1**; Cedar/OPA add-on **post-v1** |
| **Rule engine** | **(i)** DMN semantics + governance core; engine **(iii)** SPI | Apache KIE/Drools (ADR-0002) | any DMN-TCK-conformant engine via the Decision SPI | Drools **v1**; ZEN second engine **post-v1** |
| **Workflow substrate** | **(i)** interpreter + DecisionRecord core; execution **(iii)** on a substrate | Temporal (ADR-0003) | substrate is embedded, not delegated; Flows export CNCF-SWF | **v1** |
| **Entity storage** | **(i)** contracts + query/CRUD; store **(iii)** SPI | PostgreSQL-first (ADR-0018/0012) | OpenSearch-class search binding; DB behind the Repository SPI | **v1** |
| **Object storage** (Document binaries) | binary **(iii)** SPI; snapshot/hash **(i)** core | PG large-object / local FS (Dev/Team), S3-compatible (Ent) | any S3-compatible object store behind the SPI (02 §11) | **v1** |
| **Migration tooling** | **(ii)** differentiator (map-first, parity) built | Ring 0/1/2 + parity harness (ADR-0014) | Atlas / pgroll / Debezium integrated beneath the Copilot seam | rings + parity harness **v1**; Copilots **post-v1** (v1 authors mappings as plain declarative data) |
| **MCP surface** | **(i)** why/case/flow query APIs + tier enforcement core; **(ii)** the server | first-party `ichiflow-mcp`, 3 guardrail tiers (ADR-0015/0024) | MCP tool-extension SPI for org-specific tools | **v1** |

**Cross-refs.** Source of record:
[`../adr/0033-packaging-and-placement.md`](../adr/0033-packaging-and-placement.md). The doctrine
generalizes [`../adr/0029-document-issuance.md`](../adr/0029-document-issuance.md)'s three issuance
placement profiles (core numbering/lifecycle + component rendering + delegated issuance) to every
capability. Every quadrant is fully open source
([`../adr/0022-fully-open-source.md`](../adr/0022-fully-open-source.md) — placement is technical, never
a paywall), and the v1-phasing column reflects surface/adoption phasing
([`../adr/0024-llm-only-internal-surfaces-v1.md`](../adr/0024-llm-only-internal-surfaces-v1.md)), never
placement. **Relationship to §1:** that rule classifies human **surfaces**; this one classifies
**capability placement** — complementary lenses that both keep the v1 kernel minimal.

---

## Open questions

1. **`ichiflow preview` fidelity is now load-bearing for more personas.** With B5/B6/B7 collapsing to
   rendered previews and B3/B4 to rendered table/trace projections, projection-renderer fidelity
   carries even more weight than ADR-0019 already flagged. What is the minimum fidelity bar for the v1
   preview (flow diagram, decision-table, rendered screen, simulation trace) before a non-developer
   can safely judge with no interactive surface? Owned jointly with 07 §11 and 03 §5.3.
2. **Trigger thresholds for the (D) surfaces.** §3 names a qualitative trigger per surface; the
   concrete signal (design-partner requirement, operator headcount, governance tier, throughput) that
   *promotes* a (B) surface to a built (D) app needs a decision rule, mirroring the split-trigger
   question in 09 (Open questions §1).
3. **Non-agent operator floor.** The tradeoffs in §3 assume every internal persona can run Claude Code
   / the CLI. Which regulated adopters *forbid* agent tooling for an operator/approver/auditor role —
   forcing an earlier (D) build — is a design-partner question, not settled here.
4. **Governance `full` without an approval UI.** At the `full` governance level (03 §5.6) the
   approval-Flow is actioned through `ichiflow-mcp`; whether an agent-mediated approval satisfies a
   regulated approver-of-record requirement, or forces D2 earlier, interacts with Open question 3.
5. **Preview as an artifact vs. an app boundary.** The line between "read-only rendered preview
   (allowed in v1)" and "interactive app (deferred to D1)" needs a crisp test so the Design Kit build
   does not drift back into an app; the working definition — *renders canonical artifacts, no mutation,
   no client-side state beyond view toggles* — should be pinned in 07.
