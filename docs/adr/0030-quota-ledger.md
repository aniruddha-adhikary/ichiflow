# 0030 — `QuotaLedger`: a first-class multi-dimensional resource ledger

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/03-schema-and-types.md](../research/03-schema-and-types.md) (governed artifact classes, versioning, effective-dating), [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md) (DecisionRecord, append-only ledger, outbox), [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) (durable side-effect memoization on replay)
- Basis: gap surfaced by the public-housing-ballot validation case study (its G2 — "the single most important missing primitive") and **independently confirmed** by the competitive-grant case study (its D4/G3, from a monetary, ranked-draw domain).

## Context

Some Cases consume a resource **another Case needs**. The permit reference product's fee pool and a
single "grants budget" are scalar counters, but two delivered case studies break that:

- **public-housing-ballot** needs `(project, block, ethnicGroup)` × `(project, block, SPR)` ×
  `(project, scheme)` headroom with a hard invariant — **no dimension may go below zero, ever, under
  concurrent selection appointments** — with **TTL'd reservations** (a selection appointment holds a
  reservation for 120 minutes) that `commit` on booking or `release` on expiry/decline.
- **grant-program** needs a **monetary** round budget (`capacity − committed − reserved ≥ grantAmount`,
  not `headroom ≥ 1`), consumed by a **ranked draw** down the funding line, with **release-back reflow**
  when a clawback or under-claim returns money to a closed round.

Modelled with what existed, each was an ad-hoc `compute` activity over a Postgres table guarded by
hand-written SQL. That works mechanically but puts the **fairness invariant outside the audited artifact
layer** — "headroom never negative" is enforced by SQL the *why* API and the harness do not understand,
and the movements are not first-class DecisionRecord events. Two independent domains reaching for the
same missing primitive is the signal this is core, not a per-app concern.

## Decision

Introduce a first-class **`QuotaLedger`** artifact — a governed, **Team-owned**, effective-dated resource
ledger, a sibling of `CodeSet` ([02](../architecture/02-schema-foundation.md) §9), with reservation-based
consumption on the DecisionRecord / append-only-outbox spine ([08](../architecture/08-audit-and-observability.md)
§2.2). It is defined in [04](../architecture/04-flow-and-case-layer.md) §5.9.

1. **Declared dimensions + capacity rows.** A ledger declares **dimensions** — composite keys such as
   `[project, block, ethnicGroup]` — and per-dimension **capacity rows** that are **CodeSet-like**:
   effective-dated, owned by a Team with named stewards, and semver-versioned/governed (so a scheduled
   capacity change is a governed, effective-dated row change, not a redeploy). The capacity version used
   is pinned into the DecisionRecord at commit.

2. **Invariants enforced at the ledger, not in hand-written SQL.** A ledger declares **invariants** per
   dimension (`headroom >= 0`, `committed <= capacity`, `consumed <= reserved`). They are enforced
   **atomically by the ledger** on every movement — the governed contract the *why* API and the
   concurrency harness ([13](../architecture/13-agent-harness-loops.md) §2.l) understand, replacing the
   application's hand-written guard.

3. **Atomic `reserve` / `commit` / `release` from Flow steps.** The three operations are invoked from a
   Flow via a canonical **`quota-op`** step (`op: reserve | commit | release`). `reserve` is atomic and
   TTL-bearing (a held reservation that auto-expires); `commit` converts a reservation to consumption;
   `release` returns a reservation (expiry / decline / clawback). Because these are **side-effecting and
   invariant-guarded**, they follow the **same exactly-once-memoized-on-replay discipline as
   `issue-document` number allocation** (ADR-0029): the interpreter memoizes each mutation keyed by
   `(case_id, step.id)`, so replay and continue-as-new never double-consume. This is why `quota-op` is a
   **canonical** step, not a `compute`-variant (§2.6/§2.7 of doc 04) — a pure activity cannot host a
   memoized shared-state mutation under an invariant. It **replaces** the case studies' interim
   `compute`-ref modeling (`kt://…/QuotaReserve@1.0.0`).

4. **Monetary amounts are a dimension kind.** A dimension may be **`kind: monetary`**, whose reservation
   is a **variable-size amount** and whose fit test is `capacity − committed − reserved ≥ amount`. This is
   what lets a grants budget pool be the same primitive as a count-based block quota, and the ledger pins
   the **rate version per commit** (a grant amount is `requested × fundingRate@version`).

5. **Ranked reserve-list draw + declared release-back reflow.** A ledger supports a **ranked draw**: a
   set-level operation ranks candidates and draws down the pool in rank order until it is exhausted; those
   below the line fall onto a **reserve list** (a first-class, coded end state distinct from a quality
   failure). Release-back is governed by a **declared reflow policy** (e.g. `next-in-ranked-order`,
   `next-round`, `treasury`) — the primitive *models* the reflow choice rather than leaving it to
   ad-hoc code, because whether released money reflows to the reserve list, the next round, or treasury is
   a real fairness question. The ranked draw is a set-level operation and composes with the cohort
   gather-barrier (ADR-0031).

