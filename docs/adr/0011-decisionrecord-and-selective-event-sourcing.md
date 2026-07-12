# 0011 — DecisionRecord + "why" API; selective event sourcing; outbox elsewhere; bitemporal as-of

- Status: accepted (amended 2026-07-12)
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md)
- Amendment basis: founder interview 2026-07 (observability = OTel-native, BYO backend)

## Context

For a regulated decision (e.g. loan approval) the audit requirement is not "log the changes" — it is
**reconstruct the decision**: which inputs were known, at what policy version, which rules fired, what
the DMN tables returned, what an AI agent reasoned, who reviewed, and the outcome — as one causal chain,
queryable *as of the decision instant* (research 05 §1.1). This must satisfy FCRA/ECOA adverse-action
(≤4 specific reasons), GDPR Art. 22 (meaningful information about the logic, human-reviewer identity),
SOX, and BCBS 239 lineage (research 05 §1.6). Three storage strategies compete (event sourcing,
audit-log tables, CDC audit); research 05 §1.2 concludes the right answer is a **hybrid**, because
event-sourcing-everywhere carries an "explanation tax" and "a well-done CRUD is much better than a poorly
done Event Sourcing."

## Decision

- **DecisionRecord is a first-class, typed domain object** keyed by the global `case_id`, stitching:
  workflow event history → rule-engine fired-rules trace → DMN evaluation results (input entries,
  matched rows, outputs) → AI-agent reasoning trace → human-review record (reviewer identity, decision)
  → outcome. Stored **append-only** with a content schema rich enough for post-hoc reconstruction
  (research 05 §1.3).
- **"why" API** is the single query surface over the DecisionRecord for support staff, auditors, and AI
  agents, returning a **typed, machine-queryable object** (not prose) — the same object a human UI
  renders and the source of adverse-action reason codes (research 05 §2.4). This *is* the agent-debugging
  API ([0015](0015-first-party-mcp-server-and-agent-kit.md)) — do not build a parallel layer.
- **Event-source the decision/flow core only** — the aggregate where replay and intent genuinely matter
  (Temporal's event history [0003](0003-temporal-durable-execution-substrate.md) is the mechanism). For
  everything else use **append-only audit-log tables + transactional outbox** so the DB write and the
  emitted audit event are atomic (research 05 §1.2).
- **Bitemporal ("as-of") support** — valid time + transaction/system time — so decisions are
  reconstructable as of the decision instant, not as-of-now.
- Authz decision logs ([0010](0010-hybrid-authorization-openfga-plus-policy.md)) and agent actions
  ([0015](0015-first-party-mcp-server-and-agent-kit.md)) land in the same ledger, attributed and
  approval-stamped.

## Amendment (2026-07-12) — observability is OTel-native, BYO backend

The observability half of this pillar ([08](../architecture/08-audit-and-observability.md) §4) is
clarified: **all signals — traces, metrics, logs, *and* the wide decision events — export via standard
OTLP to a bring-your-own backend** (AWS CloudWatch/X-Ray, Google Cloud Operations, Grafana, Datadog,
any OTLP-compatible stack). **ichiflow builds no proprietary observability store and does not ship or
bundle a Grafana-class stack as a commitment** — it provides *integration guidance*, not an owned
monitoring product. The **Dev tier bundles only a minimal local OTel viewer**
([09](../architecture/09-deployment-and-topology.md) §3.1). This does not change the DecisionRecord /
*why* API decision below — the DecisionRecord remains ichiflow's own first-class domain object; what is
BYO is the *telemetry backend*, not the decision-provenance spine. The wide-event operational read model
(§4.3–4.4) likewise stays a BYO/SPI binding (ClickHouse/Honeycomb-class when scale warrants), never a
bundled proprietary store.

## Alternatives considered

- **Event sourcing everywhere.** Complete, replayable history — but high complexity, an "explanation
  tax," hard ad-hoc querying, and long streams needing snapshots; research 05 §1.2 says ES "earns its
  keep only in greenfield bounded contexts where replay/temporal queries/complete audit are genuine
  requirements" — i.e. the decision core, not the whole system. Rejected as a blanket approach; scoped to
  the core.
- **CDC-based audit (Debezium tailing the WAL) as the primary "why" store.** Cannot be bypassed and is
  great for projections, but it captures **what changed, not intent/why** (research 05 §1.2). Rejected as
  primary; retained as an optional projection/change-feed mechanism ([0012](0012-postgresql-first-storage-spis.md)).
- **Append-only cryptographic ledger (immudb / QLDB-style) as the core store.** Provable immutability for
  regulators, but an extra store and not a general query engine (research 05 §1.2). Kept as an **optional
  SPI** for high-assurance customers, not the default. **QLDB itself is EOL (July 2025) — do not build on
  it** (research 05 §1.5).
- **KurrentDB (ex-EventStoreDB) as the event store.** Mature ES engine, but its license moved to
  **Kurrent License v1 (source-available, not OSI-open)** — needs legal review before embedding
  ([0016](0016-license-hygiene-policy.md)). Rejected as default; Marten-on-Postgres or a PG-native audit
  log is the PG-first choice, Axon an option on the JVM (research 05 §1.5).
- **Dual-write (write DB + emit event separately).** Anti-pattern — partial-failure inconsistency;
  replaced by the transactional outbox (research 05 §1.2, research 04 §A.3.2).

## Consequences

Positive:
- One typed causal chain answers humans, auditors, adverse-action letters, and AI agents from a single
  source (research 05 §2.4) — the observability twin is the wide "decision event per case" (research 05 §2.2).
- Scoped ES keeps complexity where it pays and avoids the explanation tax elsewhere.
- Bitemporal as-of makes "what did we know when" answerable — a hard regulatory requirement.

Negative / costs:
- **Nailing the DecisionRecord content schema is load-bearing and hard** — it must serve humans, letters,
  and agents at once; an open question in research 05 §7.4.
- **Bitemporality on managed Postgres is constrained**: PG 18 adds application-time but **not** auto
  system-time; managed PG (RDS/Azure/Cloud SQL) often blocks the needed extensions, forcing trigger-based
  history tables or an XTDB SPI (research 05 §1.4, §7.3).
- Hybrid storage = more patterns to teach and operate (ES core + outbox + audit tables + optional ledger).
- The append-only ledger and bitemporal stores, when enabled, are extra operational surface.

## References

- Research 05 §1 (audit/explainability), §1.2 (storage tradeoffs), §1.3 (DecisionRecord), §1.4 (bitemporal), §1.5 (tech status), §1.6 (regulatory), §2.2/§2.4 (wide events / structured "why")
- Related: [0003](0003-temporal-durable-execution-substrate.md), [0010](0010-hybrid-authorization-openfga-plus-policy.md), [0012](0012-postgresql-first-storage-spis.md), [0015](0015-first-party-mcp-server-and-agent-kit.md), [0016](0016-license-hygiene-policy.md)
