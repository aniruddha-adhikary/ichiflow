# 0031 — Set-level Cases: the `cohort` and `bundle` shapes

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) (batch/scheduled triggers, fan-out/fan-in on the durable substrate), [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md) (DecisionRecord keying, set-level audit)
- Basis: gaps surfaced by the public-housing-ballot case study (its G4 — cohort barrier + cohort-scoped DecisionRecord) and the multi-agency-licensing case study (its G2 — computed heterogeneous sub-Case set + partial-tolerant bundle). Licensing explicitly recommended **one ADR** covering both points on a single "set-level Case" design.

## Context

The Case/DecisionRecord model is **per-`case_id`**: one unit of work, one causal chain. Two delivered
case studies need work that is inherently **set-level**, and they need it in two *different* ways:

- **public-housing-ballot** runs a **ballot**: it must see the **entire frozen roster at once** and emit a
  **single global ordering**. The `batch` trigger ([04](../architecture/04-flow-and-case-layer.md) §2.4)
  fans a schedule out into *independent* per-Case sub-flows, but there is no first-class "gather all Cases
  in cohort C, run one set-level step, scatter results back" barrier, and the seed / roster-hash /
  allocation belong to the **exercise**, not to any one application — so today they must be smeared across
  N per-Case records. This is **fan-in to one set-level decision**.

- **multi-agency-licensing** runs a **guided journey** that computes, per applicant, a **set of distinct
  licence applications**, each a full Case in its own right (its own agency Flow, its own SLA, renewing
  independently years apart), bound together only for the applicant's dashboard. Three approve and one is
  rejected and the applicant proceeds with the three — **partial approval is a valid end state**. This is
  **fan-out to N independent decisions + a status roll-up**, and it is explicitly **not** a
  `CompositeOutcome` (which composes N Outcomes into **one gated decision on one Case**).

These are **adjacent but different families**, and both reveal the same underlying miss: no
**set/parent-level artifact** keyed above `case_id`.

## Decision

Introduce **two set-level Case shapes** on one design, defined in
[04](../architecture/04-flow-and-case-layer.md) §5.10:

### (a) `cohort` — a gather-barrier Flow shape

A **cohort Flow** adds an explicit **gather-barrier** over a **case selector**: it gathers all member
Cases in cohort *C* (a `find_cases`-style selector, e.g. `exercise:${exerciseId}`), runs **one set-level
step** — a set-level **Decision** or `compute` over the whole set (the ballot ordering, the round ranking)
— then **scatters** the result back to member Cases. It carries a **bounded fan-in guardrail** (the
set-level step must not silently load 50,000 Cases without a declared cap).

The cohort emits a **cohort-scoped DecisionRecord** keyed by the **`cohortId`** (`exerciseId` / `roundId`)
that member Cases **reference** ([08](../architecture/08-audit-and-observability.md) §1.7). "Prove my queue
number / my rank" resolves to **one** cohort record every member points at, not N copies of a shared fact.
The cohort barrier composes with the `QuotaLedger` **ranked draw** (ADR-0030) — the round ranking is the
set-level step that draws down the pool.

### (b) `bundle` — a computed heterogeneous sub-Case fan-out

A **bundle Flow** is a long-lived **parent Case** whose children are a **computed, heterogeneous** set:
a `forEach` over a computed selection spawns **one sub-Case per element, each of a different `caseType`**,
resolved through the **CaseType catalog** ([02](../architecture/02-schema-foundation.md) §10), each running
its element's own Flow with its own SLA and its own independent lifecycle. The join is a **partial-tolerant
status roll-up view** — an aggregation, **not** an outcome composition: a `partial` bundle (some children
approved, some rejected) is a first-class, non-gated end state. The parent DecisionRecord **references**
(never merges) its child records ([08](../architecture/08-audit-and-observability.md) §1.7).

### Cohort vs bundle — the line

| | `cohort` | `bundle` |
|---|---|---|
| Direction | **fan-in** to one set-level decision | **fan-out** to N independent decisions |
| Shared computation | yes — one ordering/ranking over the set | none — each child decides on its own |
| Set-level record | **cohort record** (one shared computation) | **bundle parent record** (references children) |
| Join | gather-barrier + scatter | partial-tolerant status aggregation |
| Not to be confused with | `batch` trigger (independent per-Case fan-out) | `CompositeOutcome` (N Outcomes → one gated decision) |

