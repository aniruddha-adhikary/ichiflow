# 07 — AI-Native Operations: Making Coding Agents First-Class at Build Time and Run Time

> Research brief for **ichiflow**, an AI-native enterprise workflow development framework.
> Scope: how ichiflow should make AI coding agents (Claude Code specifically) **first-class citizens**
> at both **build time** (authoring workflows, adapters, rules) and **run time** (stepping into a live
> system, inspecting state, debugging an incident end-to-end, and self-serving safe fixes).
> Motivating scenario: a Claude Code agent is paged for a stuck loan-approval case, opens the repo,
> queries the running system's decision trace, reproduces the failure deterministically, and proposes
> a fix — all through framework-shipped surfaces, under enterprise guardrails.
>
> **Author:** research agent · **Date:** 2026-07-12 · **Status:** draft for architecture review
> Cross-refs: builds on **05** (audit/observability — DecisionRecord, OTel, `case_id` correlation),
> **04** (adapters + non-human identity / pluggable auth), **02** (workflow orchestration), **01** (rules).

---

## 0. TL;DR / Cross-cutting recommendations

1. **Ship two agent surfaces, not one.** (a) A **build-time in-repo kit** (`.claude/` + `AGENTS.md`)
   so any agent that opens an ichiflow repo is productive in the first minute; (b) a **runtime MCP
   server** (`ichiflow-mcp`) that turns the running system's own audit/observability primitives (the
   DecisionRecord and workflow event history from doc 05) into typed, queryable agent tools. The MCP
   server is a *product feature*, versioned and supported like Temporal's, Grafana's, and Sentry's.

2. **The "why" API is the debugging API.** Doc 05 already recommends a per-`case_id` DecisionRecord and
   a "why" query. Do not build a separate agent-debugging layer — **expose the same provenance store
   through structured MCP tools** (`get_case_trace`, `explain_decision`, `get_workflow_history`,
   `list_stuck_cases`). Agents debug by *querying structured decision lineage*, never by grepping raw
   logs. This is the single highest-leverage decision in this doc.

3. **Target MCP spec `2026-07-28` (final ships July 28, 2026) with a `2025-11-25` fallback.** Build
   **stateless** from day one (the RC removes protocol sessions), use **full JSON Schema 2020-12** tool
   schemas, adopt **tool annotations** (`readOnlyHint`/`destructiveHint`/`idempotentHint`) as the risk
   vocabulary, and use the **Tasks extension** for long-running operations (replays, repro-env spin-up).

4. **Three guardrail tiers, enforced server-side, never by hints alone.** Tier-0 **read-only** (auto-
   approvable): traces, histories, state queries. Tier-1 **dev/staging-mutating** (repro, replay,
   re-run in a sandbox). Tier-2 **production-mutating** (signal/cancel/retry a live workflow, patch
   data): always behind JIT-scoped non-human identity + human approval + full audit. Annotations *hint*
   to the client; the **ichiflow server enforces** because "an untrusted server can lie."

5. **Determinism is the product feature that makes agent debugging real, not vibes.** Lean on the
   event-sourced decision core (doc 05) so that **replay is deterministic** (Temporal-style) and any
   case can be reconstructed as-of decision time. Ship **one-command repro environments** (seeded data
   + captured event history → local replica) so an agent's hypothesis is testable, not speculative.

6. **Shadow mode is the default posture for agent write access.** Before an agent is allowed to mutate
   production, it operates in **shadow / read-only + propose** mode: it produces a diagnosis, a repro,
   and a proposed patch/signal as an artifact for human approval. "Shadow mode is the safest way to
   make an agent face reality before reality has to face the agent."

7. **Align with emerging agent-governance frameworks now.** NIST's **AI Agent / Interoperability
   Profile** is expected Q4 2026; CSA's Agentic AI Identity Management and OWASP's **Agentic Top-10
   (ASI03: Identity & Privilege Abuse)** already exist. Treat every agent as a **first-class non-human
   identity** with JIT provisioning, ≤1h credentials, human ownership, kill switch, and per-action audit.

---

## 1. Why this is a distinct pillar

Docs 01–06 make ichiflow *legible* (typed schemas, decision provenance, OTel). This pillar makes it
**operable by agents**. The difference matters:

- **Legible** = a human or agent *could* reconstruct what happened if they knew where to look.
- **Operable-by-agent** = the framework hands the agent **typed tools, discovery, and safe actuators**
  so it can do the loop *step in → inspect → hypothesize → reproduce → fix → verify* without bespoke
  glue and without a human babysitting every step.

