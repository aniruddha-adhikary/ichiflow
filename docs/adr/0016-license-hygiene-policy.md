# 0016 — License hygiene policy: Apache-2.0/MIT substrate preference + avoid-list + CI allowlist

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/01-rule-engines.md](../research/01-rule-engines.md), [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md), [../research/03-schema-and-types.md](../research/03-schema-and-types.md), [../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md), [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md), [../research/06-migration-and-onboarding.md](../research/06-migration-and-onboarding.md)

## Context

ichiflow is a **framework meant to be self-hosted by its customers**, including air-gapped enterprises,
with an explicit anti-lock-in mission ("migration OUT is as supported as migration IN"). Therefore an
embedded dependency's license must not impose downstream production fees, EOL cliffs, or source-available
restrictions on ichiflow's customers. The research repeatedly surfaced dependencies that fail this test —
often ones that recently *changed* license — so the policy must be explicit and machine-enforced.

## Decision

**Prefer Apache-2.0 / MIT substrates** for every embedded/core dependency. A dependency that is
source-available, open-core with production gating, or EOL is adopted only behind an SPI/abstraction (so
it is swappable) and only after explicit review.

> **Consistency note (2026-07-12):** this "don't embed lock-in" policy has a sibling that extends it to
> ichiflow itself — **ichiflow is fully open source, Apache-2.0/MIT, with no gated features**
> ([0022](0022-fully-open-source.md)). The two are one stance: refuse to embed lock-in *and* refuse to
> be lock-in. What older docs called an "enterprise/compliance pack" is a **compliance profile — an
> open-source, optional install**, never a paid gate.

**Avoid-list (with the specific reason each fails):**

| Avoid | Reason | ichiflow choice instead |
|---|---|---|
| **Camunda 8** | Since v8.6 production self-managed needs a **paid Camunda Enterprise license** (Camunda License v1, non-prod-free only) — embedding it makes *customers* liable (research 02 §6, §7) | Temporal (MIT) [0003](0003-temporal-durable-execution-substrate.md); Flowable (Apache-2.0) as hedge |
| **Liquibase 5** | Community moving to **Functional Source License (FSL)** — not OSI-open; a lock-in/rug-pull signal Keycloak and others flagged (research 06 §A.4) | Atlas + pgroll + Flyway Community [0014](0014-map-first-migrate-last.md) |
| **KurrentDB (ex-EventStoreDB)** | License moved to **Kurrent License v1 (source-available, not OSI-open)** — needs legal review before embedding/distributing (research 05 §1.5) | Marten-on-Postgres / PG-native audit log; Axon option [0011](0011-decisionrecord-and-selective-event-sourcing.md) |
| **openapi-fetch / openapi-react-query** | **Maintenance mode** — do not build new runtime clients on them (research 03 §4.2, risk 3) | hey-api (pinned) / orval 8 [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md) |

**Also flagged by research as licensing/continuity hazards** (avoid as *core* dependencies, guard behind
abstractions): **Restate (BUSL-1.1)** (research 02 §7); **Amazon QLDB (EOL July 2025)** — do not build on
it (research 05 §1.5); **Redpanda Connect premium connectors** (BSL/Enterprise-gated post-acquisition) —
pin to MIT/Apache connectors (research 04 §A.2.4, §A.4); **Stainless** (hosted SDK generator wound down
post-Anthropic acquisition — do not design around it; Speakeasy is the commercial fallback) (research 03
§3.3); **Datafold OSS `data-diff`** (EOL — build first-party reconciliation) (research 06 §A.6.1);
**Talend Open Studio** (discontinued Jan 2024) (research 06 §A.5.2).

**Enforcement:** a **CI license allowlist gate** scans every dependency (and, per research 04 §A.4, every
Redpanda Connect connector) and fails the build on any license outside the allowlist or on the avoid-list.
Open-core dependencies kept for capability (Atlas) must have their open-core boundary watched, and every
portable artifact (DMN, Flow DSL, mappings, schemas) kept as plain data so the engine underneath is
swappable.

## Alternatives considered

- **No formal policy — evaluate licenses case by case.** Rejected — the research shows license *changes*
  are frequent and easy to miss (Camunda 8.6, Liquibase 5 FSL, EventStore→Kurrent KLv1, Redpanda connector
  gating). Without a machine-enforced gate, an OSS build could silently pull a gated/source-available
  dependency (research 04 §A.2.4).
- **Permit source-available (BUSL/FSL/KLv1) substrates in core.** Rejected — these push restrictions onto
  self-hosting customers, directly contradicting the self-hostable, anti-lock-in mandate; allowed only
  behind a swappable SPI after legal review (research 02 §7, research 05 §1.5, research 06 §A.4).
- **Accept open-core (Camunda, commercial gating) for turnkey features.** Rejected for *embedded* engines
  — the downstream fee is the disqualifier; open-core is tolerated only where the open core alone is
  sufficient and the boundary is watched (Atlas).

## Consequences

Positive:
- Customers can self-host (incl. air-gapped) with no surprise production fees or EOL cliffs.
- The CI allowlist makes license drift a build failure, not a legal surprise months later.
- Reinforces anti-lock-in: portable artifacts + swappable engines end to end.

Negative / costs:
- **The allowlist has ongoing maintenance cost** and can block a genuinely-better tool on license grounds,
  occasionally forcing a more-effort in-house build (first-party reconciliation harness vs data-diff;
  building governance UX vs BAMOE).
- **Open-core boundaries must be actively watched** (Atlas today; any dependency can change license
  tomorrow, as several did in 2024–2026) — vigilance, not a one-time check.
- Some capabilities (turnkey business governance, some premium connectors) are deliberately foregone or
  rebuilt to stay license-clean.

## References

- Research 01 §9 (Apache KIE incubation / BAMOE), 02 §6–§7 (Camunda 8, Restate), 03 §3.3/§4.2 (Stainless, openapi-fetch), 04 §A.2.4/§A.4 (Redpanda connector gating), 05 §1.5 (KurrentDB, QLDB), 06 §A.4/§A.5.2/§A.6.1 (Liquibase FSL, Talend, data-diff)
- Related: every ADR; especially [0003](0003-temporal-durable-execution-substrate.md), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md), [0011](0011-decisionrecord-and-selective-event-sourcing.md), [0014](0014-map-first-migrate-last.md), [0022](0022-fully-open-source.md) (ichiflow itself fully OSS — the consistent sibling)