Both are declared Flow shapes; both inherit durability, replay-audit, and version pinning like any Flow.

## Alternatives considered

- **Force the ballot through the `batch` trigger + a `compute` over the whole collection (status quo).
  Rejected.** The interpreter has no native gather-barrier or bounded-fan-in guardrail, and the shared
  ballot facts have nowhere to live but N per-Case records. The set-level *decision* and the set-level
  *record* are both first-class needs.
- **Model the licence bundle as a `CompositeOutcome`. Rejected — a category error.** `CompositeOutcome`
  aggregates N per-authority Outcomes into **one gated determination on one Case** (customs'
  `all-must-approve`); a licence bundle is **N independent Cases** whose outcomes are **displayed together
  but never joined**, where partial approval is normal. Composition ≠ container.
- **One unified "set-level Case" primitive covering both. Rejected.** Fan-in-with-shared-computation and
  fan-out-with-no-shared-computation are genuinely different execution shapes and different record shapes;
  collapsing them would blur the cohort-record-vs-bundle-record distinction the audit story depends on.
  One ADR, two named shapes.
- **A cohort as just a parent Case with children (i.e. reuse `bundle` for both). Rejected.** A cohort's
  defining feature is the **barrier + one shared computation over the whole set**; a bundle's defining
  feature is **no shared computation**. Reusing one for the other loses exactly the barrier semantics the
  ballot needs.

## Consequences

Positive:
- The **ballot / mass-allocation** class (school places, visa lotteries, oversubscribed clinics) gets a
  first-class gather-barrier + cohort record; the **multi-product bundle** class (whole-of-government
  licensing, any "apply for several things at once") gets a first-class partial-tolerant parent.
- The **cohort record** kills the "smear one fact across 50,000 records" anti-pattern; the **bundle parent
  record** gives a clean "one dashboard over N heterogeneous children" without faking a composition.
- Composes cleanly with adjacent primitives: cohort + `QuotaLedger` ranked draw (ADR-0030); bundle +
  CaseType catalog (ADR-0033 / doc 02 §10) for heterogeneous `caseType` resolution.

Negative / costs:
- The **bounded-fan-in guardrail** for very large cohorts (tens of thousands of Cases in one set-level
  step) needs a concrete cap + chunking policy; its interaction with Temporal history size is an
  **Open question** (doc 04 §5.10), tracked with the long-history mitigation question.
- Set-level records add a **second keying axis** (`cohortId` / bundle-parent `case_id`) above `case_id`;
  the *why* API and task-inbox grouping must present "one logical Case/cohort over N flows" (already the
  Case-vs-Flow-cardinality open question, doc 04).
- A `bundle` overlaps conceptually with **Case associations** (ADR-0032) but is distinct: a bundle owns
  its computed children; an association links otherwise-independent peer Cases. The docs draw that line
  explicitly to prevent misuse.

## References

- [04-flow-and-case-layer.md](../architecture/04-flow-and-case-layer.md) §5.10 (cohort + bundle), §2.4
  (the `batch` trigger these extend), §2.3 (CompositeOutcome — what a bundle is *not*), §5.6 (parent/child
  correlation — distinct from both)
- [08-audit-and-observability.md](../architecture/08-audit-and-observability.md) §1.7 (cohort-scoped +
  bundle parent DecisionRecords)
- [02-schema-foundation.md](../architecture/02-schema-foundation.md) §10 (CaseType catalog the bundle
  fan-out resolves through)
- [13-agent-harness-loops.md](../architecture/13-agent-harness-loops.md) §2.m (set-level harness vectors)
- Case studies: [public-housing-ballot](../examples/case-studies/public-housing-ballot.md) §4 / G4
  (cohort), [multi-agency-licensing](../examples/case-studies/multi-agency-licensing.md) §2.4 / G2 (bundle)
- Related: [0030](0030-quota-ledger.md) (ranked draw runs under the cohort barrier),
  [0032](0032-case-association.md) (peer links — distinct from a bundle's owned children),
  [0033](0033-packaging-and-placement.md) (CaseType catalog for heterogeneous fan-out)
