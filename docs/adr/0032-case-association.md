# 0032 — `Case association`: first-class peer links between Cases

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) (PDP scoping, ReBAC relations), [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md) (DecisionRecord, audited relations)
- Basis: gap flagged as "the single hardest thing this case study surfaces" by the motor-insurance-claim case study (its gap 1 — one SIU investigation spanning multiple independent claim Cases) and **independently confirmed** by the competitive-grant case study (its G1 — one org's portfolio: active-award caps and double-funding constraints spanning Cases).

## Context

ichiflow already relates Cases in two ways, and both are the wrong shape for a class of real needs:

- **Parent → child correlation** ([04](../architecture/04-flow-and-case-layer.md) §5.6) — appeal /
  correct / withdraw child Cases referencing a parent's DecisionRecord. This is a **hierarchy**, one Case
  derived from another.
- **`batch` fan-out** ([04](../architecture/04-flow-and-case-layer.md) §2.4) and now the **`bundle`**
  parent (ADR-0031) — a parent owning a computed set of children.

Neither expresses a **peer, many-to-many** relationship among Cases that are **otherwise independent**:

- **motor-insurance-claim**: one **SIU investigation** spans **multiple independent claim Cases** (a
  provider anomaly linking two claims from *different* policyholders). The investigation must be readable
  **across** the linked claims **without collapsing their separate ownership/audit boundaries**.
- **grant-program**: an applicant org's **portfolio** — "no more than N active awards at once," "the same
  cost cannot be double-funded across two grants" — are **invariants that span peer Cases**, not a
  hierarchy and not a bundle.

Today these are handled by ad-hoc queries outside the artifact layer, with the cross-Case constraint and
its visibility scope living nowhere governed.

## Decision

Introduce a first-class **`Case association`** — a governed, **typed, many-to-many peer link** between
Cases, defined in [04](../architecture/04-flow-and-case-layer.md) §5.11:

1. **Typed link kinds.** An association declares a **kind** from a governed vocabulary —
   `investigation-group`, `portfolio-of-applicant`, `duplicate-suspect`, … — so *why* two Cases are
   linked is itself typed and explainable, not an untyped edge.

2. **PDP-scoped visibility, its own boundary.** An association is a **first-class relation in the OpenFGA
   graph** with its **own visibility scope** ([06](../architecture/06-identity-and-access.md) Part 4):
   membership in an `investigation-group` grants an investigator read across the linked claims **without
   merging their ownership** — each Case keeps its own owner/audit boundary, and a workshop or claimant on
   one Case gains no visibility into the other. Reading across an association never collapses the linked
   Cases' separate isolation.

3. **Audited link / unlink.** Creating or removing a link is an **audited event** (who linked what, when,
   why-coded); the association carries **its own DecisionRecord / audit trail**, distinct from the linked
   Cases' records ([08](../architecture/08-audit-and-observability.md) §1.6-adjacent relation events).

4. **Cross-Case invariant checks over the association set.** "This org is over its active-award cap,"
   "these two grants double-fund the same cost," "these two claims share a provider anomaly" are
   **invariant checks expressible over the associations + the entity store** — a governed check over the
   linked set, not a query buried in code. (Whether the check runs at **link time**, as a **scheduled
   Flow** over the portfolio, or both is an **Open question**, doc 04 §5.11.)

**Distinct from its neighbours** — the docs draw the lines explicitly:

- **vs parent/child correlation (appeal, §5.6)** — an association is **peer**, not derived; neither linked
  Case is the other's parent.
- **vs a `bundle` (ADR-0031)** — a bundle is a **parent's computed children** (one applicant's licence
  set); an association is a link among **otherwise-independent** Cases with no owning parent (two claims
  from different policyholders).

## Alternatives considered

- **Keep it as ad-hoc cross-Case queries (status quo). Rejected.** The cross-Case constraint and its
  visibility scope live nowhere governed; an SIU investigation spanning two Cases has no audited entity,
  and a double-funding invariant is un-pinnable. Two independent domains needing it makes it core.
- **Reuse parent/child correlation. Rejected.** Correlation is a hierarchy; forcing a peer investigation
  or a portfolio into a parent/child edge misrepresents the relationship and mis-scopes visibility (a
  child inherits from its parent; peers must not).
- **Reuse the `bundle` parent (ADR-0031). Rejected.** A bundle **owns** its children; an investigation
  does **not** own the claims it spans (they predate it and outlive it, owned by different Teams). Making
  the investigation a bundle-parent would wrongly collapse the claims' independent ownership.
- **A generic untyped "related cases" edge. Rejected.** Untyped links cannot carry a visibility scope or
  drive an invariant check; the **kind** is what makes the association explainable and enforceable.

## Consequences

Positive:
- **Fraud/investigation** (an SIU case over N claims) and **portfolio/eligibility** (active-award caps,
  double-funding) become first-class, audited, PDP-scoped — the cross-Case constraint is a governed
  artifact, not a hidden query.
- Cross-Case invariants (double-funding, over-cap) are **expressible over associations + the entity
  store**, so "why was this blocked" resolves to a link and a check, not a spreadsheet.
- Cleanly **distinct** from correlation and bundles, with the lines drawn in the docs to prevent misuse.

Negative / costs:
- Reading **across** an association without leaking is a real PDP design point: the association's
  visibility scope must grant exactly the cross-Case read the link intends and no more — a new relation
  shape the authz harness ([13](../architecture/13-agent-harness-loops.md) §2.f) must cover.
- **When** cross-Case invariant checks run (link time vs scheduled sweep vs both) is left as an **Open
  question** rather than invented; a portfolio-wide check is a set-level read whose cadence/cost needs
  measuring.
- Adds another relation kind to the OpenFGA model and another audited entity to the spine.

## References

- [04-flow-and-case-layer.md](../architecture/04-flow-and-case-layer.md) §5.11 (Case association), §5.6
  (parent/child correlation — distinct), §5.10 (bundle — distinct)
- [06-identity-and-access.md](../architecture/06-identity-and-access.md) Part 4 (PDP-scoped association
  visibility as an OpenFGA relation)
- [08-audit-and-observability.md](../architecture/08-audit-and-observability.md) §1.5-§1.6 (audited
  link/unlink + association DecisionRecord)
- Case studies: [motor-insurance-claim](../examples/case-studies/motor-insurance-claim.md) §8 (source —
  SIU across claims), [grant-program](../examples/case-studies/grant-program.md) §6 G1 (confirmation —
  portfolio invariants)
- Related: [0031](0031-set-level-cases.md) (bundle — a parent's owned children, distinct from peer links),
  [0025](0025-reference-data-ownership-and-teams.md) (the Team/PDP model the visibility scope rides on)
