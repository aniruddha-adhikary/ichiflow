# 0001 — Canonical rule representation is DMN 1.6 (DRD + FEEL)

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/01-rule-engines.md](../research/01-rule-engines.md), [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md)

## Context

ichiflow's mission includes **migration in AND out with no lock-in**. Decisions (rule-evaluated
determinations) are a core vocabulary object and must be portable, explainable, and authorable by
both business users and AI agents. The market offers many rule formats — Drools DRL, IBM ODM
BAL/BOM/XOM, FICO SRL, GoRules JDM, OpenRules spreadsheets — but almost all are vendor/engine
specific. Research 01 §5/§8 establishes that **DMN (Decision Requirements Diagram + FEEL) is the
only OMG-standardized, text/XML-serializable decision format with multiple independent conformant
engines** (Drools, Camunda, Trisotech all at TCK conformance level 3). FEEL is comparatively
LLM-friendly (readable, functional, well-specified), and DMN is already the interchange target every
serious vendor exports toward. Research 05 §1.3 adds that DMN "records rule evaluation paths" and is
"traceable and explainable," making it the right substrate for the DecisionRecord and adverse-action
reason codes (FCRA/ECOA, GDPR Art. 22).

## Decision

The canonical, source-of-truth representation for every ichiflow **DecisionModel** is **DMN 1.6
(DRD + FEEL)**, wrapped in a thin ichiflow envelope that adds metadata (owner, version, effective
dates), governance state (draft/reviewed/released), test cases, and provenance (source system +
extension map). Apache KIE 10.2 ships DMN 1.6 in editor and engine (research 01 §3.1).

Engine-native formats (DRL for inference/CEP, JDM for the edge) are permitted only as **quarantined
escape hatches**: they are import sources or deployment projections, never the source of truth. A
DecisionModel that uses a non-DMN projection records it explicitly in the envelope's provenance map so
governance, export, and differential testing can account for it.

Because **DMN interchange is not lossless** (research 01 §7), ichiflow adopts these mitigations as
first-class platform features:

- **Pin to TCK-conformant (L3) engines only**; reject "DMN-washing" tools that implement a subset.
- Ship an **import-validation + differential-test harness**: execute an imported model on ichiflow's
  engine and compare outputs against golden outputs from the source engine.
- **Prioritize semantic fidelity over diagram (DMN DI) fidelity** — the graphical round-trip is
  weaker than the semantic one.
- Store a **provenance/extension map** for any vendor extension or non-standard FEEL usage.

## Alternatives considered

- **Drools DRL as canonical.** Most expressive open rule language, but it is engine-bound, developer-
  facing, and has enough syntactic surface (accumulate, `from`, salience, no-loop) that LLM-generated
  DRL needs round-tripping (research 01 §3.1). It is not a neutral interchange standard — adopting it
  as canonical would re-introduce the lock-in ichiflow exists to eliminate. Rejected as canonical;
  retained as an import source and inference/CEP projection.
- **IBM ODM BAL/BOM/XOM.** The governance benchmark, but proprietary with **no clean, lossless export
  to any neutral format** (research 01 §3.2, §8.1). This *is* the lock-in ichiflow opposes. Rejected;
  relevant only as a (rule-mining) migration-IN source.
- **GoRules JDM as canonical.** Clean JSON, best AI-authorability, trivial round-trip — but it is a
  sequential decision graph with **no DMN conformance** and no independent second implementation
  (research 01 §3.4). Standardizing on JDM would trade one vendor format for another. Rejected as
  canonical; adopted as the edge deployment projection (see [0002](0002-pluggable-decision-engine-spi-drools-default.md)).
- **Keep everything engine-native, no canonical format.** Maximizes per-engine expressiveness but
  destroys the migration-in/out promise and forces per-engine governance. Rejected.

## Consequences

Positive:
- Strongest possible anti-lock-in / exit story: export DMN 1.6 XML runs on any TCK-L3 engine
  (research 01 §8.2); JDM export runs on ZEN; decision tables export to Excel/CSV.
- One explainable, standardized artifact feeds the DecisionRecord and "why" API ([0011](0011-decisionrecord-and-selective-event-sourcing.md)).
- FEEL + DMN decision tables are the most reliably LLM-authorable rule surface (research 01 §6).

Negative / costs:
- **DMN interchange is genuinely not turnkey-lossless** — FEEL ambiguities and vendor extensions mean
  identical FEEL can yield different results across engines. The differential-test harness is
  mandatory ongoing engineering, not a one-off.
- DMN's forward-chaining/inference and CEP expressiveness is weaker than DRL; genuinely inference-heavy
  or temporal models must drop to the quarantined DRL projection, which is not portable — an honest
  hole in the "everything is portable" story, scoped and provenance-tracked but real.
- Diagram round-trips are lossy; teams expecting pixel-perfect model interchange will be disappointed.
- Business-user authoring/governance UX around DMN is something ichiflow must **build**, not borrow —
  the biggest product investment vs ODM Decision Center (research 01 §6). Tracked in [0002](0002-pluggable-decision-engine-spi-drools-default.md).

## References

- Research 01 §5 (standards), §7 (interchange caveats), §8 (migration in/out), §8.3 (canonical rep)
- Research 05 §1.3 (DMN as provenance substrate), §1.6 (regulatory drivers)
- DMN TCK — https://dmn-tck.github.io/tck/
- Related: [0002](0002-pluggable-decision-engine-spi-drools-default.md), [0011](0011-decisionrecord-and-selective-event-sourcing.md), [0014](0014-map-first-migrate-last.md)
- **Amended by [0027](0027-dmn-authoring-projection.md)** on two points: (1) an LLM-friendly **decision
  source** projection covering the full DMN 1.6 surface compiles one-way to the canonical DMN XML
  (which stays the executed/exported artifact); (2) the engine-native escape hatches (DRL / rule units
  / CEP) are first-class **AI-authorable + testable** governed paths — quarantine marks *portability*,
  not authorability. The canonical-format-over-engine decision above is otherwise unchanged.
