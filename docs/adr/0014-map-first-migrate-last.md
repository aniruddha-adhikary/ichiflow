# 0014 — Map first, migrate last: three-ring brownfield model + Migration Copilot guardrails

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/06-migration-and-onboarding.md](../research/06-migration-and-onboarding.md)

## Context

Enterprises adopting ichiflow already run mission-critical systems on databases with years of data,
foreign keys, triggers, and downstream consumers ichiflow will never see. Research 06 §A.0 sets the
governing stance: **adopt into the existing database; do not demand a migration to run.** Every schema
change to a legacy production DB is a coordinated, high-blast-radius event; ichiflow's "adopt in minutes"
promise collapses if step one is "alter your loan_applications table" (research 06 §A.1). Migration also
means migrating **decision logic**, where correctness is *outcome parity*, not schema parity.

## Decision

A **three-ring brownfield model**, adopted in order (research 06 §A.0):

1. **Ring 0 — Map, don't migrate (default).** A declarative schema-mapping DSL (the DDD Anti-Corruption
   Layer realized as data) binds legacy tables/columns → canonical ichiflow entities, backed by read
   models (views / federated queries via **Trino** when data must not move). **Zero or additive-only DDL;
   `writePolicy: read-only` by default.** The legacy DB stays the source of truth.
2. **Ring 1 — Coexist & sync (transition).** When ichiflow must own state: **expand/contract (parallel
   change)** evolution + **CDC (Debezium)** to keep stores consistent + **transactional outbox** (never
   dual-write) + strangler-fig routing shifting slices over time.
3. **Ring 2 — Assisted structural migration (opt-in).** The **Migration Copilot** introspects the legacy
   DB, proposes canonical mappings, generates an expand/contract plan, and generates reconciliation +
   parity tests — behind hard guardrails.

**Tooling:** **Atlas (ariga)** as the declarative schema-as-code engine (50+ safety analyzers lint
destructive/lock/backward-incompatible changes) + **pgroll** as the zero-downtime executor; **Flyway
Community** as the plain-SQL fallback. First-class **introspection** (Atlas inspect / jOOQ codegen /
Prisma pull) seeds a draft canonical schema + mapping from the existing DB.

**Migration Copilot guardrails (hard requirements, research 06 §A.5.3):** (1) human approval gate on
every mapping and DDL plan; (2) dry-run/plan preview, reversible plans; (3) migration linting blocks
destructive changes; (4) read-only by default; (5) shadow-read + reconciliation must pass before
promotion; (6) explainability + provenance — every proposal carries rationale + confidence, every human
decision logged to the append-only DecisionRecord ([0011](0011-decisionrecord-and-selective-event-sourcing.md));
(7) **never touch production directly** — output lands in a reviewable non-prod target first. The LLM
proposes; deterministic tools plan and lint; a human approves; a harness verifies.

**Decision parity testing** is a first-class capability: replay a golden dataset of historical cases with
known legacy outcomes through the migrated DMN, compare decisions + reason codes (not aggregates),
expressed as Gherkin parity scenarios run continuously (research 06 §A.6.3).

**Exit story:** everything is exportable (DMN [0001](0001-canonical-rule-representation-dmn.md), Flow DSL
[0004](0004-declarative-flow-dsl-on-temporal.md), schemas, data) — **migration OUT is as supported as
migration IN.**

## Alternatives considered

- **Migrate-first (require structural migration to adopt).** Rejected — destroys the "adopt in minutes"
  promise and forces a high-blast-radius change-control event before any value is delivered (research 06
  §A.1). Map-first inverts this: earn the right to change the schema later.
- **Shared DB as the integration point.** Rejected as a design — couples systems through their most
  volatile internal detail ("the worst integration point"); tolerated only transiently (research 06 §A.1.4).
- **Dual-write during coexistence.** Anti-pattern (partial-failure inconsistency); replaced by outbox +
  CDC + idempotent consumers (research 06 §A.2.2).
- **Liquibase as the migration engine.** Rejected — Community is moving to the **Functional Source License
  (FSL) at v5.0** (not OSI-open), a lock-in/rug-pull signal counter to ichiflow's no-lock-in mandate
  (research 06 §A.4, [0016](0016-license-hygiene-policy.md)). Atlas (open-core, watch the boundary) +
  pgroll (OSS) + Flyway Community instead.
- **Depend on Datafold OSS `data-diff` for reconciliation.** Rejected — **EOL since May 2024**; ichiflow
  builds a first-party checksum-tree + sampling reconciliation harness (research 06 §A.6.1).
- **Auto-apply AI-generated mappings/migrations.** Rejected — plausible-but-wrong mappings are the top
  hazard; every mature tool (AWS DMS+GenAI, Google DMS+Gemini) uses propose→human-review→verify, never
  straight-to-prod (research 06 §A.5.2).

## Consequences

Positive:
- Non-invasive Ring 0 adoption; structural change is opt-in and guarded.
- Decision-parity testing makes "migrate your rules to ichiflow" a defensible enterprise proposition — a
  differentiating feature (research 06 §A.6.3).
- A genuinely clean exit story reinforces the anti-lock-in mission.

Negative / costs:
- **Legacy DBs are rarely clean** (orphaned FKs, overloaded columns, logic in triggers/defaults);
  mapping surfaces this but cannot fully automate resolution — budget human data-archaeology (research 06 §A.7).
- **AI schema-matching false confidence** is the top hazard; mitigated only by ranked candidates,
  confidence thresholds, mandatory review, and parity verification.
- **Coexistence-phase consistency** is the strangler's hardest problem — the transition window is where
  incidents cluster (research 06 §A.7).
- Writing back to legacy inherits its constraints and other consumers — keep read-only as long as possible.
- Atlas is open-core; keep every migration artifact as portable plain data (SQL + declarative mapping) so
  the engine underneath is swappable (research 06 §A.7).

## References

- Research 06 §A.0–A.1 (map-first stance, ACL, strangler), §A.2 (CDC/outbox/federation), §A.3 (expand/contract), §A.4 (tooling), §A.5 (Migration Copilot), §A.6 (verification / decision parity), §A.7 (risks)
- Atlas — https://atlasgo.io/ · pgroll — https://pgroll.com/
- Related: [0001](0001-canonical-rule-representation-dmn.md), [0004](0004-declarative-flow-dsl-on-temporal.md), [0011](0011-decisionrecord-and-selective-event-sourcing.md), [0012](0012-postgresql-first-storage-spis.md), [0015](0015-first-party-mcp-server-and-agent-kit.md), [0016](0016-license-hygiene-policy.md)
