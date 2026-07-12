# 0017 — The v1 kernel cut and the governance-level dial

- Status: accepted (amended 2026-07-12)
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: design review 2026-07 (scope critique); founder interview 2026-07 (multi-tenancy scope; v1 acceptance test)
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

**Compliance-profile items are post-v1, not v1-core:** OpenLineage / BCBS-239 lineage, the wide-event
store (ClickHouse/Honeycomb-class), and trigger-based bitemporal history on audited tables. These form
the **compliance profile — an open-source, optional install ([0022](0022-fully-open-source.md)), not a
paid pack.** v1 "as-of" is served by Temporal replay + append-only records + effective-dating; Postgres
is the v1 audit/analytics default.

## Amendment (2026-07-12) — kernel is single-org; v1 acceptance is two real exercises

Two founder-interview decisions refine the kernel scope and its acceptance bar:

**Multi-tenancy: single-org per deployment in v1, seams designed now.** The v1 kernel serves **one
organization per deployment**; hosted multi-tenant (many orgs on one deployment) is a **later**
capability. The seams are built now so that step is not a rework: **`tenant_id` discipline** in
schemas/persistence, **per-Portal IdP isolation** (already present,
[06](../architecture/06-identity-and-access.md) §1.1), and **entitlement scoping** under a tenant
([06](../architecture/06-identity-and-access.md) §2.2, Part 3). This keeps v1 scope honest without
foreclosing hosted multi-tenant.

**v1 acceptance = TWO required exercises, both passing on the actual kernel** (not a feature
checklist):

1. **The reference product, end-to-end.** The canonical outdoor-event-permit product
   ([../examples/creating-a-permit-product.md](../examples/creating-a-permit-product.md)) runs with
   every layer real — schemas → decisions → flows → portal → audit → `ichiflow-mcp` debug — not mocked:
   a permit flows arrival-to-resolution and an agent debugs a stuck case through the *why* API.
2. **The migration exercise — in *and* out.** A **generic** legacy source (a database-and-spreadsheet
   permitting/casework system with existing data and rules — **no real system named**) goes through
   the brownfield path ([0014](0014-map-first-migrate-last.md),
   [11](../architecture/11-migration-in-and-out.md)): **Ring 0 declarative mapping** over the existing
   DB (zero/additive DDL), legacy rules **re-expressed as DecisionModels**, and **decision-parity
   testing** against a **golden dataset of historical outcomes**. The **exit story** is verified on the
   same Workspace — export DMN / Flow JSON / schemas / data and demonstrate they are consumable outside
   ichiflow. Anti-lock-in is a core promise, so **migration in and out are both on the acceptance bar.**

(Public-sector-first design target and the canonical reference product: [0023](0023-public-sector-first.md).)

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
  [0014](0014-map-first-migrate-last.md) (Ring-0 mapping as data; migration acceptance),
  [0018](0018-domain-entity-store.md), [0019](0019-ai-chat-first-authoring.md),
  [0022](0022-fully-open-source.md) (tiers = capability profiles, not editions),
  [0023](0023-public-sector-first.md) (public-sector-first; canonical reference product).
