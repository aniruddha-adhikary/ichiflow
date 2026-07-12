# 0015 — First-party ichiflow-mcp server + in-repo agent kit; three guardrail tiers; agents as NHIs

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/07-ai-native-operations.md](../research/07-ai-native-operations.md)

## Context

ichiflow is purpose-built so AI coding agents (Claude Code first) are productive at **build time** (authoring
schemas, adapters, rules, flows) and **run time** (stepping into a live system, inspecting decision
traces, reproducing a failure, proposing a fix). Research 07 §0 argues a 2026 framework that omits an
agent surface is behind — Temporal, Grafana, Sentry, Supabase, and Neon all ship first-party MCP servers,
and AGENTS.md + `.claude/` kits are a de-facto convention. The highest-leverage decision is to expose the
existing DecisionRecord/"why" store ([0011](0011-decisionrecord-and-selective-event-sourcing.md)) as
typed agent tools rather than build a parallel debugging layer.

## Decision

Ship **two agent surfaces**:

1. **Build-time in-repo kit** (in `create-ichiflow` scaffolds): `AGENTS.md` at repo root (the LF/AAIF
   cross-tool standard, read by Codex/Cursor/Copilot/Gemini/etc.) + a thin `CLAUDE.md` that `@import`s it;
   `.claude/skills/*` (`debug-stuck-case`, `add-adapter`, `author-rule`, `reproduce-incident`,
   `explain-decision`); `.claude/agents/*` (a read-only `incident-investigator` subagent); `.claude/hooks/*`
   (guaranteed guardrails: block edits to generated/audit code, enforce repro-before-fix, run `ichiflow
   verify` on stop); packaged as one **Claude Code plugin** + marketplace entry. Plus headless CI recipes
   (`claude -p --output-format json --bare`) for PR authoring, nightly triage, on-incident diagnosis, with
   `total_cost_usd` budget tracking (research 07 §3).
2. **Runtime `ichiflow-mcp` server** — a **stateless** (RC requirement), typed, tiered facade over the
   DecisionRecord + workflow query API, targeting MCP spec **2026-07-28** with a **2025-11-25 fallback**,
   using full JSON Schema 2020-12 tool schemas ([0006](0006-typespec-authoring-openapi-jsonschema-canonical.md))
   and the Tasks extension for long-running ops. The "why" API *is* the debugging API — reuse it, do not
   fork it (research 07 §4).

**Three guardrail tiers, enforced server-side (never by annotation hints alone — "an untrusted server can
lie")** (research 07 §5.1):
- **Tier 0 — read-only** (`readOnlyHint`, auto-approvable): `get_case_trace`, `explain_decision`,
  `get_workflow_history`, `query_workflow_state`, `list_stuck_cases`, deeplink tools.
- **Tier 1 — dev/staging-mutating** (Tasks, non-prod target forced at the transport): `reproduce_case`,
  `replay_workflow`, `run_case_in_shadow`, `dry_run_rule`.
- **Tier 2 — production-mutating** (`destructiveHint`): `signal_workflow`, `retry_activity`,
  `cancel_workflow`, `re_drive_case`, `patch_case_data` — always JIT-scoped short-lived credential +
  human approval + audit entry; prefer re-drive/repro over in-place mutation.

**Agents are non-human identities (NHIs)** under [0009](0009-identity-broker-per-audience.md)/[0010](0010-hybrid-authorization-openfga-plus-policy.md):
human owner, JIT provisioning, credentials ≤1h with JIT duration tied to a risk score, instant kill
switch, per-action audit into the same ledger ([0011](0011-decisionrecord-and-selective-event-sourcing.md)).
**Shadow mode is the default write posture** — diagnose and *propose*, promote to Tier-2 only as an
explicit audited step (research 07 §5.4). Determinism ([0003](0003-temporal-durable-execution-substrate.md)
replay + one-command repro) is what makes agent debugging verifiable, not vibes (research 07 §6).

## Alternatives considered

- **A generic log/`get_logs` tool surface.** Rejected — research 07 §2.4 (Anthropic + MCP best practice):
  debugging is **structured query APIs, not log dumps**; give agents narrow, typed, paginated query tools
  over the DecisionRecord, "many small targeted searches" over one broad dump.
- **A separate agent-debugging store/layer.** Rejected — reuse doc 05's DecisionRecord/"why" API as the
  substrate; a parallel layer would drift from the human/auditor view (research 07 §0.2, §4.1).
- **Trust MCP tool annotations for safety (client auto-approves `readOnlyHint`).** Rejected as the
  enforcement mechanism — annotations only *hint* to the client; enforce tiers server-side with separate
  read/write credentials, because a bug that makes a "read" tool mutate is catastrophic (research 07 §5.1, §8.1).
- **Stateful MCP server (sessions).** Rejected — the 2026-07-28 RC removes protocol sessions; build
  stateless/horizontally-scalable from day one to fit enterprise HA (research 07 §2.2).
- **Full-autonomy agent write access to production.** Rejected — shadow-first + JIT NHI + human approval +
  repro-before-fix; Tier-2 blast radius on live regulated cases is too high (research 07 §5.4, §8.3).
- **Build our own incident/on-call tooling.** Rejected — integrate PagerDuty/incident.io/Sentry-Seer-style
  handoff to Claude Code; ichiflow's differentiator is the deterministic, provenance-rich substrate, not
  reinventing incident workflow (research 07 §6.1, §9.8).

## Consequences

Positive:
- Agents debug in domain terms (`case_id`, fired rules, DMN rows), not span IDs — the business-key join is
  ichiflow's value-add over generic OTel MCPs.
- One plugin wires up the whole agent surface; AGENTS.md keeps it portable across every agent host.
- Server-enforced tiers + NHI + audit map cleanly onto emerging governance (NIST agent profile Q4 2026,
  OWASP Agentic Top-10 ASI03, EU AI Act) (research 07 §5.3).

Negative / costs:
- **Spec churn risk**: targeting the 2026-07-28 RC before final risks late changes (biggest revision since
  launch) — mitigated by parallel 2025-11-25 support and treating ichiflow capabilities as Extensions
  (research 07 §8.2).
- **Determinism is a build-time discipline, not free**: replay only works if the decision core stays
  deterministic and non-deterministic activities are isolated behind the port model — this constrains how
  flows/adapters are written (research 07 §8.8).
- **Tier-2 remains high-risk** on live loan cases (regulatory/financial); the guardrail stack is mandatory
  overhead, and agent over-trust/hallucinated fixes need repro-before-fix + provenance-cited diagnoses
  (research 07 §8.3, §8.4).
- Context/token blow-up on large histories needs pagination defaults + code-execution MCP mode; headless
  CI agents carry real cost that must be budgeted (research 07 §8.5, §8.7).

## References

- Research 07 §0 (TL;DR), §2 (MCP spec + prior art), §3 (build-time kit), §4 (ichiflow-mcp surface), §5 (guardrails/NHI), §6 (self-healing loop), §8 (risks)
- MCP 2026-07-28 RC — https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- Related: [0003](0003-temporal-durable-execution-substrate.md), [0009](0009-identity-broker-per-audience.md), [0010](0010-hybrid-authorization-openfga-plus-policy.md), [0011](0011-decisionrecord-and-selective-event-sourcing.md), [0014](0014-map-first-migrate-last.md)
