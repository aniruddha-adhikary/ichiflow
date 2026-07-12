# 0021 — Reporting = embed proven OSS BI over governed read models; no custom report engine

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: founder interview 2026-07 (eight decisions)
- Research: [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md)

## Context

Casework orgs need three distinct answers: *is the system healthy* (operational dashboards,
[08](../architecture/08-audit-and-observability.md) §4.4), *why did this Case resolve so* (the *why*
API, [0011](0011-decisionrecord-and-selective-event-sourcing.md)), and **business intelligence** —
*how many permits this quarter, at what median cycle time, with what obligation-breach rate, by unit.*
The third is a large, mature product category (Metabase, Superset, and commercial peers). Building a
bespoke report engine would be a multi-quarter effort in a **non-differentiating** area, and would
create a second, drift-prone definition of "a permit" and a second authorization model for analytics.

## Decision

**Reporting = embed proven open-source BI over ichiflow's governed read models. ichiflow builds no
custom report engine.**

- **Governed read-model projections are the reporting contract.** ichiflow ships schema-derived,
  governed CQRS projections — **cases, outcomes, conditions/obligations, SLAs, decision stats** —
  rebuildable from the audit/event log and versioned like any other contract
  ([08](../architecture/08-audit-and-observability.md) Part 7). A report field means exactly what the
  same field means in a Case, the *why* API, and correspondence — one governed source of meaning.
- **First-class integration with Metabase / Superset-class OSS BI**, not a bespoke builder:
  **embedding** in the back-office Portal ([07](../architecture/07-ui-and-portals.md) §5),
  **SSO via the identity broker** ([0009](0009-identity-broker-per-audience.md)) so reporting access is
  the same Principal, and **row/field-level security driven by the *same* PDP**
  ([0010](0010-hybrid-authorization-openfga-plus-policy.md)) so an analyst can never see a row or masked
  field in a report that the API would deny.
- **This is the "prefer proven open source" principle** ([00](../architecture/00-vision-and-principles.md)
  §4): integrate a mature OSS component for a non-differentiating concern; **build the
  differentiators** (decision governance, DecisionRecord, Flow DSL, Copilots). What ichiflow owns here
  is the governed read models and the PDP-consistent embed security — not the charting.
- **Phasing:** the read-model substrate is v1 (projections are already how §4.4 works); the packaged BI
  embed + SSO + PDP-scoped embedding is **post-v1**.

## Alternatives considered

- **Build a custom report engine / report builder.** Rejected: multi-quarter build in a
  non-differentiating area with mature OSS incumbents; it also duplicates the semantic model and the
  authorization model, inviting drift. Fails the "prefer proven open source" test.
- **Point BI directly at the raw operational tables.** Rejected: couples reports to internal storage
  shapes, bypasses the governed semantic layer, and — critically — **bypasses the PDP**, so analytics
  could leak rows/fields the API denies. The governed read models + PDP-scoped embed exist precisely to
  prevent this.
- **Ship a single bundled BI tool as a hard dependency.** Rejected as a *commitment*: BYO-friendly
  integration (Metabase *or* Superset *or* a customer's existing BI) matches the BYO-backend stance for
  observability ([0011](0011-decisionrecord-and-selective-event-sourcing.md) amendment note) and the
  self-host ethos better than mandating one tool.

## Consequences

Positive:
- No report-engine build; effort stays on ichiflow's differentiators.
- One semantic source and **one authorization model** across API, UI, and analytics — an embedded
  dashboard cannot out-see the API.
- Consistent with fully-open-source ([0022](0022-fully-open-source.md)) and prefer-proven-OSS: the BI
  tools are themselves OSS, nothing is paywalled.

Negative / costs:
- **Integration surface to maintain** across more than one BI tool (embedding hooks, SSO, PDP-scoped
  row/field security), and to keep current as those tools evolve.
- **PDP-scoped embedding is real work** — mapping the central PDP's row/field verdicts onto a BI tool's
  data-permission model is non-trivial and must be proven not to leak.
- Deep, warehouse-scale analytics may still need an analytics-store SPI binding
  ([0012](0012-postgresql-first-storage-spis.md)); the read models are the contract, the store behind
  them can scale out.

## References

- Founder interview 2026-07 (decision 4: embed proven OSS BI over governed read models; no custom
  report engine; add the "prefer proven open source" principle).
- Related: [08](../architecture/08-audit-and-observability.md) Part 7 (read models + embed security),
  [0009](0009-identity-broker-per-audience.md) (SSO via broker),
  [0010](0010-hybrid-authorization-openfga-plus-policy.md) (PDP row/field security),
  [0012](0012-postgresql-first-storage-spis.md) (analytics-store SPI),
  [0022](0022-fully-open-source.md) (fully OSS — the prefer-proven-OSS sibling).
