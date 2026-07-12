# 0012 — PostgreSQL-first storage with pluggable SPIs (audit/search/analytics)

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md)

## Context

ichiflow's data domains have genuinely different access patterns — case data (transactional), audit
(append-only/immutable), analytics (columnar), search (inverted index). Polyglot persistence serves each
best but multiplies operational cost and consistency risk (research 05 §4.1). ichiflow is also a
*framework* that must run from a laptop to a zoned HA cluster ([0013](0013-modular-monolith-split-later.md)),
so the default must be trivial to operate while large customers can specialize.

## Decision

- **PostgreSQL-first for everything by default.** A new adopter runs on a single Postgres instance
  holding case data + audit + read models + queue + search (FTS + `pg_trgm`/`pgvector`) — "different
  rooms in one house" (research 05 §4.2). The operational math is decisive: one store at 99.9% beats
  three chained (= 99.7%), and a new engineer learns the whole model in a day.
- **Pluggable persistence SPIs** (the Keycloak/Camunda storage-SPI precedent, research 05 §4.4) for
  **case store, audit/ledger store, read-model/projection store, and search store**. Default
  implementations all target Postgres; enterprises bind audit → immudb/XTDB, search → OpenSearch,
  analytics → Snowflake/BigQuery **without forking**. The maxim: add specialized stores when you hit real
  Postgres limits, not when you think you will.
- **Correlation via the global `case_id`** stamped on every record in every store, so a decision
  reassembles across case DB + audit ledger + search + warehouse — also the BCBS 239 lineage key
  (research 05 §4.3).
- **Cross-store consistency** via CQRS read-model projections (rebuildable from the event/audit log),
  transactional outbox, and **CDC (Debezium) where needed** for near-real-time sync (research 05 §4.3).
- The persistence ladder (SQLite dev → single Postgres → specialized SPIs) is the same app code across
  tiers ([0013](0013-modular-monolith-split-later.md), research 06 §B.2.1).

## Alternatives considered

- **Polyglot-per-domain from day one.** Right tool per access pattern, but consistency + ops burden up
  front, needing correlation IDs + sagas immediately (research 05 §4.5). Rejected as the default; it is
  the opt-in destination via SPIs when limits are actually hit. Note the 2025 direction of travel:
  Camunda 8.8 *reduced* mandatory external stores — "fewer mandatory stores, more optional SPIs" is the
  ergonomic sweet spot (research 05 §4.4).
- **A dedicated search engine (Elasticsearch/OpenSearch) as a baseline dependency.** Rejected as default:
  Postgres FTS + `pg_trgm`/`pgvector` covers early needs; OpenSearch is the search-SPI target when scale
  demands it (research 05 §4.4).
- **A dedicated analytics/columnar warehouse as a baseline.** Same reasoning — analytics-SPI target
  (Snowflake/BigQuery), not a mandatory store.
- **A cryptographic ledger (immudb/XTDB) as the primary store.** Rejected as default (extra store, not a
  general query engine); it is the audit-SPI for high-assurance customers ([0011](0011-decisionrecord-and-selective-event-sourcing.md)).
- **App-level dual writes to keep stores in sync.** Anti-pattern (partial-failure inconsistency); replaced
  by outbox + CDC + projections (research 05 §4.3, research 04 §A.3.2).

## Consequences

Positive:
- Trivial default footprint (one Postgres) → strong adoption lever and clean air-gapped deploy; the same
  app code scales by binding SPIs.
- `case_id` correlation gives cross-store reassembly and satisfies BCBS 239 lineage.
- Projections are rebuildable from the log — drop and rebuild a corrupted read model.

Negative / costs:
- **The SPI surface is real API to maintain, and the test matrix grows** with each supported store
  (research 05 §4.5).
- **Going polyglot re-introduces eventual consistency**: replication lag forces an explicit
  read-your-writes decision (read from leader / wait for projection / tolerate staleness) that the query
  APIs must surface (research 05 §4.3).
- CDC (Debezium/Kafka Connect) is operational weight; lighter native-CDC/outbox-relay paths are offered
  for smaller adopters (research 06 §A.2.1).
- Postgres has real ceilings at very high scale/specialized query needs — the SPIs exist precisely
  because "just Postgres" is a default, not a universal answer (research 05 §4.5).

## References

- Research 05 §4 (multi-database), §4.2 (Postgres-first), §4.3 (correlation), §4.4 (persistence SPI), §4.5 (patterns)
- Related: [0011](0011-decisionrecord-and-selective-event-sourcing.md), [0013](0013-modular-monolith-split-later.md), [0014](0014-map-first-migrate-last.md)