6. **Every movement is an audited event.** `reserve` / `commit` / `release` / `draw` / `void` each emit a
   DecisionRecord event with the ledger key, the delta, the resulting headroom, the pinned capacity
   version, and the acting principal — replay-visible, so "why couldn't I book / where did this money go"
   is answerable through the *why* API.

A **concurrency harness** ([13](../architecture/13-agent-harness-loops.md) §2.l) red-teams the invariant
under simulated parallel `reserve`/`commit`/`release` (contention vectors), plus the monetary,
ranked-draw, and release-back reflow vectors.

## Alternatives considered

- **Keep it as ad-hoc `compute` over a Postgres table (status quo). Rejected.** Mechanically adequate but
  the fairness invariant lives in hand-written SQL outside the governed artifact layer — not
  replay-visible, not harness-checkable, not queryable via the *why* API. The two case studies show this
  is load-bearing compliance state, not incidental data.
- **Model the ledger as a `CodeSet`. Rejected.** A `CodeSet` is versioned reference *data* read at
  `id@version`; a `QuotaLedger` is **mutable consumed state** with atomic invariants and TTL'd
  reservations — a different lifecycle. Capacity rows are CodeSet-*like* (governed, effective-dated,
  owned) and reuse that machinery, but the ledger's consumption is runtime business data on the audited
  runtime path (BRIEF §21a), never git.
- **A new canonical step per operation (`reserve` / `commit` / `release` as three step types). Rejected.**
  One `quota-op` step with an `op` discriminator keeps the closed step set small and the memoization
  discipline uniform; three near-identical step kinds would fragment it.
- **Bury the invariant in the decision layer (a DMN over headroom). Rejected.** A Decision is a pure
  evaluation with no side effects ([03](../architecture/03-decision-layer.md) §3); it can *read* headroom
  to route (the ballot's `eip-selection-check`) but cannot *consume* it. Consumption is a memoized side
  effect the Flow owns — emit-then-persist, the same category rule as reserve-writing in the insurance
  case.

## Consequences

Positive:
- One primitive carries **dimensions + invariants + reserve/commit/release + monetary + ranked-draw +
  reflow + audit** for every shared-resource domain (block quotas, budget pools, licence caps), on the
  existing audit spine, with a concurrency harness that proves the invariant.
- The **fairness invariant becomes a governed contract** — pinned, replay-visible, harness-red-teamed —
  rather than SQL a reviewer must trust.
- Reuses the **exactly-once-memoized** discipline already built for `issue-document` (ADR-0029), so there
  is one mental model for "the interpreter owns the durable side effect; the declarative artifact declares
  its shape."

Negative / costs:
- The interpreter gains **another side-effecting, replay-sensitive** step; `gap-free`-style atomic
  serialized allocation under contention has a throughput cost (mitigated: the memoization reuses the
  durable-side-effect discipline; the concurrency harness is the gate).
- **Reflow policy is only partly specified.** The primitive declares a reflow policy *hook*; the full
  vocabulary of reflow targets and the governance of **cross-round** reflow (returning money to a closed
  round) is an **Open question** (doc 04 §5.9) — flagged rather than invented.
- A ledger's capacity rows add another governed artifact class to the catalog and its own change-approval
  cadence.

## References

- [04-flow-and-case-layer.md](../architecture/04-flow-and-case-layer.md) §5.9 (the `QuotaLedger` +
  `quota-op` step), §5.10 (ranked draw composes with the cohort gather-barrier), §2.9.1 (the
  exactly-once-memoized allocation discipline this reuses)
- [02-schema-foundation.md](../architecture/02-schema-foundation.md) §9.1 (CodeSet-like governed,
  effective-dated, owned rows), §11 (runtime state vs reference data)
- [08-audit-and-observability.md](../architecture/08-audit-and-observability.md) §2.2 (append-only ledger
  + outbox), §4.6 (movement events)
- [13-agent-harness-loops.md](../architecture/13-agent-harness-loops.md) §2.l (concurrency harness)
- Case studies: [public-housing-ballot](../examples/case-studies/public-housing-ballot.md) §2.4 / G2
  (source), [grant-program](../examples/case-studies/grant-program.md) §2.4 / G3 (confirmation: monetary,
  ranked draw, release-back)
- Related: [0029](0029-document-issuance.md) (the exactly-once-memoized side-effect discipline + canonical
  step reasoning this reuses), [0025](0025-reference-data-ownership-and-teams.md) (owning-Team governance
  for capacity rows), [0031](0031-set-level-cases.md) (the cohort barrier the ranked draw runs under)