Prior art shows this is now a *shipped product surface*, not a research idea: Temporal, Grafana, Sentry,
Supabase, and Neon all ship official/first-party MCP servers, and AGENTS.md + `.claude/` in-repo kits
are a de-facto convention across 60k+ repos. A 2026 framework that omits an agent surface is behind.

---

## 2. MCP in 2026 — spec status, and what "ship your own MCP server" means

### 2.1 Spec status (verified July 2026)
- **Latest stable:** `2025-11-25`. **Release candidate:** **`2026-07-28`**, published as RC on the MCP
  blog; **final spec ships July 28, 2026** — the largest revision since launch. Tier-1 SDKs are expected
  to support it within a ~10-week window.
- **Stewardship:** MCP is governed openly (modelcontextprotocol.io / GitHub org); the broader agent-
  interop ecosystem (AGENTS.md) sits under the **Linux Foundation's Agentic AI Foundation** (since Dec 2025).

### 2.2 What changed in `2026-07-28` that a framework MUST design around

| Change | Practical implication for `ichiflow-mcp` |
|---|---|
| **Stateless protocol core** — removes `initialize`/`initialized` handshake and `Mcp-Session-Id`; any request can hit any instance | Design the server **stateless / horizontally scalable** behind a round-robin LB; no sticky sessions or shared session store. Fits enterprise HA. |
| **Extensions framework** (reverse-DNS IDs, independent versioning) | Ship ichiflow-specific capabilities (e.g. a "decision-trace" extension) on their own version cadence, decoupled from spec releases. |
| **Tasks extension** (task handles + `tasks/get`/`update`/`cancel`) | Model **long-running ops** — deterministic replay, repro-env spin-up, batch re-drive — as Tasks, not blocking calls. |
| **MCP Apps** (server-rendered UI in sandboxed iframes) | Optional: render a decision-trace timeline / event-history viewer inline in the agent host. Nice-to-have, not v1. |
| **Authorization hardening** (OAuth 2.0 / OIDC alignment, `iss` validation, `application_type`, RFC 9207) | Align the MCP server's auth with ichiflow's pluggable auth (doc 04) and enterprise OIDC/Vault. Non-human identity story lives here. |
| **Deprecation policy** (Active→Deprecated→Removed, ≥12-mo windows) | Gives ichiflow a stable contract to promise enterprise customers; mirror it for ichiflow's own tool surface. |
| **Tool schemas → full JSON Schema 2020-12**; cacheable responses gain `ttlMs`/`cacheScope` | Reuse ichiflow's existing typed schemas (doc 03) directly as tool I/O contracts; cache expensive trace queries. |

### 2.3 Prior-art catalog — what each first-party observability/data MCP server exposes

