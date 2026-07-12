# 0017 — The v1 kernel cut and the governance-level dial

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: design review 2026-07 (scope critique)
- Research: [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md), [../research/06-migration-and-onboarding.md](../research/06-migration-and-onboarding.md)

## Context

The locked decisions describe an ambitious end-state: a polyglot substrate, fully-governed artifact
classes, three build-time Copilots, and a compliance-grade audit stack. A design review found that,
while most "duals" are already honestly phased (ZEN later, Zitadel later), several items are
over-scoped **for v1** if taken as day-one requirements: full governance ceremony imposed on every
team, three Copilots built simultaneously, and three simultaneous heavy audit/compliance stacks. The
review also observed there was no explicit, ruthless statement of *what a first shippable ichiflow
actually is*, so phasing was implicit and inconsistent across docs.

## Decision

Define an explicit **v1 kernel**, a **v1-optional** ring (ships, off by default, behind SPIs), and a
**post-v1** ring, and thread this phasing through the docs (phasing overview in
[00](../architecture/00-vision-and-principles.md) §5.1 and
[01](../architecture/01-system-overview.md) §6; each deep-dive doc's phasing table aligned).

**v1 kernel** = schema core (TypeSpec→OpenAPI/JSON Schema) + Decisions (DMN/Drools behind the SPI) +
Flows/Cases (interpreter, human-task/SLA/escalation) + the **domain entity store**
([0018](0018-domain-entity-store.md)) + **one Portal** archetype (back-office) + **basic Adapters**
(native REST, **one** message broker, webhook) + DecisionRecord / *why* API + the Dev tier.

**Governance-level dial.** Governance ceremony (approval-Flows, released baselines, coverage gates,
effective-dating, formal analysis) is a **per-Workspace dial**, not a fixed constant, with defaults
by tier:

| Tier | Default governance level | Meaning |
|---|---|---|
| **Dev** | **off** | git is the whole governance surface; no governance states, no gates — the framework imposes nothing |
| **Team** | **light** | `draft`/`released` states; approval = PR merge; coverage advisory, not gating |
| **Enterprise** | **full** | approval-Flows, immutable released baselines, coverage thresholds, effective-dating, formal analysis |

(The `standard` level — governance states + PR approval + optional coverage gates — remains available
as an opt-in middle for Team; see [03](../architecture/03-decision-layer.md) §5.6.)

**Copilots are post-v1.** All three Copilots (Domain Modeling, Migration, Rule Authoring) and the
UI/Design Copilot ship **after** v1. Critically, the artifacts they assist with are **plain
declarative data**: Ring-0 migration mapping is data (authorable by a human or agent without the
Migration Copilot), DMN is authored directly, uischema/pageschema are authored directly. Brownfield
adoption therefore survives the deferral. In v1, assistance is the AI-chat authoring doctrine
([0019](0019-ai-chat-first-authoring.md)), not a packaged Copilot.

**Compliance-pack items are an Enterprise pack, not v1-core:** OpenLineage / BCBS-239 lineage,
the wide-event store (ClickHouse/Honeycomb-class), and trigger-based bitemporal history on audited
tables. v1 "as-of" is served by Temporal replay + append-only records + effective-dating; Postgres is
the v1 audit/analytics default.

## Alternatives considered

- **Ship the full end-state as v1.** Rejected: it makes a solo dev's laptop hold a JVM+Go+Node server
  farm and imposes crushing governance on a 3-person team — contradicting the "productive in minute
  one" and "same code, config only" promises. The end-state is retained as the *target*, reached by
  the v1-optional / post-v1 rings.
- **No governance dial (one fixed posture).** Rejected both ways: full-for-everyone is crushing for
  small teams; light-for-everyone is unacceptable for regulated adopters. A tier-defaulted dial serves
  both without forking the code.
- **Keep the Migration Copilot in v1.** Rejected: it is a multi-quarter product (legacy
  introspection + rule mining + parity harness + guardrails). Deferring it costs nothing at adoption
  because Ring-0 mapping is data.
- **Fold compliance/lineage into the core.** Rejected: OpenLineage/BCBS-239 is niche (bank risk-data
  aggregation); bundling it taxes every adopter for a feature few need. It becomes an opt-in pack.

## Consequences

Positive:
- A crisp, defensible "what is v1" that a laptop can actually run, with every deferral justified and
  reversible behind an SPI or a dial.
- Governance scales with the adopter; the framework is neither toy-loose nor enterprise-heavy by fiat.
- Brownfield and design on-ramps survive Copilot deferral because their inputs are declarative data.

Negative / costs:
- The docs must carry consistent phasing markers (v1-kernel / v1-optional / post-v1) and stay in sync
  — a maintenance discipline.
- "Off" governance at the Dev tier means a dev can ship an ungoverned change; promotion to Team/
  Enterprise re-imposes ceremony, so a change that was easy in Dev may need rework to clear `full`.
- Deferring the Copilots means v1's assistance story leans entirely on the AI-chat doctrine and the
  in-repo agent kit; the packaged Copilot UX arrives later.

## References

- Design review 2026-07 (scope critique): dev-tier footprint, v1 authz dual, governance dial, Copilot
  scope, compliance-pack phasing.
- Related: [0002](0002-pluggable-decision-engine-spi-drools-default.md),
  [0010](0010-hybrid-authorization-openfga-plus-policy.md) (v1 authz phasing),
  [0011](0011-decisionrecord-and-selective-event-sourcing.md),
  [0014](0014-map-first-migrate-last.md) (Ring-0 mapping as data),
  [0018](0018-domain-entity-store.md), [0019](0019-ai-chat-first-authoring.md).
