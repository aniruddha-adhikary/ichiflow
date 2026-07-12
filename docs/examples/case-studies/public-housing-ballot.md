# Design-validation case study — a public-housing ballot (Singapore HDB BTO)

> _**Genre note — this is a design-VALIDATION case study, not the reference product and not a
> shipped template.** It deliberately models a **real, publicly documented** allocation system —
> Singapore's Housing & Development Board **Build-To-Order (BTO)** flat application and ballot — to
> stress ichiflow's architecture against dimensions no other example covers: **auditable randomness**,
> **cross-Case shared quota state with fairness invariants**, **eligibility over a household graph**, and
> **mass-cohort (tens of thousands at once) processing**. The `BRIEF.md` §16 "**no real government
> system is named**" rule governs the **shipped reference product** and onboarding templates
> ([`../creating-a-permit-product.md`](../creating-a-permit-product.md)); it is deliberately relaxed
> here because the whole point of a validation case study is to pressure-test the design against a
> **known-hard external reality** whose rules are published in depth. Nothing here ships as an ichiflow
> product; this document exists to find gaps, and it does — see [Gaps](#gaps-honest-account)._
>
> _All domain facts are grounded in published HDB / Government of Singapore documentation as of
> **July 2026** and cited inline. Where a mechanism is described more precisely than HDB publishes
> (e.g. the internal PRNG construction), it is labelled a **plausible reconstruction** — ichiflow only
> needs to model *a* provably-fair ballot, not HDB's exact undisclosed implementation. Cross-references
> to the architecture use relative paths into [`../../architecture/`](../../architecture/)._

---

## 1. Why this domain, and what it stresses

The [permit walkthrough](../creating-a-permit-product.md) exercises the **per-Case** shape: one
application, one applicant, one decision, one audit trail. A BTO launch is a different animal, and it
breaks four assumptions that the per-Case examples never test:

| Dimension | What the permit example assumes | What a BTO launch forces | Owning arch doc |
|---|---|---|---|
| **Auditable randomness** | Every step is a pure function of Case inputs; deterministic replay is free | A **ballot** must inject entropy, be **provably fair**, and be **byte-reproducible by an external auditor years later** — entropy is the enemy of deterministic replay | [08 §6](../../architecture/08-audit-and-observability.md) |
| **Shared mutable state** | Each Case is independent; no Case consumes a resource another needs | Ethnic-allocation quotas, priority-scheme reservations, and the flat inventory itself are **consumed across Cases** with **hard fairness invariants**, along **per-block × per-ethnicity × per-scheme** dimensions | [04 §5](../../architecture/04-flow-and-case-layer.md) |
| **Rule input shape** | A Decision reads one flat application record | Eligibility runs over a **household graph** (citizenship mix, ages, family-nucleus relations, ownership history) — a set/graph input, not a scalar record | [03 §2.4](../../architecture/03-decision-layer.md) |
| **Unit of work** | One inbound command → one Case | **One launch = tens of thousands** of applications processed as a **cohort**: a batch eligibility screen plus a single **ballot event** that emits a global ordering, not N independent flows | [04 §2.4](../../architecture/04-flow-and-case-layer.md) |

Grounding facts used below (verify against source):

- **Income ceilings (2026):** family BTO **$14,000** gross monthly household income; **2-room Flexi**
  singles **$7,000**; extended/multi-generation families **$21,000** (1.5×); the **Enhanced CPF
  Housing Grant** uses a *separate* **$9,000** ceiling — eligible for a flat ≠ eligible for a grant.
  ([HDB — Income Ceiling](https://www.hdb.gov.sg/residential/buying-a-flat/new/eligibility),
  [HDB Feb 2026 BTO Annex B](https://www.hdb.gov.sg/-/media/hdb-pulse/news/2026/hdb-launches-9012-flats-in-february-2026-bto-and-sbf-exercises/Annex-B.pdf))
- **Citizenship / family nucleus:** at least one **Singapore Citizen (SC)**; SC+SC, SC+SPR, or a
  single SC ≥ 35 (2-room Flexi only, **Single Singapore Citizen Scheme**); **Joint Singles Scheme**
  (two+ singles ≥ 35); two SPRs and SC+foreigner **cannot** buy BTO.
  ([HDB — Eligibility](https://www.hdb.gov.sg/residential/buying-a-flat/new/eligibility))
- **Priority schemes & ballot chances (2026):** first-timers get more ballot chances and the bulk of
  supply (≈**95%** of 4-room-and-larger reserved for first-timers); **second-timers get half** the
  ballot chances; the **2-Ballot Chance** (2BC) doubles entries for first-timers unsuccessful from the
  3rd try; **FCS (Proximity)** — which **replaced the Married Child Priority Scheme + Senior Priority
  Scheme from July 2025** — reserves up to **30%** for applicants living within **4 km** of family;
  **Parenthood Priority Scheme** reserves up to **30%**; the **Third Child Priority Scheme** quota
  **doubles to up to 10%** (from 5%) **from June 2026**.
  ([HDB — Priority Schemes](https://www.hdb.gov.sg/residential/buying-a-flat/buying-procedure-for-new-flats/application/priority-schemes),
  [MyNiceHome](https://www.mynicehome.gov.sg/get-started/hdb-priority-schemes-guide/))
- **Ethnic allocation (EIP block/neighbourhood ratios):** Chinese **84% block / 78% neighbourhood**;
  Malay **22% / 16%**; Indian & Others **12% / 10%**; a separate **SPR cap of 8% per block** (combined
  across ethnicities, SCs exempt). Formally "EIP" is branded for the **resale** market, but the
  **same ethnic ratios are enforced at BTO flat selection** — a unit can be unbookable if your group's
  block quota is full. ([HDB — EIP/SPR Quota](https://www.hdb.gov.sg/residential/buying-a-flat/buying-procedure-for-resale-flats/plan-source-and-contract/planning-considerations/eip-spr-quota),
  [gov.sg explainer](https://www.gov.sg/explainers/hdb-s-ethnic-integration-policy--why-it-still-matters/))
- **Ballot mechanics & audit:** after the window closes, **random computer-generated queue numbers**
  are assigned; a **lower number selects earlier** but a queue number **confers no priority by itself** —
  priority lives in *shortlisting/pool* allocation. HDB runs "**rigorous audits**… auditing of the
  computerised process itself, and counter-checking of ballot results before release"; a Parliamentary
  answer put mis-categorised ballots at **< 0.1% of ~370,000** over five years.
  ([HDB — Balloting Process](https://www.hdb.gov.sg/about-us/news-and-publications/publications/hdbspeaks/balloting-process-for-buildtoorder-bto-flats),
  [HDB — Receive Ballot Results](https://www.hdb.gov.sg/cs/infoweb/hdb-flat-portal/buying-a-new-flat/get-help/receive-ballot-results))
- **Selection & non-selection:** at the **flat selection appointment** the applicant books a unit
  (ethnic/SPR quota checked **at that moment**; if the quota fills before the slot HDB SMS/emails "do
  not attend") and signs toward an **Agreement for Lease / Option**; a first-timer **invited but not
  booking loses first-timer priority for 1 year**, second-timers are **debarred 1 year**.
  ([HDB — Booking of Flat](https://www.hdb.gov.sg/residential/buying-a-flat/buying-procedure-for-new-flats/booking-of-flat))

---

## 2. Artifacts

### 2.1 Schemas — the household graph

The application is not a flat record; it carries a **member set** with typed relations. This is the
first stress: the eligibility input is a small graph.

```typespec
// contracts/src/bto.tsp  (authored via add-schema; doc 02 §1)
@jsonSchema
model FlatApplication {
  id: string;                                   // global correlation id → Case.case_id
  exerciseId: string;                           // the launch cohort, e.g. "BTO-2026-JUN"
  flatType: FlatType;                           // TWO_ROOM_FLEXI | THREE_ROOM | FOUR_ROOM | FIVE_ROOM
  scheme: FamilyScheme;                         // PUBLIC | FIANCE | JOINT_SINGLES | SSC | ORPHANS
  projectChoices: ProjectChoice[];              // ranked town/project preferences
  household: HouseholdMember[];                 // the graph — >= 1 member is the applicant
  declaredEthnicGroup: EthnicGroup;             // CHINESE | MALAY | INDIAN_OTHER  (for allocation §2.4)
  claimedSchemes: PriorityClaim[];              // FCS_PROXIMITY | PPS | THIRD_CHILD | ...
  priorFlatHistory: FlatHistory[];              // subsidised-flat receipts → first/second-timer, debarment
}

model HouseholdMember {
  memberId: string;
  role: MemberRole;                             // APPLICANT | SPOUSE | FIANCE | CHILD | PARENT | SIBLING
  citizenship: Citizenship;                     // SC | SPR | FOREIGNER
  dateOfBirth: plainDate;
  monthlyIncome: Money;                         // employment income only (doc: rental/investment excluded)
  relationTo: { memberId: string; relation: Relation }[];   // edges: SPOUSE_OF, CHILD_OF, ...
}
```

`household[*].relationTo` makes the family **nucleus** an explicit graph rather than a set of boolean
flags — because the eligibility rules ("forms a nucleus", "living within 4 km of a parent's flat") are
*relational*, and flattening them into booleans at intake would move un-auditable logic upstream of the
Decision layer, which the [decision-source doctrine](../../architecture/03-decision-layer.md#26-the-decision-source--an-llm-friendly-authoring-projection-over-the-full-dmn-16-surface)
forbids.

### 2.2 CodeSets — the governed, effective-dated reference tables

Every published number above is a **CodeSet row**, not an inlined literal — semver-versioned,
**effective-dated**, per-audience display metadata, each with an **owning Team + named stewards**
([02 §9](../../architecture/02-schema-foundation.md), [06 §4](../../architecture/06-identity-and-access.md)).
Effective-dating is load-bearing here: the Third-Child quota **changes on a known future date** (June
2026), so it must be a *scheduled* row change, not a redeploy.

```yaml
# codesets/income-ceilings.yaml — owning Team: policy-eligibility (stewards: 2 named)
kind: CodeSet
metadata: { id: income-ceilings, version: 2026.1.0, governanceState: released,
            owner: { team: policy-eligibility }, effective: { from: 2026-01-01, to: null } }
rows:
  - code: FAMILY_ALL        appliesTo: [THREE_ROOM, FOUR_ROOM, FIVE_ROOM]  ceiling: 14000  basis: gross-household-monthly
  - code: SINGLES_2RF       appliesTo: [TWO_ROOM_FLEXI]                    ceiling: 7000   basis: gross-household-monthly
  - code: EXTENDED_MULTIGEN appliesTo: [THREE_ROOM, FOUR_ROOM, FIVE_ROOM]  ceiling: 21000  basis: gross-household-monthly  note: "1.5x generic"
  - code: EHG_GRANT         appliesTo: [ALL]                              ceiling: 9000   basis: grant-only   codeRef: grants/ehg@2026.1.0
---
# codesets/priority-schemes.yaml — owning Team: policy-allocation
rows:
  - code: FCS_PROXIMITY  reservePct: 0.30  poolKind: reserved  eligibility: within-4km-family     effective: { from: 2025-07-01 }
  - code: PPS            reservePct: 0.30  poolKind: reserved  eligibility: child-under-16-or-pregnant
  - code: THIRD_CHILD    reservePct: 0.05  poolKind: reserved  effective: { from: 2020-01-01, to: 2026-05-31 }
  - code: THIRD_CHILD    reservePct: 0.10  poolKind: reserved  effective: { from: 2026-06-01, to: null }   # scheduled doubling
  - code: FIRST_TIMER    ballotMultiplier: 2   note: "2x a second-timer's entries"
  - code: SECOND_TIMER   ballotMultiplier: 1
  - code: TWO_BALLOT     ballotMultiplier: 2   note: "2BC: first-timer unsuccessful from 3rd try; stacks on FIRST_TIMER"
---
# codesets/ethnic-allocation.yaml — owning Team: policy-allocation (HIGH governance; §4)
rows:
  - group: CHINESE      blockPct: 0.84  neighbourhoodPct: 0.78
  - group: MALAY        blockPct: 0.22  neighbourhoodPct: 0.16
  - group: INDIAN_OTHER blockPct: 0.12  neighbourhoodPct: 0.10
  - group: SPR_CAP      blockPct: 0.08  scope: block-combined  note: "SPR households, all ethnicities; SC exempt"
---
# codesets/debarment-codes.yaml — owning Team: policy-eligibility
rows:
  - code: DBR-FT-LOSS   trigger: invited-not-booked-first-timer   effect: first-timer-priority-suspended  period: P1Y
  - code: DBR-ST-1Y     trigger: invited-not-booked-second-timer  effect: application-debarred            period: P1Y
```

Because CodeSets are **interdependent** (doc 02 §9.1), `EHG_GRANT.codeRef → grants/ehg@2026.1.0` makes
the grant-ceiling dependency explicit and its publish-time referential integrity checkable — deprecating
a grant row triggers impact analysis on the eligibility CodeSet that references it.

### 2.3 DecisionModels — eligibility and ballot-chance, and where FEEL strains

Two DecisionModels, both authored as **decision source** (the LLM-friendly projection over full DMN
1.6; [03 §2.6](../../architecture/03-decision-layer.md#26-the-decision-source--an-llm-friendly-authoring-projection-over-the-full-dmn-16-surface)),
`authored-in: decision-source`.

**(a) Eligibility** emits a canonical `Outcome` (`approve | refer | deny`, `reasons[]` from a coded
CodeSet). The household-graph predicates are the FEEL stress. FEEL *can* express them — it has `some` /
`every` quantifiers and list/context operators — but they nest deeply and get hard to read and test:

```feel
// decision-source excerpt — "forms an eligible nucleus with at least one SC" (Public Scheme)
some sc in household[ citizenship = "SC" ]
  satisfies ( some m in household
                satisfies m.role in { "SPOUSE","FIANCE" }
                  and ( some e in m.relationTo satisfies e.memberId = sc.memberId
                                                    and e.relation = "SPOUSE_OF" ) )
// and: sum(household[*].monthlyIncome) <= ceiling( flatType, scheme )   // BKM invocation into income-ceilings@2026.1.0
```

> **Where FEEL strains (noted honestly for the arch team).** The nucleus test is a **graph
> reachability** predicate (is there an SC connected to the applicant by an allowed relation path?).
> FEEL's `some`/`every` express *bounded* quantification well, but multi-hop relational reachability
> (e.g. Joint-Singles nucleus, orphan-sibling groupings) pushes into nested-quantifier soup that is
> legible neither to a business steward nor to a reviewer. The architecture's own escape hatch applies:
> per [03 §2.4](../../architecture/03-decision-layer.md), computation "that is a graph walk, not a
> predicate" belongs in a **`compute` feature-function** (`ref: kt://bto/NucleusResolver@1.0.0`) that
> returns a typed `nucleusKind` the decision table then keys on — keeping the *rule* in DMN and the
> *graph walk* in schema'd, trace-emitting Kotlin. This is the correct seam, but it means **eligibility
> is a Decision + a compute feature-function**, not a pure decision table. Flagged in [Gaps](#gaps-honest-account) G3.

**(b) Ballot-chance & pool assignment** is a pure Decision: given the (already-eligible) application, it
emits the applicant's **ballot multiplicity** (integer number of entries) and the **ordered set of
pools** it competes in (reserved scheme pools first, then the general pool), reading multipliers and
reserve percentages from `priority-schemes@…`:

```text
# decision-source (rendered decision-table view) — output: { ballotEntries, pools[] }
| # | timerStatus  | twoBallot | claimedSchemes contains  | ballotEntries | pools (ordered)                    |
|---|--------------|-----------|--------------------------|---------------|------------------------------------|
| 1 | FIRST_TIMER  | true      | FCS_PROXIMITY            | 4             | [FCS, FIRST_TIMER_GENERAL]         |
| 2 | FIRST_TIMER  | false     | PPS                      | 2             | [PPS, FIRST_TIMER_GENERAL]         |
| 3 | FIRST_TIMER  | false     | -                        | 2             | [FIRST_TIMER_GENERAL]              |
| 4 | SECOND_TIMER | false     | -                        | 1             | [SECOND_TIMER_GENERAL]             |
```

Crucially, this Decision does **not** draw randomness. It produces the *inputs* to the ballot (how many
tickets, which pools). The randomness lives in exactly one place — the ballot event (§3) — which is what
makes the whole thing auditable.

### 2.4 The quota ledger — shared mutable state with fairness invariants

Ethnic-allocation headroom, SPR headroom, and per-project reserved-pool counts are **cross-Case shared
mutable state**. This is *harder* than a single grants budget pool (a scalar counter) because it is
**multi-dimensional** — `(project, block, ethnicGroup)`, `(project, block, SPR)`, `(project, scheme)` —
and carries a **hard invariant**: no dimension may go below zero, ever, under concurrency.

ichiflow has no first-class primitive for this today (see [Gaps](#gaps-honest-account) G2). Modelled
with what exists, it is a **compute-backed ledger** guarded by the DecisionRecord/outbox spine:

```yaml
# a QuotaLedger — reservation-based, not a bare counter (design proposal; see G2)
kind: QuotaLedger                      # PROPOSED primitive
metadata: { id: bto-2026-jun-quota, owner: { team: policy-allocation } }
dimensions:
  - key: [project, block, ethnicGroup]  invariant: headroom >= 0   basis: ethnic-allocation@2026.1.0
  - key: [project, block, SPR]          invariant: headroom >= 0   basis: ethnic-allocation@2026.1.0
  - key: [project, scheme]              invariant: consumed <= reserved
operations:
  reserve:  { atomic: true, ttl: PT120M }   # a selection appointment holds a reservation
  commit:   { on: option-issued }           # OTP issuance converts reservation → consumption
  release:  { on: reservation-expired | selection-declined }
```

Quota is **consumed at selection, not at ballot** (§3, §5) — a subtle but exact point: the ballot only
orders applicants; a low queue number is worthless if, by the time the applicant selects, their group's
block quota is exhausted. The ledger therefore decrements when a *unit in a specific block* is booked,
which is why its key includes `block` and `ethnicGroup`, not just `project`.

---

## 3. The hard question — auditable randomness under deterministic replay

This is the dimension worth the whole case study. ichiflow's audit spine rests on **deterministic
replay** ([08 §6](../../architecture/08-audit-and-observability.md#part-6--deterministic-replay-as-a-forensic-tool)):
replaying a Case's event history against pinned artifact versions must reproduce the decision
**byte-for-byte**, and non-determinism on replay is itself an audit *finding*. A ballot injects
entropy. Naively, entropy and deterministic replay are contradictory.

The resolution is to **separate entropy generation from entropy consumption** and record the entropy as
a first-class, provenanced input — the same discipline Temporal uses for side effects, lifted to a
**governed, publishable artifact**:

**The ballot is a pure function `allocate(roster, seed) → orderedAllocation`.** It draws *no* live
entropy. The seed is a single value, and every queue number is a deterministic derivation from it:

```text
# plausible reconstruction — ichiflow only needs A provably-fair ballot, not HDB's exact one
for each application a in roster:                       # roster = frozen, hash-committed cohort snapshot
  for t in 0 .. a.ballotEntries - 1:                    # "ballot chances" = number of tickets
     ticketKey(a,t) = HMAC-SHA256(masterSeed, a.appId || ":" || t)   # deterministic PRF, not a live RNG
  a.drawKey = min over t of ticketKey(a,t)              # more tickets → better expected draw
within each pool (reserved schemes first, then general), sort applications by drawKey ascending
assign queue positions in that order, respecting each pool's reserved percentage of supply
```

Because `allocate` is a pure `compute` step (`ref: kt://bto/BallotAllocate@1.0.0`, schema'd I/O,
trace-emitting — [04 §2.6](../../architecture/04-flow-and-case-layer.md#26-the-compute-step--first-class-typed-code-activity)),
it **replays deterministically**: given the same `roster` snapshot and the same `masterSeed`, it emits
the identical ordering forever. Entropy never enters the workflow's non-deterministic surface.

**Where does the seed come from, and how is it *provably fair*?** A **commit-reveal** protocol, recorded
in the cohort DecisionRecord:

1. **Before the application window closes**, the ballot authority commits `H = SHA-256(masterSeed)` to
   the audit ledger (append-only, [08 §1](../../architecture/08-audit-and-observability.md)). The seed
   itself is sealed. Publishing the *commitment* first means the authority cannot grind seeds to favour
   an applicant after seeing the roster.
2. **The roster is frozen** at window close and its own hash `R = SHA-256(canonical(roster))` committed —
   so no application can be added, removed, or edited after the entropy is fixed.
3. **After the ballot**, `masterSeed` is **revealed** into the DecisionRecord. Anyone — an auditor, an
   applicant, a journalist — can recompute `SHA-256(masterSeed) == H`, recompute every `drawKey`, and
   reproduce the exact ordering from `(masterSeed, roster)`. This is the "**reproducible for auditors,
   years later**" requirement met by construction.

For a stronger fairness property (the authority cannot even *choose* a favourable seed), the seed can be
sourced from a **public randomness beacon** (e.g. a drand/League-of-Entropy round whose value is
published on a fixed schedule) fetched through an **`external-task`**
([04 §2.8](../../architecture/04-flow-and-case-layer.md#28-the-external-task-delegation-step--offload-work-to-an-external-system)) —
the beacon round number is recorded, and the beacon's value at that round is independently verifiable.
Either way, the architectural rule holds: **the workflow consumes a recorded seed; it never rolls dice
inside the replayable boundary.**

> **This is a genuinely new step-shape, and the closed step-type set does not name it.** ichiflow has no
> `ballot` / `seeded-random` step, and correctly so — but the *pattern* (commit a hash, freeze a roster,
> reveal a seed, derive a pure allocation, publish the reproduction recipe) is a **reusable auditable-
> randomness protocol** that today an app-builder must assemble by hand from `compute` + `external-task` +
> ledger commits. Flagged G1.

---

## 4. The cohort Flow

One launch is **one cohort Flow instance**, triggered on a **schedule** (the launch calendar), fanning
over tens of thousands of `FlatApplication` Cases. It uses the **batch trigger**
([04 §2.4](../../architecture/04-flow-and-case-layer.md#24-scheduled-and-batch-triggers)) but adds a
**cohort-level barrier** the batch trigger does not natively express (the ballot must see *all*
applications at once — see G4).

```yaml
# flows/bto-launch.flow.yaml  (authored-in: yaml) — cohort orchestration, one per exercise
id: bto-launch
trigger: { schedule: "launch-calendar", scope: "exercise:${exerciseId}" }
steps:
  - id: window            type: signal/event-wait   # application window; each intake opens a child Case
    until: "windowClosed(${exerciseId})"

  - id: freeze-roster     type: compute             # snapshot + hash-commit the cohort (roster R)
    ref: kt://bto/FreezeRoster@1.0.0

  - id: screen            type: loop                # per-Case eligibility (child sub-flow), G3 compute feature-fn inside
    over: "roster.applications"
    body: { decision: "eligibility@2026.1.0" }      # deny → coded rejection; refer → human-task; approve → ballot pool

  - id: ballot-chance     type: loop                # per-Case ballot multiplicity + pool assignment (pure Decision)
    over: "roster.eligible"
    body: { decision: "ballot-chance@2026.1.0" }

  - id: seed-reveal       type: external-task        # fetch/commit-reveal the masterSeed (§3); records provenance
    adapter: randomness-beacon                       # or internal commit-reveal; seed recorded to DecisionRecord

  - id: ballot            type: compute              # THE ballot event: allocate(roster, seed) → ordering (§3)
    ref: kt://bto/BallotAllocate@1.0.0               # pure, deterministic, replayable

  - id: issue-results     type: loop                 # per-Case: issue the ballot-result notice as a Document
    over: "roster.eligible"
    body: { issueDocument: "ballot-result-notice" }  # doctemplate → issue-document (see §4.1)

  - id: appointments      type: loop                 # per-Case: schedule a flat-selection Task by queue position
    over: "roster.balloted"
    body: { humanTask: "flat-selection", sla: "P14D", scheduleBy: "queuePosition" }
```

### 4.1 Issuing the ballot-result notice via `issue-document`

The ballot result reaches the applicant as a **Document** rendered from a governed **doctemplate** via
the **`issue-document`** operation (the Document/doctemplate/issue-document vocabulary, now
normatively owned by [ADR-0029](../../adr/0029-document-issuance.md) / [04 §2.9](../../architecture/04-flow-and-case-layer.md) / [07 §15](../../architecture/07-ui-and-portals.md)). The notice is *not* free text — it renders coded outcomes (queue
position, or "unsuccessful this exercise" with a coded reason) and, for the unsuccessful, the coded
consequence (e.g. does a 2BC accrue). Because it is an `issue-document`, the emitted Document is
**recorded in the DecisionRecord** and reproducible as-of the issue instant, so "what were they told,
and when" is auditable exactly like a decision.

### 4.2 Selection appointments as scheduled Tasks, and the quota check *at selection*

Each successful applicant gets a **`human-task`** (`flat-selection`) whose scheduling key is the
**queue position** — lower positions get earlier slots ([04 §5.2](../../architecture/04-flow-and-case-layer.md),
pausable SLA clocks). The **ethnic/SPR quota is checked here, at selection time — not at ballot** — as a
`decision-eval` against the **quota ledger** (§2.4):

```yaml
# inside the flat-selection Task resolution
- id: quota-check        type: decision-eval        # AT SELECTION, per chosen unit's block
  model: eip-selection-check@2026.1.0               # reads bto-2026-jun-quota headroom for (project, block, group, SPR)
  onDeny: { emit: unit-unavailable, code: EIP_BLOCK_QUOTA_FULL }   # → pick another unit/block, or lapse
- id: reserve            type: compute              # atomic reserve() on the ledger (ttl 120m) — G2 concurrency
  ref: kt://bto/QuotaReserve@1.0.0
- id: option-to-purchase type: adapter-call         # issue Option / Agreement-for-Lease; commit() the reservation
  onSuccess: { ledger: commit }
```

---

## 5. Three walkthrough traces

### 5.1 Successful ballot → selection within quota

**Household:** SC + SPR married couple, first-timers, one child aged 3, applying for a 4-room in a
non-mature town under **PPS**; combined income $8,200.

```jsonc
// eligibility@2026.1.0 → Outcome
{ "type": "approve", "reasons": [],
  "trace": { "nucleus": "PUBLIC_SC_SPR", "incomeSum": 8200, "ceiling": 14000, "source": "income-ceilings@2026.1.0" } }
// ballot-chance@2026.1.0 → { ballotEntries: 2, pools: ["PPS","FIRST_TIMER_GENERAL"] }   (row #2)
// ballot (compute, seed s0) → queuePosition 41 within PPS pool
```
```jsonc
// flat-selection Task (queuePosition 41) → quota-check at selection
{ "unit": "BLK12-#08-34", "group": "INDIAN_OTHER",
  "eip-selection-check": { "blockHeadroom": { "INDIAN_OTHER": 3, "SPR": 1 }, "outcome": "allow" },
  "reserve": { "ledgerKey": ["JUN2026-Tengah","BLK12","INDIAN_OTHER"], "headroomAfter": 2, "ttl": "PT120M" },
  "option-to-purchase": "issued", "ledger": "committed" }
```
The DecisionRecord for this `case_id` stitches: eligibility trace → ballot-chance → **the ballot's
`drawKey` derivation with the revealed seed** → issue-document (notice) → selection Task → quota
`reserve`/`commit` → Option. An auditor re-running `allocate(roster, s0)` reproduces queue position 41.

### 5.2 Ballot success, but EIP quota blocks the preferred unit

Same profile, but the applicant's declared group is **CHINESE** and their #1 unit is in a block whose
Chinese headroom is already **0** by the time their (mid-range) queue position is called — earlier
Chinese selectors in the same cohort consumed it (the shared-state dimension).

```jsonc
// flat-selection Task → quota-check
{ "preferredUnit": "BLK07-#11-02", "group": "CHINESE",
  "eip-selection-check": { "blockHeadroom": { "CHINESE": 0 }, "outcome": "deny",
                           "reasons": [ { "code": "EIP_BLOCK_QUOTA_FULL", "codeSet": "ethnic-allocation@2026.1.0" } ] },
  "explanation": "Chinese block quota (84%) for BLK07 exhausted before your appointment.",
  "offered": [ "BLK09-#04-15 (CHINESE headroom 5)", "BLK11-#02-08 (headroom 2)" ] }
```

Outcome is **not a rejection** and **not a ballot failure** — the ballot was won. It is a
*within-appointment unavailability*, explained with a coded reason from `ethnic-allocation@2026.1.0` and
a live list of quota-available alternatives (the same data the applicant could pre-check). If the
applicant books an alternative, the ledger commits against *that* block; if they decline all, the
non-selection consequence (§5.3) applies. The two failure modes — **lost ballot** vs **quota-blocked
unit** — stay **distinct coded outcomes**, which is exactly the auditability the shared-state dimension
demands: "why couldn't I book?" resolves to *quota*, not *ballot*.

### 5.3 Ineligible household → rejection with coded reasons

**Household:** two SPRs (no SC), combined income $15,400, applying for a 4-room under Public Scheme.

```jsonc
// eligibility@2026.1.0 → Outcome (hit-policy surfaces ALL failing gates for the notice)
{ "type": "deny",
  "reasons": [
    { "code": "ELIG-CIT-01", "codeSet": "eligibility-reasons@2026.1.0",
      "plainLanguage": "At least one applicant must be a Singapore Citizen." },
    { "code": "ELIG-INC-14K", "codeSet": "eligibility-reasons@2026.1.0",
      "professionalLabel": "Household income $15,400 exceeds the $14,000 family ceiling",
      "cites": "income-ceilings@2026.1.0#FAMILY_ALL" }
  ],
  "trace": { "nucleusResolver": "kt://bto/NucleusResolver@1.0.0", "scCount": 0, "incomeSum": 15400 } }
```
The **coded** rejection (two independent reasons, each tied to a CodeSet row) renders per-audience:
the applicant sees plain language, a case officer sees `ELIG-CIT-01` / `ELIG-INC-14K`, and the
DecisionRecord pins the exact ceiling version that applied. An **appeal** opens a **correlated child
review Case** ([04 §5.6](../../architecture/04-flow-and-case-layer.md#56-post-submission-case-operations),
`appeal-reason` CodeSet); a **withdrawal** during the window records a terminal disposition and (if the
applicant was already a first-timer invited in a prior exercise) may interact with `debarment-codes`.

---

## 6. Checks and balances

| Concern | Mechanism | Who can see / change | Arch basis |
|---|---|---|---|
| **Ballot fairness** | Pure `allocate(roster, seed)`; entropy via commit-reveal (or public beacon); no live RNG in the replay boundary | Seed committed pre-close by ballot authority; revealed post-ballot to *everyone* | [08 §6](../../architecture/08-audit-and-observability.md), §3 |
| **Ballot reproducibility (auditor, years later)** | `(masterSeed, roster-hash)` in the cohort DecisionRecord; `SHA-256(seed)==H` checkable; `BallotAllocate@1.0.0` pinned & golden-tested | Auditor via **why API**; anyone can recompute from published seed + roster hash | [08 §1](../../architecture/08-audit-and-observability.md), [13 §1](../../architecture/13-agent-harness-loops.md) |
| **Roster integrity** | Roster frozen + hashed at window close; no post-freeze edits; edits after freeze are audit findings | Roster hash public; changes impossible without breaking `R` | §4 `freeze-roster` |
| **Quota integrity under concurrency** | Reservation-based ledger (`reserve`/`commit`/`release`, TTL); invariant `headroom >= 0` enforced atomically; appointments serialized by queue slot | Ledger writes only via `QuotaReserve`/`QuotaCommit` compute activities; **policy-allocation** Team owns the tables | §2.4, [04 §5](../../architecture/04-flow-and-case-layer.md) |
| **Who may change quota tables** | `ethnic-allocation` / `priority-schemes` CodeSets owned by **policy-allocation** Team; HIGH governance dial → full approval-Flow; effective-dated (scheduled changes, e.g. Third-Child June 2026) | `steward`/`approver from owner` (OpenFGA); version-control is the write path | [06 §4](../../architecture/06-identity-and-access.md), [BRIEF §21](../../architecture/BRIEF.md) |
| **Eligibility explainability** | Coded reasons from `eligibility-reasons` CodeSet; nucleus graph-walk in a schema'd, trace-emitting `compute` feature-function | Applicant (plain language) / officer (codes) / auditor (full trace) via why API | [03 §2.4](../../architecture/03-decision-layer.md), [08 §1](../../architecture/08-audit-and-observability.md) |
| **Separation of duties** | Ballot authority (seed) ≠ eligibility policy stewards ≠ quota-table stewards — distinct Teams/relations | Three owning Teams; no single relation spans seed + rules + quota | [06 §4](../../architecture/06-identity-and-access.md) |

---

## 7. Gaps (honest account)

This case study exists to find gaps, and it found real ones. Classified **blocking** (v1 cannot model
the domain honestly without it) vs **minor** (expressible with existing primitives, but awkward enough
to warrant a first-class affordance).

### G1 — Auditable-randomness protocol as a reusable pattern — **MINOR (bordering blocking)**
The commit-reveal-derive-reveal protocol (§3) is assemblable **today** from `compute` + `external-task` +
audit-ledger commits, so it is not strictly blocking — the closed step-type set is *correctly* closed and
`allocate` is just a pure `compute`. But every org that needs a fair lottery (school places, visa
diversity lotteries, oversubscribed clinics, jury selection) would re-hand-assemble the same fragile
choreography, and getting the ordering of *commit-hash → freeze-roster → reveal-seed* wrong silently
breaks fairness without breaking replay. **Proposal:** ship an **auditable-randomness recipe** as a
governed pattern — a documented `compute` contract (`SeededAllocate`) + a **commit-reveal ledger helper**
+ a **harness** ([13](../../architecture/13-agent-harness-loops.md)) that asserts, on golden cohorts,
that `SHA-256(seed)==commitment`, the roster hash is stable, and `allocate` is a pure function of
`(roster, seed)`. Not a new step type; a **blessed, harness-verified pattern** in the resources manifest.

**Resolved (2026-07 gap-fix round):** blessed as the harness-verified **SeededAllocate** pattern — the
commit-reveal / public-beacon recipe plus the purity + concurrency harness in
[13 §2.n](../../architecture/13-agent-harness-loops.md) (asserts `SHA-256(seed)==commitment`, stable roster
hash, `allocate` pure in `(roster, seed)`), with the standing-Flow pointer in
[04 §5.12](../../architecture/04-flow-and-case-layer.md). A named pattern, not a new step type — exactly as proposed.

### G2 — Cross-Case shared mutable state with fairness invariants — **BLOCKING**
ichiflow has **no first-class primitive** for multi-dimensional, transactionally-consumed shared state
with a hard non-negativity invariant under concurrency. The permit example's fee pool and any single
"grants budget" is a scalar; this domain needs `(project, block, ethnicGroup)` × `(project, block, SPR)`
× `(project, scheme)` headroom with atomic `reserve`/`commit`/`release` and TTL'd reservations across
**concurrent selection appointments**. Modelling it as ad-hoc `compute` activities over a Postgres table
(§2.4) works mechanically but puts the **fairness invariant outside the audited artifact layer** — the
invariant "headroom never negative" is enforced by hand-written SQL, not a governed contract the why API
and harness understand. **Proposal:** a first-class **`QuotaLedger` (resource-ledger) artifact** — a
schema'd, Team-owned, effective-dated artifact declaring dimensions + invariants, with `reserve`/`commit`/
`release` semantics on the DecisionRecord/outbox spine, replay-visible, and a **concurrency harness** that
red-teams the invariant under simulated parallel bookings. This is the single most important missing
primitive the case surfaces.

**Resolved (2026-07 gap-fix round):** adopted as the first-class **`QuotaLedger`** primitive
([ADR-0030](../../adr/0030-quota-ledger.md), [04 §5.9](../../architecture/04-flow-and-case-layer.md)) — a
governed, Team-owned, effective-dated ledger declaring dimensions + invariants, with atomic
`reserve`/`commit`/`release` invoked from a canonical **`quota-op`** step on the DecisionRecord/outbox spine,
memoized exactly-once on replay, and a concurrency harness ([13 §2.l](../../architecture/13-agent-harness-loops.md))
red-teaming `headroom >= 0` under contention. The interim `QuotaReserve` `compute`-ref modelling (§2.4, §4.2)
is superseded by `quota-op`.

### G3 — Eligibility over a household/entity graph — **MINOR**
FEEL expresses bounded quantifiers but not multi-hop relational reachability legibly (§2.3); the
nucleus/orphan/joint-singles tests strain into unreadable nested `some`/`every`. The architecture's
`compute` feature-function seam ([03 §2.4](../../architecture/03-decision-layer.md)) handles it —
`NucleusResolver` returns a typed `nucleusKind` the table keys on — so it is **not blocking**, but it
means graph-shaped eligibility is *routinely* a Decision **plus** a compute feature-function, and the
decision source should say so explicitly. **Proposal:** a documented **"graph predicate → compute
feature-function → decision-table key"** pattern in the decision-layer guidance + resources manifest, so
authors reach for it deliberately instead of drowning a decision table in nested quantifiers.

**Resolved (2026-07 gap-fix round):** documented as the **"graph predicate → compute feature-function →
decision-table key"** pattern in [03 §2.4](../../architecture/03-decision-layer.md) — the `NucleusResolver`
seam this section already uses, now a named decision-layer pattern (the multi-hop graph walk lives in a
schema'd `compute` feature-function returning a typed `nucleusKind` the decision table keys on).

### G4 — Cohort / set-level decisioning and a cohort-level DecisionRecord — **BLOCKING**
Two sub-gaps. **(a) Cohort barrier:** the batch trigger ([04 §2.4](../../architecture/04-flow-and-case-layer.md))
fans a schedule out into *independent* per-Case sub-flows, but the ballot is a **set-level** operation —
it must see the entire frozen roster at once and emit a *global* ordering. There is no first-class
"**gather all Cases in cohort C, run one set-level step, scatter results back**" barrier; §4 fakes it
with `freeze-roster` + a `compute` over the whole collection, but the interpreter has no native
cohort-barrier semantics or bounded-fan-in guardrail for 50,000 Cases. **(b) Cohort DecisionRecord:** the
DecisionRecord is keyed **per `case_id`** ([08 §1](../../architecture/08-audit-and-observability.md)), but
the ballot is a **cohort artifact** — the seed, roster hash, and allocation belong to the *exercise*, not
to any one application. Today it must be smeared across N per-Case records or parked in an ad-hoc place.
**Proposal:** (a) a **cohort/batch Flow shape** with an explicit **gather-barrier step** (bounded fan-in,
one set-level `compute`/`decision`, scatter) and (b) a **cohort-scoped DecisionRecord** (keyed by
`exerciseId`) that per-Case records **reference** for the shared ballot facts — so "prove my queue number"
resolves to *one* cohort record every applicant's record points at, not 50,000 copies.

**Resolved (2026-07 gap-fix round):** adopted as the **`cohort`** set-level Case shape
([ADR-0031](../../adr/0031-set-level-cases.md), [04 §5.10](../../architecture/04-flow-and-case-layer.md)) — an
explicit **gather-barrier** over a case selector with a bounded-fan-in guardrail, running one set-level
step (the ballot ordering) and scattering results back, plus a **cohort-scoped DecisionRecord** keyed by
`cohortId`/`exerciseId` that member Cases reference ([08 §1.7](../../architecture/08-audit-and-observability.md)).
The `QuotaLedger` ranked draw (G2) composes under the same barrier.

### G5 — EIP "resale-vs-BTO" branding nuance — **MINOR (modelling, not architectural)**
Formally EIP is branded for resale, yet identical ethnic ratios bind at BTO selection (§1). This is a
**domain-modelling** subtlety, not an ichiflow gap: model it as one `ethnic-allocation` CodeSet consumed
by *two* contexts (BTO selection check, resale transfer check) with effective-dated rows — no new
primitive needed. Noted so a modeller does not wrongly conclude BTO has no ethnic quota.

---

### Where to go deeper

- Deterministic replay, DecisionRecord, bitemporal as-of — [`../../architecture/08-audit-and-observability.md`](../../architecture/08-audit-and-observability.md)
- Step-type catalogue, `compute`, `external-task`, batch triggers, Cases/Tasks, post-submission ops — [`../../architecture/04-flow-and-case-layer.md`](../../architecture/04-flow-and-case-layer.md)
- Decision source, feature-functions, composition, governance dial — [`../../architecture/03-decision-layer.md`](../../architecture/03-decision-layer.md)
- CodeSets, effective-dating, interdependency — [`../../architecture/02-schema-foundation.md`](../../architecture/02-schema-foundation.md)
- Owning Teams, role-as-relation, governance dial — [`../../architecture/06-identity-and-access.md`](../../architecture/06-identity-and-access.md)
- Harness-first construction (the fairness/concurrency harnesses proposed above) — [`../../architecture/13-agent-harness-loops.md`](../../architecture/13-agent-harness-loops.md)
- The canonical reference product (per-Case counterpart to this cohort study) — [`../creating-a-permit-product.md`](../creating-a-permit-product.md)