| Product | Official? | What it exposes to agents | Design lesson for ichiflow |
|---|---|---|---|
| **Temporal MCP** (Code Exchange + community `alisaitteke/temporal-mcp`, Docker `mcp/temporal`) | First-party via Code Exchange + community | **36 tools** over the full Temporal HTTP API (cluster, namespaces, workflows, schedules, activities, batch, task queues, search attributes); **only 11 exposed by default**, opt into more. Key: `start_workflow`, `query_workflow` (live state), `get_workflow_history` (full event history, `limit` default 1000), `signal`, `cancel`. Visibility-syntax filtered list. | **Tiered tool exposure** (small default set, opt-in for power) directly transfers. Event-history + live-query is exactly ichiflow's need. |
| **Grafana MCP** | Official (grafana.com docs) | Query metrics/logs across datasources (Prometheus, Loki/**LogQL**, Tempo/**TraceQL**, ClickHouse, CloudWatch, ES, Pyroscope); dashboards; **alert rules**; **Incident**; **Sift** (investigations); OnCall; navigation; annotations; deeplinks. | Debugging = **query languages, not log dumps**. Expose *filtered query* tools + **deeplink generation** so an agent can hand a human a URL. |
| **Sentry MCP + Seer** | Official; **remote server GA Feb 2026** | Error/issue search; **Seer Autofix** = Root-Cause → Solution → Code-gen, with **handoff to Claude Code / Cursor / Copilot** to implement the fix. Auto-triage-on-incident on roadmap. | The **"diagnose here, hand the fix to a coding agent"** split is the reference architecture for ichiflow self-serve. |
| **Supabase MCP** | Official | Manage DB, auth, storage, edge functions, SQL; **8 tool groups**; **OAuth 2.1**; read-only mode flag; project-scoped. | **Explicit read-only mode** + scoping is table-stakes for a data-plane MCP. |
| **Neon MCP** | Official; **remote server GA Feb 2026** | Create/manage serverless Postgres, branches, run SQL. **Database branching** = cheap isolated replicas — a natural **repro/sandbox** primitive. | Branch-per-investigation maps to ichiflow's one-command repro env. |
| **traceloop/opentelemetry-mcp-server** | Community, multi-backend | Unified trace querying across **Jaeger / Tempo / Traceloop**; OpenLLMetry semantic conventions for LLM spans. | If ichiflow emits OTel (doc 05), agents can already query traces via this — ichiflow's value-add is *business-level* (`case_id`) correlation on top. |
| **k8s / DB MCP servers** (Datadog, OpenObserve, Instana, OneUptime also ship observability MCPs) | Mixed | Cluster/resource inspection; SQL query tools. | Confirms the category: infra + data + observability all now have agent tool surfaces. |

### 2.4 Tool-design patterns that work for observability/debugging (synthesized)

Anthropic's own guidance ("Writing effective tools for AI agents", "Code execution with MCP") plus the
MCP best-practice literature converge on:

1. **Query APIs, not log dumps.** Return *structured, filtered* results. Give agents narrow, targeted
   query tools (`get_case_trace(case_id)`, `list_stuck_cases(since, stage)`) rather than one giant
   `get_logs`. Anthropic: encourage "many small, targeted searches" over one broad dump.
2. **Pagination / range / filtering / truncation with sane defaults** on *every* tool that can return
   lots of context (Temporal's `limit=1000` default; Anthropic explicitly recommends this).
3. **Typed I/O schemas as the contract.** Reuse ichiflow's JSON Schema (doc 03) as the tool contract;
   "typed schemas serve as the contract that prevents ambiguity."
4. **Structured, classified errors with retry guidance** — distinguish client (4xx) vs server (5xx) vs
   external (502/503), each with code + message + optional retry hint. MCP error code hygiene (e.g. the
   RC's `-32602` for missing resource) matters.
5. **Token efficiency is a first-class concern.** Consider the **"code execution with MCP"** pattern
   (Anthropic cut 150k→2k tokens): expose ichiflow tools as a **code API** the agent scripts against,
   filtering/aggregating in the execution env before returning to the model — ideal for large event
   histories and trace scans.
6. **Curate the tool set.** "Too many tools or overlapping tools distract agents." Ship a *small,
   sharp* default set (Temporal's 11-of-36 pattern); gate advanced/mutating tools behind opt-in + tier.
7. **Instrument the MCP server itself** (tool invocation counts, latency, schema-validation rates,
   payload sizes) — it's a production service and part of the audit surface.

---

## 3. Build-time surface — what ichiflow ships *in-repo*

Claude Code's extension layers (verified against code.claude.com, 2026) form a stack ichiflow should
target deliberately. The mental model: **CLAUDE.md/AGENTS.md = always-on context · Skills = on-demand
knowledge/workflows · Subagents = isolated context · Hooks = guaranteed automation · MCP = external
services · Plugins = the packaging/distribution unit that bundles all of the above.**

### 3.1 Recommended in-repo artifacts (ship in the ichiflow project scaffold / `create-ichiflow`)

| Artifact | Layer | What ichiflow ships | Why |
|---|---|---|---|
| **`AGENTS.md`** at repo root | Cross-tool context | Overview, build/test/lint commands, ichiflow conventions (canonical events, DecisionRecord, port/adapter model), "how to run the dev server", "how to reproduce a case". | **De-facto standard**: read natively by Codex, Cursor, Copilot, Gemini CLI, Aider, Windsurf, Zed, Jules, Devin, Junie + 20 more; 60k+ repos; LF/AAIF-stewarded. Portable across every agent, not just Claude. |
| **`CLAUDE.md`** (or import of AGENTS.md) | Claude context | Claude-specific pointers; can `@import` AGENTS.md to avoid duplication. | Claude Code's native persistent context. |
| **`.claude/skills/*`** | Skills | e.g. `debug-stuck-case`, `add-adapter`, `author-rule`, `reproduce-incident`, `explain-decision` — each a `SKILL.md` + helper scripts encoding the *ichiflow way* to do the task. | Skills load on-demand, keep context lean, and encode expert workflows so agents don't reinvent them. |
| **`.claude/agents/*`** (subagents) | Subagents | e.g. an `incident-investigator` subagent (read-only, trace-querying) and an `adapter-author` subagent. | Isolate verbose investigation in a sub-context; only the summary returns to the main thread. |
| **`.claude/hooks/*`** | Hooks | Guaranteed guardrails: block edits to generated/audit code, run schema-validation + `ichiflow verify` on stop, require the repro-before-fix workflow. | Hooks are the **only** layer with guaranteed execution — the place for "must/never/always." |
| **ichiflow Claude Code *plugin*** (+ marketplace entry) | Plugin | Bundle the skills + subagents + hooks + the `ichiflow-mcp` server config into **one installable unit**, namespaced (`/ichiflow:debug-case`). | Plugins are the distribution unit; a customer installs one thing and gets the whole agent surface wired up, including the MCP server. |
| **SessionStart hook + `ichiflow verify` skill** | Hooks/Skills | Ensure a fresh session can build, run tests, and launch the dev server (esp. for Claude Code on the web / CI). | Makes agents productive in minute one; matches the "session-start-hook" convention. |

### 3.2 Headless / SDK in CI
Claude Code runs **non-interactively** via `claude -p/--print` with `--output-format json` (returns
`total_cost_usd` + per-model breakdown), and `--bare` for reproducible CI runs; also available as
Python/TS **Agent SDK** packages. ichiflow should ship **reference CI recipes**:
- **PR-time:** agent generates/validates an adapter or rule from a spec, runs `ichiflow verify`, comments.
- **Nightly/triage:** headless agent scans `list_stuck_cases`, opens issues with a diagnosis + repro.
- **On-incident:** webhook → headless agent runs the diagnosis pipeline (§6) and posts a proposed fix.
- (Note the **June 15, 2026 Agent SDK billing/credits change** flagged in multiple 2026 sources — budget
  and `total_cost_usd` tracking should be part of the CI recipe.)

### 3.3 "Declare, don't code" synergy (from doc 04)
Because ichiflow ports (adapters, auth, rules) are **typed declarative artifacts**, they double as ideal
agent targets: an agent generates an AsyncAPI/OpenAPI-described adapter or a policy-as-code rule and
validates it against the schema — exactly the build-time loop skills should encode.

---

## 4. Runtime surface — the `ichiflow-mcp` server (the core proposal)

### 4.1 Principle: expose the *domain's own* observability, not a generic log tool
Doc 05 already defines the primitives: a per-`case_id` **DecisionRecord** (workflow events + fired-rules
trace + DMN results + agent reasoning + human review + outcome), append-only, bitemporal, OTel-correlated.
**The MCP server is a thin, typed, tiered facade over that store plus the workflow engine's query API.**

### 4.2 Proposed tool surface (small sharp default set; advanced opt-in)

**Tier-0 — read-only (auto-approvable; `readOnlyHint: true`)**
- `get_case_trace(case_id, as_of?)` → the full DecisionRecord as structured JSON (paginated/sectioned).
- `explain_decision(case_id)` → the "why" answer: which rules fired, DMN rows matched, inputs known,
  outcome — the human/auditor/agent-shared explanation from doc 05.
- `get_workflow_history(workflow_id, limit=200, page?)` → event history (Temporal-style, paginated).
- `query_workflow_state(workflow_id)` → live current state (actor/workflow state query).
- `list_stuck_cases(since, stage?, error_class?)` → triage feed (structured, filtered).
- `find_cases(filter)` → visibility-style structured query (never raw SQL from the model by default).
- `get_trace_link(case_id)` / `get_dashboard_link(...)` → **deeplinks** to Grafana/Tempo/the UI (agent
  hands a human a URL; Grafana-MCP pattern).
- `get_otel_trace(trace_id)` → correlated technical trace (or defer to the OTel MCP; ichiflow adds the
  `case_id`↔`trace_id` join).

**Tier-1 — dev/staging-mutating (sandbox only; `destructiveHint: false`, non-prod)**
- `reproduce_case(case_id)` → **Task**: seed a local/branch replica from captured event history +
  seeded data → returns a one-command repro handle. (Neon-branch / seeded-data pattern.)
- `replay_workflow(workflow_id, code_ref)` → **Task**: deterministic replay of event history against
  current or a candidate code version (Temporal replay) → returns divergence/non-determinism report.
- `run_case_in_shadow(case_id, candidate)` → run a proposed change beside prod behavior, log disagreements.
- `dry_run_rule(rule, inputs)` / `simulate_decision(...)` → evaluate a candidate rule/DMN without side effects.

**Tier-2 — production-mutating (JIT identity + human approval + audit; `destructiveHint: true`)**
- `signal_workflow(workflow_id, signal, payload)` · `retry_activity(...)` · `cancel_workflow(...)` ·
  `re_drive_case(case_id)` · `patch_case_data(...)`. Every call: scoped short-lived credential, approval
  gate, and an entry in the audit ledger (doc 05) attributing the action to the agent's non-human identity.

### 4.3 Design details
- **Stateless** (RC requirement); expensive trace queries use `ttlMs`/`cacheScope`.
- **Long ops = Tasks** (`reproduce_case`, `replay_workflow`), so the agent can poll `tasks/get`.
- **Structured errors** with class + retry guidance; **pagination defaults** on every list/history tool.
- **Optional code-execution mode** for scanning large histories/traces cheaply (Anthropic MCP-code pattern).
- **Self-observability:** the server emits its own OTel spans and audit entries — agent actions are traceable.

### 4.4 Runtime-debugging techniques the surface should enable (prior art)
- **Time-travel / replay:** Temporal's event-history replay is deterministic — the gold standard; pair
  with **rr-style** record/replay concepts for the non-workflow code paths. ichiflow's event-sourced
  core (doc 05) is what makes this possible.
- **Trace querying by agents:** TraceQL (Tempo) / LogQL (Loki) / OTel via the traceloop MCP — ichiflow's
  edge is the **business-key join** (`case_id`) so an agent debugs in domain terms, not span IDs.
- **Live state inspection:** workflow/actor state queries (`query_workflow`) for "what is this case doing
  right now."
- **Dev loop:** hot-reload dev server + agent-driven test loops (`ichiflow verify`); one-command repro so
  the agent's fix is validated against the real failing case, not a toy.

---

## 5. Safety & guardrails for agent runtime access

### 5.1 The tiering model (server-enforced)
Map the MCP **tool annotations** to enforced tiers — but **enforce server-side**, because
"an untrusted server can lie" and annotations are only *hints* to the client:

| Tier | Annotation hint | Client behavior | ichiflow server enforcement |
|---|---|---|---|
| **0 read-only** | `readOnlyHint: true` | may auto-approve | verify the tool truly has no write path; scope identity to read roles |
| **1 sandbox-mutating** | `destructiveHint: false`, non-prod target | usually auto/soft-approve | force target = staging/branch replica; block prod endpoints at the transport |
| **2 prod-mutating** | `destructiveHint: true` | **must** confirm | **JIT** short-lived scoped credential + **human approval** + audit entry; kill-switch honored |

### 5.2 Non-human identity for agents (from doc 04 + 2026 governance)
- Treat every agent as a **first-class non-human identity (NHI)**, distinct from a generic service
  account: **human owner**, **JIT provisioning**, **no credential valid >1h**, automatic expiry,
  **instant kill switch**. (CSA Agentic AI Identity Management; SailPoint/Saviynt/Okta 2026 frameworks.)
- **JIT duration tied to a risk score** (privilege × data-sensitivity × blast radius): long windows for
  low-risk reads, deliberately short for prod/customer-data writes.
- Maps to **OWASP Agentic Top-10 2026 ASI03 (Identity & Privilege Abuse)** — the framework should make
  the *secure* path the default so adopters don't fall into the 78% with no NHI policy.

### 5.3 Governance alignment (2026)
- **NIST AI RMF + AI 600-1 (GenAI Profile)** govern model *content* behavior; an **AI Agent /
  Interoperability Profile is planned Q4 2026** to govern autonomous *action*. ichiflow should structure
  audit + approval so it can map cleanly onto that profile when it lands (and onto ISO/IEC 42001, EU AI
  Act high-risk obligations — relevant for the loan-decision use case, cf. doc 05).
- **Every agent action is audited** into the same append-only ledger as human/decision actions (doc 05),
  attributed to the NHI, with the approval record and the tool inputs/outputs.

### 5.4 Shadow mode & sandboxed replicas as the default write posture
- **Shadow mode** ("dark traffic"): the agent classifies/diagnoses and *proposes*, comparing to
  production behavior without altering it, until trust is established. The framework should make shadow
  the default and promotion to Tier-2 an explicit, audited step.
- **Sandboxed staging replicas / branch-per-investigation** (Neon-branch pattern; containerized shadow
  mode) so an agent's mutations never touch prod data during diagnosis.

---

## 6. Self-healing / self-serve — making agent debugging reliable, not vibes

### 6.1 The end-to-end loop ichiflow should support
`alert/incident → subscribe → auto-diagnose → deterministic repro → propose fix → (shadow verify) →
human-approved apply → audit`.

- **Subscribe to alerts/incidents:** integrate with PagerDuty / incident.io / Sentry. **Sentry Seer**
  (Autofix in public beta, 2026) is the reference: Root-Cause → Solution → Code-gen, then **hand off the
  implementation to Claude Code**. ichiflow's analogue: an incident webhook triggers a headless agent
  that calls `list_stuck_cases` / `explain_decision` and drafts a fix. (Note Sentry itself lacks on-call/
  incident workflow — those stay with PagerDuty/incident.io; ichiflow should integrate, not replace.)
- **Auto-diagnosis pipeline:** structured, repeatable steps (query trace → identify diverging step →
  classify error) rather than free-form. Braintrust-style trace classification is the 2026 norm for
  ranking recurring failure modes.

### 6.2 What the *framework* can do structurally to make this reliable (the real differentiator)
Agent debugging is only trustworthy if the substrate is deterministic and reproducible. ichiflow can
provide, by construction:
1. **Deterministic replay** — event-sourced decision core (doc 05) → replay reconstructs exact state;
   an agent's hypothesis is *verifiable*, and non-determinism is *detectable* (Temporal replay report).
2. **Seeded data + captured event history → one-command repro env** (`reproduce_case`) so every incident
   is reproducible locally/in a branch — the antidote to "works on my machine" and to agent hallucinated
   fixes.
3. **Bitemporal "as-of" queries** (doc 05) so the agent debugs against *what was known at decision time*,
   not today's data.
4. **Structured decision provenance** as the query target, so diagnoses cite specific fired rules / DMN
   rows / inputs, not prose guesses.
5. **`ichiflow verify` gate** — the agent must reproduce the failure and show the fix passing against the
   captured case before a human approves. Repro-before-fix is enforced by a hook (§3.1).

---

## 7. Proposed conceptual design — the ichiflow agent surface (summary picture)

```
BUILD TIME (in-repo, portable)              RUN TIME (ichiflow-mcp, tiered)
┌─────────────────────────────┐            ┌──────────────────────────────────────┐
│ AGENTS.md  (LF/AAIF std)    │            │ Tier-0 read-only  (readOnlyHint)     │
│ CLAUDE.md  (@import)        │            │  get_case_trace / explain_decision   │
│ .claude/skills/*  (workflows)│           │  get_workflow_history / query_state  │
│ .claude/agents/*  (subagents)│  ──────▶  │  list_stuck_cases / *_link (deeplink)│
│ .claude/hooks/*   (guardrails)│          │ Tier-1 sandbox   (Tasks)             │
│ ichiflow plugin + marketplace│           │  reproduce_case / replay_workflow    │
│ CI recipes (claude -p --json)│           │  dry_run_rule / run_case_in_shadow   │
└─────────────────────────────┘            │ Tier-2 prod  (JIT NHI + approval)    │
        │                                   │  signal / retry / cancel / re_drive  │
        ▼                                   └──────────────────────────────────────┘
  agent authors adapters/rules/                        │  reads/acts on
  workflows from typed specs                           ▼
                                            DecisionRecord + event history + OTel
                                            (doc 05: append-only, bitemporal, case_id)
                                                        │
                                            Guardrails: annotations→server-enforced tiers,
                                            NHI/JIT (doc 04), audit ledger, shadow-first,
                                            kill switch, deterministic replay + repro env
```

**Packaging:** one Claude Code **plugin** wires up skills + subagents + hooks + the MCP server config;
the MCP server is a **versioned product** following the MCP deprecation policy (≥12-mo windows).

---

## 8. Risks & open questions

1. **Untrusted-annotation risk.** Clients may auto-approve `readOnlyHint` tools; a bug that makes a
   "read" tool mutate is catastrophic. *Mitigation:* server-side enforcement + separate read/write
   credentials + code review hook on tool definitions. Never rely on the hint.
2. **Spec churn.** Targeting the `2026-07-28` RC before final (July 28) risks late changes; the RC is the
   biggest revision since launch. *Mitigation:* support `2025-11-25` in parallel; use Tier-1 SDKs; treat
   ichiflow capabilities as **Extensions** to isolate from core-spec churn.
3. **Prod-mutation blast radius.** Tier-2 tools acting on live loan cases are high-risk (regulatory,
   financial). *Mitigation:* shadow-first default; JIT ≤1h scoped NHI; human approval; full audit; and
   prefer **re-drive/repro** over in-place mutation wherever possible.
4. **Agent over-trust / hallucinated fixes.** *Mitigation:* repro-before-fix enforced; deterministic
   replay divergence checks; diagnoses must cite provenance (fired rules/DMN rows), not prose.
5. **Context/token blow-up** on large event histories/traces. *Mitigation:* pagination defaults +
   code-execution MCP mode + targeted query tools over dumps.
6. **Governance moving target.** NIST agent profile (Q4 2026), EU AI Act high-risk deadlines (Aug 2026,
   cf. doc 05), OWASP Agentic Top-10 all evolving. *Mitigation:* structure audit/approval to map onto
   whichever framework, don't hard-code to one.
7. **Cost & billing.** Headless agents in CI + Agent SDK billing change (June 15, 2026). *Mitigation:*
   track `total_cost_usd`; budget guards in CI recipes.
8. **Determinism is a build-time discipline, not free.** Replay only works if the decision core stays
   deterministic (doc 05's scoped event sourcing). Non-deterministic activities must be isolated behind
   the port model (doc 04). This constrains how workflows/adapters are written — worth stating loudly.

---

## 9. Concrete recommendations (actionable)

1. **Adopt AGENTS.md as the primary in-repo agent contract**, with a thin `CLAUDE.md` that imports it;
   ship both in `create-ichiflow` scaffolds.
2. **Ship an ichiflow Claude Code plugin** bundling skills (`debug-stuck-case`, `reproduce-incident`,
   `add-adapter`, `author-rule`, `explain-decision`), a read-only `incident-investigator` subagent,
   guardrail hooks, and the `ichiflow-mcp` config; publish to a marketplace.
3. **Build `ichiflow-mcp` as a stateless, first-class product** targeting spec `2026-07-28` (fallback
   `2025-11-25`), with the **three-tier** tool surface in §4.2 and **server-enforced** guardrails.
4. **Reuse doc 05's DecisionRecord/"why" API as the debugging substrate** — do not build a parallel layer.
5. **Make repro deterministic and one-command** (`reproduce_case`, `replay_workflow` as MCP Tasks); make
   **repro-before-fix** a hard gate.
6. **Model agents as JIT-scoped non-human identities** (doc 04), ≤1h creds, human owner, kill switch,
   per-action audit; shadow-mode-first for any write path.
7. **Ship headless CI recipes** (PR authoring, nightly triage, on-incident diagnosis) using `claude -p
   --output-format json --bare`, with cost tracking.
8. **Integrate, don't reinvent, incident tooling** (PagerDuty/incident.io/Sentry-Seer-style handoff to
   Claude Code); ichiflow's differentiator is the deterministic, provenance-rich substrate underneath.

---

## 10. Sources (verified July 2026)

**MCP spec & roadmap**
- 2026-07-28 RC: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- 2026 MCP roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- Spec (2025-06-18 / current docs): https://modelcontextprotocol.io/specification/2025-06-18
- Releases: https://github.com/modelcontextprotocol/modelcontextprotocol/releases · Blog: https://blog.modelcontextprotocol.io/ · "MCP is growing up": https://aaif.io/blog/mcp-is-growing-up/

**MCP tool annotations / risk vocabulary**
- MCP blog, tool annotations: https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
- Stacklok (annotations as risk vocabulary): https://stacklok.com/blog/tool-annotations-are-becoming-the-risk-vocabulary-for-agentic-systems-that-matters-more-than-it-might-seem/
- MCPBlog: https://mcpblog.dev/blog/2026-03-13-mcp-tool-annotations · Testing annotations: https://sunpeak.ai/blogs/testing-mcp-tool-annotations/ · ChatForest: https://chatforest.com/guides/mcp-tool-annotations-explained/

**Anthropic tool/agent design guidance**
- Writing effective tools for AI agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Code execution with MCP: https://www.anthropic.com/engineering/code-execution-with-mcp
- Effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Advanced tool use: https://www.anthropic.com/engineering/advanced-tool-use

**Prior-art MCP servers**
- Temporal MCP: https://temporal.io/code-exchange/temporal-mcp-server · https://github.com/alisaitteke/temporal-mcp · https://hub.docker.com/r/mcp/temporal · Long-running MCP tools w/ Temporal: https://temporal.io/blog/building-long-running-interactive-mcp-tools-temporal
- Grafana MCP: https://grafana.com/docs/grafana/latest/developer-resources/mcp/ · Intro: https://grafana.com/docs/grafana/latest/developer-resources/mcp/introduction/ · https://mcpservers.org/servers/grafana/mcp-grafana
- Sentry MCP / Seer: https://blog.sentry.io/introducing-seer-agent/ · https://sentry.io/product/seer/autofix/ · https://docs.sentry.io/product/ai-in-sentry/seer/autofix/ · https://docs.sentry.io/product/ai-in-sentry/seer/
- Supabase MCP: https://mcpservers.org/servers/supabase-community/supabase-mcp · https://chatforest.com/reviews/supabase-mcp-server/
- Neon MCP: https://github.com/neondatabase/mcp-server-neon (via awesome lists) · remote-server context: https://mcpplaygroundonline.com/blog/awesome-mcp-servers
- OpenTelemetry (multi-backend) MCP: https://github.com/traceloop/opentelemetry-mcp-server
- MCP best practices / observability: https://www.merge.dev/blog/mcp-observability · https://nordicapis.com/8-tips-and-best-practices-for-mcp-server-development/ · https://www.cdata.com/blog/mcp-server-best-practices-2026 · https://www.armosec.io/blog/runtime-observability-mcp-production/ · https://openobserve.ai/blog/mcp-servers-observability-guide/

**Claude Code extensibility / AGENTS.md**
- Claude Code extend/features: https://code.claude.com/docs/en/features-overview
- Headless: https://code.claude.com/docs/en/headless · CI/CD: https://hidekazu-konishi.com/entry/claude_code_cicd_and_headless_automation.html
- Plugins guide: https://hidekazu-konishi.com/entry/claude_code_plugins_complete_guide.html · Extension-layer decision guide: https://hidekazu-konishi.com/entry/claude_code_extension_layers_decision_guide.html
- Skills/hooks/subagents: https://ofox.ai/blog/claude-code-hooks-subagents-skills-complete-guide-2026/ · https://www.totalum.app/blog/claude-code-skills-totalum
- Agent SDK guide: https://hidekazu-konishi.com/entry/claude_agent_sdk_complete_guide.html · SDK billing change (Jun 15 2026): https://theplanettools.ai/blog/claude-agent-sdk-billing-model-deprecation-june-15-2026-migration-playbook · https://www.totalum.app/blog/claude-agent-sdk-credits-2026
- AGENTS.md spec/adoption: https://www.morphllm.com/agents-md-guide · https://asdlc.io/practices/agents-md-spec/ · https://codersera.com/blog/agents-md-complete-guide-2026/ · https://blog.buildbetter.ai/agents-md-complete-guide-for-engineering-teams-in-2026/ · https://dev.to/aws-builders/agentsmd-skillmd-designmd-how-ai-instructions-split-into-three-layers-d0g

**Runtime debugging / replay / traces**
- Temporal event history & replay: https://docs.temporal.io/encyclopedia/event-history · https://docs.temporal.io/workflow-execution/event · https://docs.temporal.io/workflows · Temporal for AI agents: https://effloow.com/articles/temporal-ai-agents-durable-execution-guide-2026 · Series D: https://temporal.io/blog/
- Grafana Tempo / TraceQL / LogQL: https://grafana.com/docs/tempo/latest/ · https://github.com/grafana/tempo · https://openobserve.ai/blog/distributed-tracing-tool/
- AI agent debugging tools 2026: https://www.braintrust.dev/articles/best-ai-agent-debugging-tools-2026

**Safety / guardrails / governance**
- Non-human identity governance: https://christian-schneider.net/blog/non-human-identity-governance-gap-ai-agents/ · https://nhimg.org/articles/agentic-ai-governance-is-an-identity-and-runtime-control-plane/ · CSA whitepaper: https://labs.cloudsecurityalliance.org/research/csa-whitepaper-nonhuman-identity-agentic-ai-governance-v1-cs/ · Okta: https://www.okta.com/identity-101/improve-ai-agent-data-privacy-and-security/ · SailPoint: https://www.sailpoint.com/blog/sailpoint-framework-governing-ai-agents · CSO 6-stage NHI maturity: https://www.csoonline.com/article/4194548/agentic-ai-identity-a-6-stage-maturity-model-for-non-human-identities.html
- NIST AI RMF / agentic profile: https://www.ispartnersllc.com/blog/nist-ai-rmf-2025-2026-updates-what-you-need-to-know-about-the-latest-framework-changes/ · CSA NIST agentic profile: https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/ · https://www.glacis.io/guide-nist-ai-rmf · https://neuraltrust.ai/blog/nist-ai-rmf-implementation-guide
- Shadow mode / traffic replay / sandboxes: https://devops.com/shadow-mode-continuous-integration-the-missing-test-layer-for-ai-agents/ · https://www.agentforgehub.com/posts/shadow-mode-for-ai-agents · https://brightlume.ai/blog/shadow-mode-rollouts-ai-agents-pilot-production · https://oneuptime.com/blog/post/2026-02-09-traffic-replay-testing-staging/view · https://blaxel.ai/blog/ai-sandbox

**Self-healing / incidents**
- Sentry Seer (autofix, handoff to Claude Code): https://blog.sentry.io/introducing-seer-agent/ · https://blog.sentry.io/seer-fixes-seer-debugging-agent/ · Alternatives (incident.io/PagerDuty context): https://betterstack.com/community/comparisons/sentry-seer-alternatives/
