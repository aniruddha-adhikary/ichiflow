# Design-validation case study — a competitive R&D grant program (multi-stage, panel-reviewed)

> _**Genre note — this is a design-VALIDATION case study, not the reference product and not a shipped
> template.** It models a **competitive research-and-innovation grant program** to stress ichiflow against
> dimensions no sibling covers: a **multi-stage lifecycle over months** (eligibility → detailed application
> → panel review → conditional award → offer acceptance → disbursement claims → acquittal/audit → clawback),
> **genuine multi-authority scoring** across independent panel reviewers, **several organizations on one
> deployment** (agency departments + external university/industry reviewers as partner-org Teams + applicant
> orgs), and a **capped round budget consumed by awards**._
>
> _**Grounding.** Per the `BRIEF.md` §16 rule that **no real government system is named in shipped product**,
> the agency and program are **fictional** — the **National Research & Innovation Agency ("the Agency")**
> running the **Frontier R&D Grant ("FRDG")** — but every mechanic is **grounded in one real, deeply-published
> program family, the EU's Horizon Europe**, cited inline: three-criterion 0–5 expert scoring with
> thresholds, independent-evaluator **conflict-of-interest** rules, the funding-rate structure, the
> **pre-financing → interim → final** payment circuit, and central **legal-entity validation**. This mirrors
> the [insurance case](./motor-insurance-claim.md)'s posture (fictional insurer, real published GIA/BOLA):
> checkable against public rules, but nothing here ships as a product or template — the canonical reference
> product stays the fictional municipal [permit](../creating-a-permit-product.md)._
>
> _Artifacts are consistent with [`../../architecture/BRIEF.md`](../../architecture/BRIEF.md) and docs
> `00`–`13`. The **Document / doctemplate / issue-document** nouns (a sibling design) are used as settled
> vocabulary. Figures are grounded as of **July 2026** and cited; where illustrative, the **shape** is
> load-bearing._

---

## 1. Why this domain, and what it stresses

The permit and work-pass cases are **single-decision, single-authority** shapes: one applicant, one
determination, one issuance. A competitive grant is a different animal — a **months-long, multi-party
lifecycle** where the decision is *made by a panel*, the *money is finite*, and the Case lives long after the
award (claims, audits, clawback). It breaks assumptions the siblings never test, along dimensions each
sibling deliberately left to this one:

| # | Dimension | What a grant program forces | Sibling that punted it here |
|---|---|---|---|
| **D1** | **Multi-stage lifecycle** | Eight governed stages over months, each with sub-flows, RFI **clock-stops**, and **SLA escalation** — not one Flow with a review step | customs = parallel CA fan-out; this = *serial* staged lifecycle |
| **D2** | **Multi-authority scoring, done right** | 3–4 **independent** reviewers each score the same proposal; their Outcomes compose under **quorum / weighted / custom** policies — genuinely *N authorities*, the case `CompositeOutcome` was designed for | work-pass proved a *single*-authority score is a **DRD, not** a composite ([its GAP #2](./work-pass-compass.md#gaps)); this honors that line and finally exercises the composite correctly |
| **D3** | **Multiple organizations, one deployment** | Agency departments + **partner-org reviewer Teams** (universities/industry) with **conflict-of-interest** rules + applicant orgs — reviewers see **only assigned** applications | ballot = cohort; work-pass = two Portals; this = *partner-org Teams + COI + list-filtering* |
| **D4** | **Capped round budget** | A round's budget is a **finite pool** consumed by awards (reserve at ranking → commit at acceptance → release on decline/clawback) | ballot proposed the **`QuotaLedger`** primitive ([its G2](./public-housing-ballot.md#g2--cross-case-shared-mutable-state-with-fairness-invariants--blocking)); this **confirms** it and adds monetary + reserve-list strains |
| **D5** | **Issuance with acceptance** | A **Letter of Offer** is *issued*, the applicant must **accept** it, and only then does the award **activate** — the issued Document participates in flow control; variation → **v2 reissue**; clawback → **revocation notice** | work-pass issued a pass (one-way); this needs an *accept-to-activate* Document lifecycle |
| **D6** | **Competent-authority validation** | Program officers validate **AI-assisted** eligibility screening; finance validates claims; an **independent audit team can re-open** closed cases | insurance had SIU triage; this = *AI-proposes / officer-disposes at every gate* |
| **D7** | **Heavy, effective-dated CodeSets** | eligible-sector → activity-type → **funding-rate** tables, scoring weights, condition/clawback codes — versioned **across rounds** | work-pass = annual benchmarks; this = a *dependency graph* of rate/criteria tables per round |

Grounding facts used below (checkable against public Horizon Europe rules):

- **Evaluation.** Three criteria — **Excellence, Impact, Quality & Efficiency of Implementation** — each
  **0–5** (half-point); **per-criterion threshold 3/5**, **overall 10/15**, no cross-criterion compensation;
  **3–4 independent experts** file IERs then **discuss to consensus**; unweighted except **Innovation-Action
  Impact ×1.5 for ranking only**.[^he-eval][^he-form] **Conflict of interest:** experts **cannot evaluate
  proposals from their own organisation**, ones they contributed to, or involving **close collaborators**; a
  COI must be declared and work stopped; a hidden COI is **null and void** and recoverable.[^he-coi]
- **Funding rates.** Research **100%**, Innovation **70%** (100% **non-profit**), Support **100%**.[^he-rates]
  **Payment circuit:** pre-financing (float, 30–70%), interim (85% cumulative ceiling), final (≤15%, incl. 10%
  retention); overpayment triggers **recovery**.[^he-pay] A **PIC** is **provisional until validated** by a
  **Central Validation Service**.[^he-pic] The grant **enters into force on the authority's signature** after
  the applicant signs; an **acquittal** verifies use of funds; a **breach** makes funds **recoverable as a
  debt** (clawback) and can terminate the award.[^acquittal][^clawback]

---

## 2. Artifacts

### 2.1 Schemas — the application, the org graph, the reviewer, the claim

The application is one canonical Schema (TypeSpec-authored; [doc 02 §1](../../architecture/02-schema-foundation.md)).
Three sub-shapes matter: the **applicant org** (read by registry validation + the COI check), the **work-plan
with milestones** (which become tracked Conditions), and the **budget** (read by the funding-rate CodeSet + pool).

```typespec
// contracts/src/frdg.tsp
@jsonSchema
model GrantApplication {
  id: string;                                   // global correlation id → Case.case_id
  roundId: string;                              // the call/round cohort, e.g. "FRDG-2026-R2"
  activityType: ActivityType;                   // RESEARCH | INNOVATION | SUPPORT — codeRef → funding-rates
  sector: SectorCode;                           // codeRef → eligible-sectors → activity-types
  applicantOrg: Organisation;                   // validated against the registry (§2.5); COI subject (§3)
  partners: Organisation[];                     // co-applicants; each independently COI-relevant
  workPlan: Milestone[];                        // milestones become post-approval-obligation Conditions (§2.7)
  requestedBudget: BudgetLine[];                // eligible cost; funding rate applied per §2.3
}
model Organisation {
  legalName: string;
  pic?: string;                                 // Participant Identification Code; PROVISIONAL until validated
  registryId?: string;                          // national company-registry id — resolved via external-task (§2.5)
  orgKind: OrgKind;                             // FOR_PROFIT | NON_PROFIT | RESEARCH_ORG | PUBLIC_BODY
  teamRef?: string;                             // if this org is also a partner reviewer Team — the COI edge (§3)
}
model Milestone { milestoneId: string; dueBy: plainDate; claimTrigger: ClaimType; }   // deadline → Condition (§2.7)

@jsonSchema  // IER — one reviewer's scored assessment = the per-authority Outcome that composes (§2.3d)[^he-eval]
model IndividualEvaluationReport {
  applicationId: string;
  reviewerId: string;                           // a member of a partner-org reviewer Team (§3)
  scores: CriterionScore[];                     // Excellence / Impact / Implementation — each 0..5, half-point
  integrityFlag?: string;                       // a reviewer may raise a research-integrity concern (blocks §2.3d)
}
@jsonSchema
model Claim {                                    // a disbursement request against an active award
  awardId: string;                              // the activated Letter of Offer (§2.6)
  claimType: ClaimType;                         // PRE_FINANCING | INTERIM | FINAL — codeRef → claim-types
  periodReport: PeriodReport;   evidencedMilestones: string[];
}
enum ActivityType { research: "RESEARCH", innovation: "INNOVATION", support: "SUPPORT" }
enum ClaimType { preFinancing: "PRE_FINANCING", interim: "INTERIM", final: "FINAL" }
```

Field-level provenance rides on the Case ([doc 08 §1](../../architecture/08-audit-and-observability.md)): the
applicant attests `workPlan`/`requestedBudget`, registry validation attests `applicantOrg.pic` status, and
each reviewer attests exactly their own IER — keeping the multi-authority audit (D2) honest.

### 2.2 CodeSets — the effective-dated dependency graph, with owning Teams

Every published number is a **governed CodeSet** ([doc 02 §9.1](../../architecture/02-schema-foundation.md)):
schema'd, semver-versioned, **effective-dated per round**, per-audience display, **owned by a Team with named
stewards**. The heart of D7 is the **`codeRef` dependency graph** — sector → activity-type → funding-rate,
condition → clawback trigger — with publish-time referential integrity ([doc 02 §9.4](../../architecture/02-schema-foundation.md)).

```yaml
# codesets/eligible-sectors.yaml (owner: programme-policy; effective: {from: 2026-07-01} — the Round-2 line)
rows:
  - sector: ADVANCED_MFG   activityTypes: [RESEARCH, INNOVATION]   codeRef: { funding-rates: "by activityType" }
  - sector: CLEAN_ENERGY   activityTypes: [RESEARCH, INNOVATION, SUPPORT]   # + HEALTH_TECH, etc.
---
# codesets/funding-rates.yaml (owner: programme-finance; HIGH governance — money) — grounded in HE rates[^he-rates]
rows:
  - { activityType: RESEARCH,   orgKind: ANY,        ratePct: 1.00 }
  - { activityType: INNOVATION, orgKind: FOR_PROFIT, ratePct: 0.70 }
  - { activityType: INNOVATION, orgKind: NON_PROFIT, ratePct: 1.00 }   # non-profit floor at 100%
  - { activityType: SUPPORT,    orgKind: ANY,        ratePct: 1.00 }
---
# codesets/scoring-criteria.yaml (owner: programme-policy; drives §2.4) — thresholds 3/5, overall 10/15[^he-eval]
rows:
  - { criterion: EXCELLENCE,     maxScore: 5, threshold: 3, rankWeight: { default: 1.0 } }
  - { criterion: IMPACT,         maxScore: 5, threshold: 3, rankWeight: { default: 1.0, INNOVATION: 1.5 } }  # ×1.5 ranking only
  - { criterion: IMPLEMENTATION, maxScore: 5, threshold: 3, rankWeight: { default: 1.0 } }
  - { key: OVERALL, threshold: 10, divergenceBand: 1.5, quorumReviewers: 3 }   # ≥3 non-conflicted IERs to convene
---
# codesets/claim-types.yaml (owner: programme-finance) — payment circuit grounded in HE[^he-pay]
rows:
  - { claimType: PRE_FINANCING, floatPct: 0.50, cumulativeCeilingPct: 0.50 }   # float; Agency property until final
  - { claimType: INTERIM,       cumulativeCeilingPct: 0.85 }                    # interim capped at 85% cumulative
  - { claimType: FINAL,         retentionPct: 0.10 }                            # ≤15%; 10% retention on acquittal
---
# codesets/award-conditions.yaml (owner: programme-policy) — obligations, each codeRef'd to its clawback trigger
rows:
  - code: MILESTONE_M1_REPORT   kind: post-approval-obligation   dueRule: "milestone.dueBy"
    codeRef: { clawback-reasons: BREACH_MILESTONE }
    display: { professionalLabel: "Deliver M1 technical report by deadline",
               plainLanguage: { en: "You must submit your first progress report by the agreed date." } }
  - code: MAINTAIN_ELIGIBILITY  kind: post-approval-obligation   codeRef: { clawback-reasons: LOST_ELIGIBILITY }
---
# codesets/rejection-reasons.yaml (owner: programme-policy) — dual-audience display
rows:
  - code: BELOW_CRITERION_THRESHOLD  kind: reason   codeRef: { scoring-criteria: "by criterion" }
    display: { professionalLabel: "Criterion score below the 3/5 threshold",
               plainLanguage: { en: "One assessment area did not reach the minimum score." } }
  - code: BELOW_BUDGET_LINE          kind: reason   # passed on quality but round budget exhausted → reserve list
    display: { plainLanguage: { en: "Your proposal passed on quality but the round's budget was fully committed." } }
---
# codesets/approval-thresholds.yaml (owner: programme-finance) — the FOUR-EYES threshold is a ROW (D5), not code
rows:
  - { code: FOUR_EYES_AWARD, thresholdAmount: 500000, currency: EUR }   # awards above this need a second approver
```

Cross-CodeSet **`codeRef`** integrity is validated at publish ([doc 02 §9.4](../../architecture/02-schema-foundation.md)):
`award-conditions → clawback-reasons` means retiring a clawback reason triggers publish-time impact analysis
on every dependent condition and Flow. A funding-rate change is an **approval Case routed to the
`programme-finance` stewards** ([doc 03 §5.8](../../architecture/03-decision-layer.md)), not a spreadsheet
edit — and because it is **effective-dated per round**, Round 3's rates can merge and pin now with a future
`effective.from` while Round 2's Cases stay frozen on `2026.2.0` ([doc 03 §5.7](../../architecture/03-decision-layer.md)).

### 2.3 DecisionModels — eligibility, COI-assignment, per-reviewer scoring, panel composition, award

Five DecisionModels, all authored as **decision source** (the LLM-friendly full-DMN-1.6 projection; [doc 03 §2.6](../../architecture/03-decision-layer.md#26-the-decision-source--an-llm-friendly-authoring-projection-over-the-full-dmn-16-surface)).

**(a) Eligibility — AI-assisted, competent-authority-validated (D6).** A DMN decision reads the validated
org facts, sector eligibility, and budget ceiling and emits a canonical `Outcome`. Where the proposal text
must be *screened for scope fit*, an **AI agent** produces a **recommendation** (a non-human principal under
[BRIEF §8/§12](../../architecture/BRIEF.md); [doc 06 Part 5](../../architecture/06-identity-and-access.md)) that a
**program officer Task validates** — "AI proposes, humans dispose." The AI's suggestion is *never* the
decision of record; the officer's confirmation is, both on the audit spine attributed to their principals.

```text
# decisions/eligibility.decision-source — output: Outcome. inputs: applicantOrg.validationState (from registry
#   external-task §2.5), sector in eligible-sectors (codeRef), sum(requestedBudget) <= ceiling(roundId) (BKM)
| # | when                          | outcome                             |
|---|-------------------------------|-------------------------------------|
| 1 | validationState = "REJECTED"  | deny  reasons:[ORG_NOT_VALIDATED]   |
| 2 | sector not in eligible-sectors| deny  reasons:[SECTOR_INELIGIBLE]   |
| 3 | validationState = "PROVISIONAL"| refer reasons:[AWAIT_VALIDATION]   |  # → officer Task validates (D6)
| 4 | otherwise                     | approve                             |
```

**(b) COI reviewer-assignment — a Decision over Team/org relations (D3).** Which reviewers may score an
application is a **routing Decision** ([doc 04 §5.3](../../architecture/04-flow-and-case-layer.md)) — but its
*inputs* are **relationships in the OpenFGA Team graph**, and a Decision is a pure evaluation over schema'd
inputs, not a graph-walker. So the same seam the ballot used for its household graph applies
([its G3](./public-housing-ballot.md#g3--eligibility-over-a-householdentity-graph--minor)): a **`compute`
feature-function** resolves the reviewer↔applicant relationship into typed COI facts the Decision keys on.

```text
# compute feature-function  ref: kt://frdg/CoiResolver@1.0.0  — reads OpenFGA (reviewer's partner-org Team vs
#   application orgs), emits typed facts: { sameOrg, declaredCollaborator, coauthorRecent }

# decisions/coi-assignment.decision-source — output: { eligibleToReview: bool, reason? }
| # | when                       | eligibleToReview | reason                |
|---|----------------------------|------------------|-----------------------|
| 1 | coi.sameOrg                | false            | COI_SAME_ORG          |  # own-organisation bar[^he-coi]
| 2 | coi.declaredCollaborator   | false            | COI_COLLABORATOR      |
| 3 | coi.coauthorRecent         | false            | COI_RECENT_COAUTHOR   |
| 4 | otherwise                  | true             | -                     |
```

The D3 point in one artifact: **the own-organisation bar is a governed Decision over the Team graph**, so
*why* a reviewer was excluded is answerable via the why API and tested like any rule — not buried in code.

**(c) Per-reviewer scoring — a single-authority DRD, exactly the work-pass lesson (D2, first half).** One
reviewer scoring three criteria is **one authority computing one assessment** — which
[work-pass GAP #2](./work-pass-compass.md#gaps) established is a **DRD, not a `CompositeOutcome`**. This case
**honors that line**: each reviewer's IER is a DRD emitting *that reviewer's* attributed `Outcome`.

```text
# decisions/reviewer-score.decision-source — per reviewer; each criterion vs its 3/5 threshold, no compensation[^he-eval]
context:
  perCriterion : for c in scores return { criterion: c.criterion, score: c.score, pass: c.score >= threshold(c.criterion) }
  allPass : every p in perCriterion satisfies p.pass    total : sum(scores[*].score)
outcome: Outcome{
  type: if reviewer.integrityFlag != null then "refer" else if allPass and total >= 10 then "approve" else "deny",
  reasons: if not allPass then [BELOW_CRITERION_THRESHOLD] else [],
  authority: reviewer.reviewerId,                  # attributed to THIS reviewer's partner-org
  scoreBreakdown: perCriterion }                   # per-criterion, first-class — see G2 re Outcome contract
```

**(d) Panel composition — a genuine `CompositeOutcome` across N authorities (D2, second half).** *Now* the
composite is the right tool, because the members are **N independent reviewers = N authorities**
([doc 03 §2.3](../../architecture/03-decision-layer.md#23-composite-decisions-multiple-authorities-one-compositeoutcome)) —
the case exercises **three** composition policies beyond `all-must-approve`, each mapped to a real panel mechanic:

| Policy | Where it applies | Panel mechanic |
|---|---|---|
| **`quorum(k)`** | sufficiency gate | **≥ 3 non-conflicted IERs** must be returned before the panel can convene (`quorumReviewers: 3`) |
| **`custom`** (governed DMN over `members[]`) | the fund/reject recommendation | consensus per-criterion ≥ 3 **and** consensus total ≥ 10 **and** **no reviewer raised an `integrityFlag`** — a rule the four closed policies cannot express, so it resolves to a **governed DMN over the members array**, never code |
| **`weighted`** | round-level ranking | rank score = weighted criterion sum; **Impact ×1.5 for INNOVATION** ([scoring-criteria](#22-codesets--the-effective-dated-dependency-graph-with-owning-teams)) — ranking only, never for thresholds[^he-eval] |

```text
# decisions/panel-composition.decision-source  (policy: custom — governed DMN over members[])
inputs: members : Outcome[]   # one per reviewer (§2.3c), each attributed;  consensus : moderated per-criterion scores
rolledUp:
  if some m in members satisfies m.type = "refer" then Outcome{ type:"refer", reasons:[INTEGRITY_HOLD] }  # a flag blocks all[^he-coi]
  else if (every c in consensus satisfies c.score >= threshold(c.criterion)) and sum(consensus) >= 10
    then Outcome{ type:"conditional-approve", conditions: standardAwardConditions(), members: members }  # provisional — budget line decides
  else Outcome{ type:"deny", reasons:[BELOW_CRITERION_THRESHOLD], members: members }   # each member Outcome stays attributed
```

The **consensus** step is where **competent-authority validation** meets D2: where reviewer scores diverge
beyond `divergenceBand` (1.5), a **rapporteur** (an Agency `panel-secretariat` officer) runs a moderated
**consensus Task** — validating that the panel reached an agreed score, not re-scoring, exactly as Horizon's
consensus step moderates independent IERs.[^he-eval] The composite keeps **each reviewer's Outcome
attributed to its authority** into the DecisionRecord ([doc 03 §2.3](../../architecture/03-decision-layer.md)),
so "which expert scored what, and how the panel composed it" is fully reconstructable.

**(e) Award decision + four-eyes — the threshold is a CodeSet row (D5).** A passing composite is only a
*provisional* award, gated by the **budget pool** (§2.4) and, above a threshold, a **second approver**. The
four-eyes threshold is **not** hard-coded — the `award-approval` decision-source keys on
`approval-thresholds@2026.2.0`: `grantAmount > FOUR_EYES_AWARD.amount → two-approver (assessor ≠ approver1 ≠
approver2)`, else `single-approver`. Change the threshold and the control surface moves with it — no Flow edit.

### 2.4 The budget pool — a `QuotaLedger`, confirming the ballot's G2 (D4)

A round has a **capped budget** consumed by awards — exactly the **cross-Case shared mutable state with a
hard invariant** the [ballot flagged as its most important missing primitive
(G2)](./public-housing-ballot.md#g2--cross-case-shared-mutable-state-with-fairness-invariants--blocking) and
proposed as a **`QuotaLedger`**. **This case does not re-propose it — it confirms the need from a second,
independent domain** and surfaces strains beyond the ballot's ([Gaps G3](#g3--budget-pool-residual-strains-beyond-the-quotaledger-proposal--minor-bordering-blocking)):

```yaml
# a QuotaLedger for the round budget — the primitive the ballot proposed (G2), confirmed here
kind: QuotaLedger                      # PROPOSED primitive (ballot G2)
metadata: { id: frdg-2026-r2-budget, owner: { team: programme-finance } }
dimensions:
  - key: [roundId]        invariant: committed <= capacity   basis: "EUR 40,000,000 capacity for FRDG-2026-R2"
operations:
  reserve: { atomic: true, ttl: P30D }   # provisional award reserves its grant amount when the ranked list is drawn
  commit:  { on: offer-accepted }        # Letter-of-Offer acceptance converts reservation → consumption
  release: { on: offer-declined | offer-lapsed | clawback-recovered | claim-underspend }
```

Two mechanics differ from a permit fee pool and even the ballot. **(1) Monetary, not integer:** the pool
consumes **variable grant amounts**, so "does the next ranked award fit?" is `capacity − committed − reserved
≥ grantAmount`, not `headroom ≥ 1`. **(2) A ranked draw against the line is a cohort/set-level
operation:** the round **ranks** every scored application (weighted, §2.3d) and **draws down the pool in rank
order** until the budget is exhausted; the rest fall **below the funding line** onto a **reserve list**
(`BELOW_BUDGET_LINE`, distinct from a quality failure) — precisely the **cohort barrier + cohort-scoped
DecisionRecord** the [ballot flagged as G4](./public-housing-ballot.md#g4--cohort--set-level-decisioning-and-a-cohort-level-decisionrecord--blocking)
(the funding line belongs to the *round*), so this case **confirms G4 too**.

### 2.5 The staged Flow — a multi-stage lifecycle with sub-flows (D1)

One application is **one Case** flowing through a **staged root Flow**, each stage a sub-flow. Registry
validation and disbursement are **`external-task`** delegations ([doc 04 §2.8](../../architecture/04-flow-and-case-layer.md#28-the-external-task-delegation-step--offload-work-to-an-external-system)); RFIs **clock-stop** the SLA; lateness **escalates**.

```yaml
# flows/frdg.flow.yaml  (authored-in: yaml; canonical Flow JSON is the executed artifact — doc 04 §2.5)
id: frdg
case: GrantApplication
steps:
  # ── Stage 0 — Eligibility + registry validation (external system, D3) ────────────────────────
  - { id: validate, type: validate, schema: schema://frdg/GrantApplication/1 }
  - id: registry-check                     # national company-registry / PIC-validation analog[^he-pic]
    type: external-task
    request:  { schema: schema://registry/EntityCheck/1,  adapter: adapter://registry/submit }
    response: { schema: schema://registry/EntityResult/1, inbound: adapter://registry/reply }
    correlation: { inject: { as: header, name: x-correlation-id, from: "case_id & '/' & step.id" } }
    sla: { budget: P10D, onTimeout: chain/registry-esc-1 }, onMalformed: dlq   # external turnaround (doc 04 §5.8)
  - id: eligibility, type: decision-eval, model: eligibility@2026.2.0
  - { id: officer-screen, type: human-task, when: "eligibility.type == 'refer'",   # COMPETENT-AUTHORITY validation (D6)
      assignBy: assign-programme-officer@1.0.0, sla: { budget: P5D } }         # routing is a Decision (doc 04 §5.3)
  - { id: gate0, type: condition-gate, on: "eligibility.type == 'deny'", deny: emit-rejection }

  # ── Stage 1 — Detailed application ───────────────────────────────────────────────────────────
  - { id: full-application, type: human-task, subState: awaiting-applicant, sla: { budget: P30D } }  # CLOCK-STOPS

  # ── Stage 2 — Panel review (multi-authority; §2.3, §2.4) ─────────────────────────────────────
  - id: assign-reviewers, type: decision-eval, model: coi-assignment@1.0.0   # COI filter over Team graph (D3)
  - id: collect-iers                       # each reviewer scores on the PARTNER Portal; list-filtered (§3)
    type: parallel, over: "assignedReviewers"
    body: { humanTask: reviewer-score, sla: { budget: P21D, onTimeout: chain/reviewer-esc-1 } }  # SLA ESCALATION
    join: { quorum: 3 }                    # quorum(k): ≥3 non-conflicted IERs to proceed (§2.3d)
  - { id: consensus, type: human-task, assignBy: assign-rapporteur@1.0.0,    # rapporteur moderates divergence (D6)
      when: "divergence(collect-iers) > scoring-criteria.divergenceBand" }
  - id: panel, type: decision-eval, model: panel-composition@2026.2.0        # CompositeOutcome (§2.3d)
  - { id: gate2, type: condition-gate, on: "panel.type == 'deny'", deny: emit-rejection }

  # ── Stage 3 — Ranking, budget line, award approval (cohort + pool; §2.4) ─────────────────────
  - { id: rank-and-fund, type: compute, ref: kt://frdg/RankAndFund@1.0.0,    # COHORT: rank round, draw pool (ballot G4)
      onBelowLine: { emit: emit-rejection, code: BELOW_BUDGET_LINE } }
  - id: reserve-budget, type: compute, ref: kt://frdg/QuotaReserve@1.0.0     # reserve() grant amount (ttl P30D)
  - id: award-approval, type: decision-eval, model: award-approval@2026.2.0  # four-eyes if > threshold (§2.3e)
  - id: approve, type: human-task, assignBy: assign-award-approvers@1.0.0    # 1 or 2 approvers; assessor≠approver

  # ── Stage 4 — Letter of Offer: issue → ACCEPT → activate (D5) ────────────────────────────────
  - id: issue-loo, type: issue-document, template: letter-of-offer@1.0.0     # doctemplate → Document (§2.6)
    binds: { decisionRecord: "${case.decisionRecord}", conditions: "${panel.conditions}" }
  - { id: await-acceptance, type: human-task, subState: awaiting-applicant,  # applicant counter-signs; CLOCK-STOPS
      sla: { budget: P30D, onTimeout: chain/offer-lapsed } }                 # unaccepted → offer-lapsed (releases pool)
  - id: activate-award, type: compute, ref: kt://frdg/QuotaCommit@1.0.0      # commit() on acceptance → award active

  # ── Stage 5 — Disbursement claims (external FINANCE system; RFI clock-stop) ──────────────────
  - id: claims, type: loop, over: "workPlan.claimTriggers"                   # PRE_FINANCING → INTERIM* → FINAL
    body:
      - { id: claim-intake, type: human-task, subState: awaiting-applicant }  # applicant files a Claim; CLOCK-STOPS
      - { id: finance-validate, type: human-task, assignBy: assign-finance-officer@1.0.0,   # finance validates (D6)
          onRFI: { subState: awaiting-applicant } }                          # RFI CLOCK-STOP (doc 04 §5.7)
      - id: disburse, type: external-task                                    # external FINANCE system (D3)
        request:  { schema: schema://finance/PaymentOrder/1,  adapter: adapter://finance/submit }
        response: { schema: schema://finance/PaymentResult/1, inbound: adapter://finance/reply }
        sla: { budget: P14D, onTimeout: chain/finance-esc-1 }, onNegativeAck: compensate

  # ── Stage 6 — Acquittal / audit (independent audit team can RE-OPEN; §3) ─────────────────────
  - { id: acquittal, type: human-task, subState: awaiting-applicant }        # final acquittal report; CLOCK-STOPS[^acquittal]
  - id: audit, type: human-task, assignBy: assign-auditor@1.0.0             # independent audit; can re-open (D6)
  - { id: release-retention, type: external-task, when: "audit.clean" }      # 10% retention on clean acquittal[^he-pay]
  # Stage 7 — Breach → clawback → revocation is reachable from Conditions (§2.7, Trace C)
```

The **clock-stop discipline** is the D1 signature: every `awaiting-applicant` sub-state (full application,
acceptance, claim intake, RFI, acquittal) **pauses the Agency's SLA** ([doc 04 §5.7](../../architecture/04-flow-and-case-layer.md)),
so months of applicant wait never count against the processing budget — while the **`external-task` SLAs**
(registry, finance) deliberately measure the *external system's turnaround* and escalate on it (§5.8).
Transport under each is pluggable (HTTP/MQ v1, SFTP round-trip post-v1; [doc 05 §11](../../architecture/05-adapters.md),
ADR-0028) — finance/registry integrations here are frequently batch/file-based.

### 2.6 doctemplates and issuance — the Letter of Offer, its variation, the revocation notice (D5)

Issuance is **`issue-document`** binding a **doctemplate** to Case data + the DecisionRecord. The **Letter of
Offer** is the hardest issuance test because **the issued Document participates in flow control** — it must be
*accepted* before the award activates.

```yaml
# doctemplates/letter-of-offer.doctemplate.yaml
kind: doctemplate
metadata: { id: letter-of-offer, version: 1.0.0, governanceState: released, owner: { team: programme-policy } }
lifecycle:
  states: [issued, accepted, declined, lapsed, superseded, revoked]   # the Document is STATEFUL (D5)
  activatesAwardOn: accepted                                          # award activates only on acceptance
binds:   # grantAmount, fundingRate pin, dual-audience conditions[], acceptBy (${today + P30D}; unaccepted → lapsed)
  grantAmount: "${decisionRecord.award.grantAmount}"   fundingRate: "${decisionRecord.award.pins['funding-rates']}"
  conditions:  "${panel.conditions}"                   acceptBy: "${today + P30D}"
copyset: frdg-copy@1.0.0
---
# doctemplates/award-variation.doctemplate.yaml — a VARIATION reissues the LoO as v2
{ kind: doctemplate, metadata: { id: award-variation, version: 1.0.0, owner: { team: programme-policy } },
  supersedes: letter-of-offer }              # → letter-of-offer @ v2; original `superseded`; DecisionRecord continuity
---
# doctemplates/revocation-notice.doctemplate.yaml — clawback issues a revocation notice (also an issued Document)
{ kind: doctemplate, metadata: { id: revocation-notice, version: 1.0.0, owner: { team: programme-policy } },
  binds: { revokedAward: "${award.id}", clawbackReason: "${clawback.reason}",   # codeRef → clawback-reasons
           amountRecoverable: "${clawback.amount}" } }   # recoverable as a debt[^clawback]
```

The Letter of Offer's **acceptance semantics** are load-bearing: `issue-loo` emits the Document `issued`;
`await-acceptance` blocks on the applicant's counter-signature (idempotent correlated signal); acceptance
transitions it to `accepted` **and only then** does `activate-award` `commit()` the reservation and start
disbursement — grounded in "grant enters into force on signature."[^he-pay] A **variation** (amend,
[doc 04 §5.6](../../architecture/04-flow-and-case-layer.md)) produces a **v2** via `award-variation`,
superseding v1 with DecisionRecord continuity; a **clawback** issues a **revocation notice**. All three are
**issued Documents recorded in the DecisionRecord**, reproducible as-of each issue instant.

### 2.7 Conditions — milestone obligations, breach, and the clawback branch

The panel's `conditional-approve` carries **Conditions** ([doc 04 §5.5](../../architecture/04-flow-and-case-layer.md)):
milestone obligations are **`post-approval-obligation`** with **deadlines**, tracked *after* the substantive
decision, each linked by `codeRef` to the clawback reason its breach triggers.

```yaml
# Conditions on the award Outcome (canonical shapes from doc 02 §9.3)
conditions:
  - code: MILESTONE_M1_REPORT   codeSet: award-conditions@2026.2.0   kind: post-approval-obligation
    deadline: { from: milestone.dueBy }
    onBreach: { emit: condition.breached, opens: clawback-flow }   state: pending   # missed deadline → clawback (Trace C)
  - { code: MAINTAIN_ELIGIBILITY, codeSet: award-conditions@2026.2.0, kind: post-approval-obligation, state: pending }
```

A **missed milestone deadline** flips the Condition to `breached`, raises a canonical `condition.breached`
event ([doc 08 §4.6](../../architecture/08-audit-and-observability.md)), and opens a **clawback Flow** — a
remediation Case that computes the recoverable amount, **releases the un-disbursed reservation back to the
pool**, recovers disbursed funds as a debt, and **issues the revocation notice** (§2.6). Because the breach
is a first-class audit event and the obligation outlived Case closure, "why was this grant clawed back, and
what returned to the round" is answerable via the why API.

---

## 3. Multiple organizations on one deployment (D3)

One deployment, **one org** (BRIEF §11), structured into **Teams** — departments and **partner organizations**
whose reviewers federate through a partner IdP ([doc 06 Part 4](../../architecture/06-identity-and-access.md), §1.5).
Three **Portals** ([doc 07 §5](../../architecture/07-ui-and-portals.md)), each with its own IdP + entitlements:

```text
CUSTOMER PORTAL (applicant orgs)      PARTNER PORTAL (external reviewers)     BACK-OFFICE PORTAL (Agency staff)
  • file GrantApplication               • reviewers from univ-* / industry-*    • programme-policy: eligibility, award
  • accept the Letter of Offer          • see ONLY assigned, non-conflicted      • programme-finance: claims, disburse, pool
  • submit Claims, acquittal              applications (list-filtered, below)     • panel-secretariat: moderate consensus
  • see own Case only                   • submit their IER only                  • programme-audit: read-ALL, can re-open
```

**Teams and separation of duties.** The OpenFGA Team model
([doc 06 §4.3](../../architecture/06-identity-and-access.md)) makes separation structural: `programme-policy`,
`programme-finance`, `panel-secretariat`, `programme-audit` are Agency departments; `univ-northgate`,
`industry-meridian`, … are **partner-org reviewer Teams** whose members federate via `saml-partner-*` and
reach **only** artifacts/Cases their Team is **assigned**.

**Reviewer isolation via list-filtering.** A reviewer's Portal query for "my applications" resolves through
the **same PDP** ([doc 06 §2.3](../../architecture/06-identity-and-access.md)); the OpenFGA `assignee`
relation is written **only for non-conflicted assignments** (the COI Decision §2.3b gates the write), so the
ReBAC filter set returns exactly the reviewer's assigned, non-conflicted applications — cross-team leakage is
**impossible by construction**, and a reviewer cannot even *enumerate* an application from their own
organisation, let alone score it.[^he-coi] The **own-organisation bar** itself is the §2.3b Decision over
the Team graph, so *why* a reviewer was excluded is recorded and explainable.

---

## 4. Three end-to-end walkthrough traces

### Trace A — funded with milestone conditions → acceptance → claim → disbursement

An `INNOVATION` application from a for-profit org, requested **EUR 620,000**; registry validation `VALID`;
three assigned reviewers (none from the applicant's org) score it.

```jsonc
// get_case_trace("FRDG-R2-0412") → Stage 2 panel composition (excerpt)
{ "case_id": "FRDG-R2-0412", "activityType": "INNOVATION",
  "registry-check": { "validationState": "VALID", "adapter": "registry/reply", "correlated": true },
  "collect-iers": { "quorum": 3, "returned": 3, "members": [
      { "authority": "rev-77@univ-northgate",   "scoreBreakdown": {"EXCELLENCE":4.5,"IMPACT":4.0,"IMPLEMENTATION":3.5}, "type":"approve" },
      { "authority": "rev-31@industry-meridian", "scoreBreakdown": {"EXCELLENCE":4.0,"IMPACT":4.5,"IMPLEMENTATION":3.0}, "type":"approve" },
      { "authority": "rev-52@univ-castleton",    "scoreBreakdown": {"EXCELLENCE":4.0,"IMPACT":3.5,"IMPLEMENTATION":3.5}, "type":"approve" } ] },
  "consensus": { "moderated": false, "divergence": 1.0, "note": "within band 1.5 — no rapporteur needed",
                 "consensusScores": {"EXCELLENCE":4.0,"IMPACT":4.0,"IMPLEMENTATION":3.5} },
  "panel": { "policy": "custom", "type": "conditional-approve", "total": 11.5, "rankScore": 12.0,  // Impact ×1.5 (INNOVATION)
             "conditions": ["MILESTONE_M1_REPORT","MAINTAIN_ELIGIBILITY"], "pins": { "scoring-criteria": "2026.2.0" } },
  // ── Stage 3–5 ──
  "rank-and-fund":   { "roundRank": 18, "fundingLine": 41, "belowLine": false, "cohortRecord": "FRDG-R2#award-ranking" }, // ballot G4
  "reserve-budget":  { "grantAmount": 434000, "pins": { "funding-rates": "2026.2.0" }, "committedAfter": 39.7e6 }, // 620000×0.70
  "award-approval":  { "route": "single-approver", "why": "434000 <= FOUR_EYES_AWARD 500000" },
  "issue-loo":       { "documentId": "LOO-0412", "state": "issued" },
  "await-acceptance":{ "state": "accepted", "counterSignedAt": "2026-08-29" },   // the Document participates in flow control
  "activate-award":  { "ledger": "committed", "awardId": "AW-0412", "status": "active" },
  "claims[0]":       { "claimType": "PRE_FINANCING", "finance-validate": "approved",
                       "disburse": { "adapter": "finance/reply", "paid": 217000, "correlated": true } } }
```

**What Trace A exercises:** genuine **multi-authority composition** (three attributed IERs → a `custom`
`CompositeOutcome`), **cohort ranking** against the funding line (rank 18 ≤ line 41), **pool reserve → commit**
on the funding rate (`620,000 × 0.70 = 434,000`), the Letter of Offer's **accept-to-activate** semantics, and
the first **disbursement `external-task`** — one DecisionRecord.

### Trace B — rejected on a criterion threshold, then appeal

An application scores consensus **Excellence 4.0 / Impact 2.5 / Implementation 4.0 = 10.5**. The total
clears 10, but **Impact 2.5 < 3.0** — and a criterion failure **cannot be compensated**.[^he-eval]

```jsonc
// explain_decision("FRDG-R2-0455") → Tier-0, auto
{ "answer": "Denied at panel: Impact consensus 2.5 is below the 3/5 threshold. Total 10.5 does not rescue a
   failed criterion — thresholds apply to each criterion individually.",
  "panel": { "policy": "custom", "type": "deny", "reasons": [{ "code": "BELOW_CRITERION_THRESHOLD",
             "criterion": "IMPACT", "codeSet": "scoring-criteria@2026.2.0" }] },
  "members": [ /* three attributed IERs, each with per-criterion Impact < 3 */ ] }
```

The applicant lodges an **appeal** (Horizon's **evaluation-review/redress** — a challenge to *process*, not
a re-scoring): a **correlated child Case** ([doc 04 §5.6](../../architecture/04-flow-and-case-layer.md),
`appeal-reasons` CodeSet) referencing the parent's DecisionRecord, judged **as-of the parent's pinned rules**:

```jsonc
// get_case_trace("FRDG-R2-0455-APL") → child appeal Case
{ "parent": "FRDG-R2-0455", "kind": "appeal", "ground": "PROCEDURAL_IRREGULARITY",
  "finding": "One reviewer (rev-19) had an undeclared recent co-authorship with a partner org — COI missed at assignment.",
  "remedy": "IER from rev-19 struck; a replacement reviewer (rev-63, non-conflicted) re-scored; consensus recomputed.",
  "panel": { "type": "conditional-approve", "total": 11.0, "pins": { "scoring-criteria": "2026.2.0" },
             "why": "Impact consensus 3.5 after the conflicted IER was struck and replaced." } }
```

**What this exercises:** the appeal is **not** a mutation of the closed parent — it is a governed child Case
whose remedy is *striking a conflicted authority's Outcome* from the composite and re-composing, judged as-of
the parent's pins. It also **exposes a COI miss** (the resolver did not know of a recent co-authorship;
[Gap G5](#g5--reviewer-assignment-fairness--minor)). Parent stays denied-and-superseded; child approves.

### Trace C — funded → milestone breach → clawback + revocation notice

Trace A's award `AW-0412` is active; **pre-financing EUR 217,000** was disbursed. The `MILESTONE_M1_REPORT`
obligation's deadline passes with no report.

```jsonc
// get_case_trace("FRDG-R2-0412") → obligation breach → clawback branch
{ "condition": { "code": "MILESTONE_M1_REPORT", "state": "breached",
                 "event": "condition.breached", "at": "2026-12-02" },
  "clawback-flow": { "reason": { "code": "BREACH_MILESTONE", "codeSet": "clawback-reasons@2026.2.0" },
    "recoverable": 217000,                              // disbursed pre-financing recoverable as a debt[^clawback]
    "ledger": { "release": 217000, "returnedTo": "FRDG-2026-R2", "committedAfter": 39.48e6 },  // pool release-back
    "issue-revocation": { "documentId": "REV-0412", "template": "revocation-notice@1.0.0", "state": "issued" },
    "award": { "id": "AW-0412", "status": "revoked" } } }
```

**What this exercises:** a **post-approval obligation outliving Case closure**, its **breach as a first-class
audit event**, the **clawback Flow** recovering the disbursed float as a debt and **releasing the reservation
back to the pool**, and the **revocation notice** as an *issued Document* (D5) — the mirror of the Letter of
Offer. The release-back is where D4's residual strains live ([Gap G3](#g3--budget-pool-residual-strains-beyond-the-quotaledger-proposal--minor-bordering-blocking)).

---

## 5. Checks-and-balances verification table

| Concern | ichiflow mechanism | Where it lands in the audit spine |
|---|---|---|
| **Conflict of interest** | COI is a **Decision over Team/org relations** (§2.3b) via `CoiResolver`; own-org/collaborator/co-author bars[^he-coi] | exclusion reason per reviewer; explainable via why API |
| **Reviewer isolation** | OpenFGA `assignee` written **only** for non-conflicted assignments; list-filtering returns only assigned apps ([doc 06 §2.3/§4.3](../../architecture/06-identity-and-access.md)) | leakage impossible by construction; assignment decision logged |
| **Separation: assessor ≠ approver ≠ payer** | reviewers/panel (assess) ∥ `programme-policy` (award) ∥ **second approver** above threshold ∥ `programme-finance` (pay) — distinct Teams/relations | four-eyes record; per-step principal attribution |
| **Multi-authority integrity** | each IER an **attributed `Outcome`**; `CompositeOutcome` keeps authorship; an `integrityFlag` **blocks the panel** | members[] attributed into DecisionRecord ([doc 03 §2.3](../../architecture/03-decision-layer.md)) |
| **Competent-authority validation** | program officer validates AI-assisted eligibility; rapporteur moderates divergent scores; finance validates claims (D6) | each validation a Task resolution on the spine |
| **Audit team can re-open** | `programme-audit` Team has **read-all**; acquittal audit can re-open a closed Case (§2.5) | re-open event + auditor identity |
| **Budget-pool integrity** | `QuotaLedger` `reserve`/`commit`/`release` with `committed ≤ capacity` invariant; ranked draw at the funding line (§2.4) | ledger deltas + cohort ranking record (ballot G2/G4) |
| **Issuance / acceptance** | Letter of Offer is a **stateful Document**; award activates **only on acceptance**; variation → v2; clawback → revocation Document (D5) | Document lifecycle transitions recorded as-of each issue |
| **Effective-dating & rule-change governance** | funding-rates / scoring-criteria pinned **per round**; `awaiting-applicant` clock-stops exclude RFI wait; a rate change = approval Case routed to owning-Team stewards, deprecation → impact analysis ([doc 03 §5.7–§5.8](../../architecture/03-decision-layer.md)) | pinned `codeSet@version` + clock-stops + approval-Flow on the spine |

---

## 6. Gaps (honest account)

Classified **blocking** (v1 cannot model the domain honestly without it) vs **minor** (expressible today, but
awkward enough to warrant a first-class affordance). Several **confirm** primitives sibling cases proposed —
this case adds new strains rather than re-proposing.

### G1 — Cross-Case portfolio invariants (one org's concurrent applications) — **BLOCKING**

The domain carries invariants that **span Cases**: an applicant org may hold **no more than N active awards
at once**; the **same cost cannot be double-funded** across two grants; a reviewer's COI/workload spans **all**
a round's applications. These are **peer, many-to-many** relationships, not the parent→child correlation
ichiflow supports today (appeal/correct/withdraw, [doc 04 §5.6](../../architecture/04-flow-and-case-layer.md))
nor batch fan-out — **exactly the Case-association gap the
[insurance case flagged as its hardest finding](./motor-insurance-claim.md#8-honest-gaps)** (one SIU
investigation spanning multiple claim Cases), now **confirmed from a second domain**: no **first-class
Case-link / association primitive** with its own visibility scope and DecisionRecord to express "these N
applications share a double-funding constraint" or "this org is over its active-award cap." **Proposal
(shared with insurance):** a **Case-association entity** (typed link kind, PDP-scoped, audited) + a
**portfolio-constraint check** over the association set. Until then: ad-hoc queries outside the artifact layer.

### G2 — Multi-authority scoring: `CompositeOutcome` works, but two seams strain — **MINOR**

This case is the design's **first correct exercise of `CompositeOutcome`** (D2), and it **holds** — N
reviewers *are* N authorities, quorum/weighted/custom compose them properly, honoring
[work-pass GAP #2](./work-pass-compass.md#gaps)'s line that single-authority scoring is a DRD. Two strains:

1. **Nested composition is real but unnamed.** Each member Outcome is *itself* a DRD score (§2.3c) and the
   panel composes *over* those DRDs — a **two-level** structure the design supports but does not **name**.
   Recommend a doc-03 note: *"a composite member's Outcome may itself be a DRD score; per-criterion scoring
   stays within the member (work-pass), composition stays across members."*
2. **`Outcome.scoreBreakdown[]` is still not first-class** — the **same gap work-pass flagged**
   ([its GAP #1](./work-pass-compass.md#gaps)), biting harder here: a rejected applicant is entitled to a
   **per-criterion, per-reviewer** breakdown, which today rides in the trace + the composite's `members[]`,
   not as a typed `Outcome` contract. This **confirms** the recommendation for a typed `Outcome.scoreBreakdown?`
   — and adds that it must survive **composition** (per-member breakdowns rolling into a consensus).

### G3 — Budget-pool residual strains beyond the `QuotaLedger` proposal — **MINOR (bordering blocking)**

The round budget **confirms the ballot's `QuotaLedger` (G2)** from an independent domain, but a **monetary,
ranked-draw** pool strains the ballot's count-based proposal three ways: **(a) variable-size reservation** —
consumption is a money amount (`capacity − committed − reserved ≥ grantAmount`), and the **funding line is a
cohort cutoff** (also **confirming the ballot's cohort-barrier G4** — the ranked list is a round artifact);
**(b) release-back reflow** — a clawback/under-claim (Trace C) releases budget back to a **closed** round, and
whether it reflows to the reserve list, the next round, or treasury is **policy the ledger does not model** (a
real fairness question); **(c)** the pool must pin its **rate version per commit**, which it does, but the
primitive should declare it. **Proposal:** extend `QuotaLedger` with **monetary dimensions, reserve-list draw
semantics, and a release-back policy hook** — one primitive, but covering money and reflow, not only headroom.

### G4 — Stateful issued Documents with acceptance & revocation — **BLOCKING (for the document layer)**

The Letter of Offer is not a one-way emission like the work-pass pass: it is a **stateful Document that
participates in flow control** (`issued → accepted → active`; `issued → lapsed → pool-release`), is
**superseded by a v2 variation**, and has a **revocation** counterpart — acceptance being a counter-signed
correlated signal that **gates award activation** (§2.6). The **Document / doctemplate / issue-document**
vocabulary (a sibling design) is used here as settled, but this case shows it must cover more than
*render-and-store*: a **lifecycle state machine**, **accept-to-activate gating**, **multi-party signature**
(co-applicants acceding[^he-pay]), **supersession continuity** (v1 → v2, one DecisionRecord lineage), and
**revocation-as-Document**. If the sibling design models issuance as emission only, **these are blocking for
this domain** and must be raised against it before v1 claims the grant lifecycle.

### G5 — Reviewer-assignment fairness — **MINOR**

The COI Decision (§2.3b) answers *who may not* review — not *who should*, fairly: reviewers have finite
capacity, expertise must match sector, load should spread across partner orgs. There is **no first-class
fair-assignment primitive**; today it is a routing Decision plus ad-hoc balancing, sharing shape with the
**cohort/set-level** need (assign a *set* of reviewers across a *set* of applications under per-reviewer caps;
[ballot G4](./public-housing-ballot.md#g4--cohort--set-level-decisioning-and-a-cohort-level-decisionrecord--blocking)).
Trace B also shows the resolver can **miss** a relationship it does not hold (recent co-authorship), so COI
correctness is **bounded by the graph data** available — a data-completeness boundary, not a blocker.
**Proposal:** a documented **set-assignment pattern** (capacity-constrained matching as a `compute` over the
cohort) plus a note on that boundary.

### Framing (must-state, non-technical)

The agency and program are **fictional**, so this study does **not** name a real government system in shipped
product (BRIEF §16) — but its mechanics are **grounded in and cited to real Horizon Europe rules**, so it
remains a **checkable external validation fixture**, admissible only as documentation, never as an onboarding
template or the reference product (the fictional municipal permit stays canonical). A governance guardrail,
not a technical gap.

---

### Where to go deeper

- CompositeOutcome, composition policies, feature-functions, governance dial, effective-dating —
  [`03-decision-layer.md`](../../architecture/03-decision-layer.md) §2.3–§2.6, §5.6–§5.8.
- `external-task`, `human-task`, clock-stop SLAs, Conditions, post-submission ops, staged Flows —
  [`04-flow-and-case-layer.md`](../../architecture/04-flow-and-case-layer.md) §2.8, §5.5–§5.8; CodeSets /
  `codeRef` / the `Outcome`/`CompositeOutcome` contracts — [`02-schema-foundation.md`](../../architecture/02-schema-foundation.md) §9.
- Teams, partner-org federation, list-filtering, one PDP design-time + runtime —
  [`06-identity-and-access.md`](../../architecture/06-identity-and-access.md) Part 4; Portals —
  [`07-ui-and-portals.md`](../../architecture/07-ui-and-portals.md) §5; transport profiles —
  [`05-adapters.md`](../../architecture/05-adapters.md) §11.
- The sibling gaps this case confirms — **`QuotaLedger`** / **cohort barrier**
  ([ballot G2/G4](./public-housing-ballot.md#7-gaps-honest-account)), the **Case-association** primitive
  ([insurance §8](./motor-insurance-claim.md#8-honest-gaps)), **`Outcome.scoreBreakdown`**
  ([work-pass](./work-pass-compass.md#gaps)) — and the canonical reference product
  ([`../creating-a-permit-product.md`](../creating-a-permit-product.md)).

---

<!-- Sources — Horizon Europe + grant-administration references (accessed July 2026) -->
[^he-eval]: European Commission, Horizon Europe proposal evaluation — three award criteria (Excellence,
    Impact, Quality & Efficiency of Implementation), each 0–5 (half-point), per-criterion threshold 3/5 and
    overall 10/15, no compensation; 3–4 independent experts write Individual Evaluation Reports then agree
    consensus scores; normally unweighted, Impact ×1.5 for Innovation-Action ranking only. Standard briefing
    slides: https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/experts/standard-briefing-slides-for-experts_he_en.pdf
[^he-form]: EC, "EU Grants: Evaluation form (HE RIA and IA)" — the per-criterion 0–5 scoring form experts complete.
    https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/horizon/temp-form/ef/ef_he-ria-ia_en.pdf
[^he-coi]: EC, "EU Experts: Code of conduct (evaluators/monitors)" — experts cannot evaluate proposals from their
    own organisation, ones they contributed to, or involving close collaborators; a conflict must be declared and
    work stopped; a knowingly-hidden conflict is null and void, recoverable, and can terminate the contract.
    https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/experts/code-of-conduct_en.pdf
[^he-rates]: EC / FFG, Horizon Europe funding rates — Research/Innovation Actions 100%, Innovation Actions 70%
    (100% for non-profit), Support Actions 100%. https://www.ffg.at/en/europe/heu/legal-financial/theme_funding-rates
[^he-pay]: EC / FFG, Grant payments in Horizon Europe — pre-financing (float, 30–70%, EU property until final);
    interim capped at 85% cumulative; final ≤15% (10% retention + Guarantee-Fund share); overpayment → recovery;
    grant enters into force on the authority's signature, other beneficiaries acceding via accession forms.
    https://www.ffg.at/en/europe/heu/legal-financial/theme_grant-payments ;
    https://webgate.ec.europa.eu/funding-tenders-opportunities/spaces/OM/pages/1867952/Grant+signature
[^he-pic]: EC, "Registration and validation of your organisation" — a 9-digit PIC is provisional until the Central
    Validation Service (run by REA) validates legal existence and financial capacity from registration acts/statutes.
    https://webgate.ec.europa.eu/funding-tenders-opportunities/display/OM/Registration+and+validation+of+your+organisation
[^acquittal]: Australian Government Dept. of Finance, "Australian Government Grants (RMG 412)" + grant-acquittal
    practice — an acquittal verifies funding was used per the grant agreement and reporting requirements were met.
    https://www.finance.gov.au/government/managing-commonwealth-resources/australian-government-grants-briefing-reporting-evaluating-and-election-commitments-rmg-412
[^clawback]: Australian Government Solicitor, "Legal briefing no. 112" — on breach of grant conditions a grant
    agreement commonly makes funds recoverable as a debt (clawback) and allows termination for events of default
    (incl. false information in the application). https://www.ags.gov.au/publications/legal-briefing/br112
