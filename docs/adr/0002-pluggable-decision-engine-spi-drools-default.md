# 0002 — Pluggable Decision Engine SPI; Apache KIE / Drools default, GoRules ZEN second

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/01-rule-engines.md](../research/01-rule-engines.md)

## Context

[0001](0001-canonical-rule-representation-dmn.md) makes DMN 1.6 the canonical decision format and
treats every engine as an importer/exporter. That decision only pays off if the runtime **engine is
replaceable**. ichiflow also runs decisions in two very different places: a JVM/Kotlin core (rules
eval, flow workers — [0007](0007-kotlin-core-typescript-edges.md)) and TS/edge/serverless surfaces
that have no JVM. Research 01 §4 shows **no single engine is strong across all rows**: Drools wins on
inference/CEP/DMN-L3 breadth and open licensing but has *no* TypeScript story and weak business
governance UX; ZEN wins embeddability + AI-authorability + multi-runtime at the cost of inference
depth; ODM/Blaze win governance but are proprietary lock-in. The founder leans Drools/Kogito;
research 01 §1.2 validates that lean **for the engine tier** but rejects it as a monoculture.

## Decision

Define a **Decision Engine SPI** that accepts a canonical DMN 1.6 DecisionModel and returns a
structured result + fired-rule/evaluation trace (feeding [0011](0011-decisionrecord-and-selective-event-sourcing.md)).
Ship two reference engines behind it:

1. **Apache KIE / Drools — default/reference engine (JVM/Kotlin).** DMN TCK L3 with full FEEL, RETE/
   PHREAK forward-chaining inference, rule units, CEP (Fusion), PMML scoring; Apache-2.0; Quarkus-
   native; directly Kotlin-callable (research 01 §3.1). This is the JVM execution tier and the home
   for inference-heavy and temporal decisions.
2. **GoRules ZEN — planned second engine (TS/edge/embedded).** MIT-licensed Rust core with first-class
   Node/TS and Kotlin-JVM bindings executing JDM; tiny footprint, no server, edge/serverless friendly
   (research 01 §3.4). Serves decisions where no JVM is available. DMN↔JDM interchange bridges tiers.

ichiflow **builds its own governance, authoring, simulation, and explainability layer** over these
engines — this is the true gap versus IBM ODM Decision Center and the platform's biggest product
investment, not something borrowed from KIE Sandbox (a developer tool).

## Alternatives considered

- **Drools monoculture ("adopt Drools and be done").** Rejected. Research 01 §1.2/§10 is explicit: it
  is the *wrong default for authoring/governance UX* and a *poor default for the TypeScript edge*
  (Drools has no production-grade JS engine, only the dmn-js editor lineage). A monoculture also
  re-couples ichiflow to a single engine, defeating [0001](0001-canonical-rule-representation-dmn.md)'s
  anti-lock-in intent. The two-engine + canonical-DMN architecture is itself the mitigation that keeps
  Drools replaceable (research 01 §9).
- **IBM ODM as the engine.** Best-in-class turnkey governance and business-readable decision traces,
  RETE engine (research 01 §3.2). Rejected: proprietary per-core/VPC licensing (the cost driver
  pushing enterprises *off* it), and no neutral export — high lock-in and cost, the opposite of
  ichiflow's mandate. ODM remains a governance/feature *benchmark* and a top migration-IN source.
- **Camunda 8 DMN / camunda-engine-dmn.** Strong DMN + FEEL, and **dmn-js is the de-facto embeddable
  DMN editor** ichiflow may reuse for authoring (research 01 §3.3). Rejected as the runtime engine:
  weaker on RETE inference and CEP, and Camunda 8's platform licensing shifted commercial
  (cross-ref [0003](0003-temporal-durable-execution-substrate.md), [0016](0016-license-hygiene-policy.md)).
- **ZEN as the single/default engine.** Best AI-authorability and multi-runtime, but sequential
  decision-graph only — no RETE, no forward-chaining, no CEP/temporal windows (research 01 §3.4).
  Inadequate for classic "chained inference over working memory" enterprise logic. Kept as the second
  engine, not the default.

## Consequences

Positive:
- Right engine per tier: inference/CEP/PMML on Drools; embedded/edge on ZEN — without forking.
- Validates the founder's Drools lean where it is genuinely strong, while the SPI keeps it swappable.
- The governance/authoring layer ichiflow owns becomes a differentiator, not a dependency.

Negative / costs:
- **Two engines is real surface area**: FEEL semantics must be reconciled across Drools and ZEN's
  execution (JDM sequential vs DMN), enforced by the differential-test harness from [0001](0001-canonical-rule-representation-dmn.md).
- **Apache KIE is still in Apache incubation** (not yet a Top-Level Project mid-2026) and the paid
  safety net narrowed from Red Hat to IBM BAMOE (research 01 §3.1, §9). Mitigation: pin stable 10.x
  releases, keep the engine behind the SPI, rely on ichiflow's own support/governance layer, never
  depend on BAMOE.
- ZEN is a small vendor; JDM is the projection ichiflow controls, limiting blast radius.
- Building ODM-class governance/simulation is a large, ongoing investment ichiflow has now committed to.

## References

- Research 01 §1.2 (recommendation), §3.1 (Drools), §3.4 (ZEN), §4 (matrix), §6 (Drools weaknesses), §9 (risks)
- Apache KIE 10.2.0 — https://kie.apache.org/blog/kie_10_2_0_release/ · GoRules ZEN — https://github.com/gorules/zen
- Related: [0001](0001-canonical-rule-representation-dmn.md), [0005](0005-first-party-case-and-human-task-module.md), [0007](0007-kotlin-core-typescript-edges.md), [0016](0016-license-hygiene-policy.md)
