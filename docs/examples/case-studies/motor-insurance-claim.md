# Motor Insurance Claim Processing on ichiflow — an enterprise brownfield case study

> _This is **design fiction grounded in the real design**: an illustrative narrative of the
> **target v1 experience** (with a few pieces marked **post-v1**), not a transcript of a shipping
> product. Every artifact, CLI line, and MCP result below is written to be consistent with the
> architecture docs ([`../../architecture/BRIEF.md`](../../architecture/BRIEF.md) and `00`–`13`);
> where a reader wants the normative depth behind a moment here, the prose links to the doc that owns
> it. Nothing here runs yet._
>
> _**Two things make this the enterprise counterpart to the permit product**
> ([`../creating-a-permit-product.md`](../creating-a-permit-product.md), the canonical **greenfield**
> public-sector reference). First, it is a **brownfield / legacy-migration** story — the insurer
> already runs a policy admin system (PAS) and a claims system, so ichiflow arrives via the three-ring
> migration ([`../../architecture/11-migration-in-and-out.md`](../../architecture/11-migration-in-and-out.md)),
> and this document doubles as the **migration-exercise exemplar** (the (b)-clause of the v1 acceptance
> test, BRIEF §16). Second, it stresses dimensions the government cases do not: fraud triage with
> cross-claim investigation, a third-party partner ecosystem, an **external insurer** reached over a
> file-batch adapter, SLA-regulated timelines, and per-state-change reserving. It is honest about
> where those strain the model — see [§8 Gaps](#8-honest-gaps)._
>
> _The insurer is a fictional mid-size general insurer, **"Meridian Assurance."** **No real insurer or
> government system is named.** The domain is grounded in **publicly documented** industry practice:
> Singapore's GIA **Motor Claims Framework (MCF)** reporting/settlement timelines, the GIA **Barometer
> of Liability Agreement (BOLA)** apportionment chart (a real published decision table), standard
> **SIU** fraud-investigation practice, and standard case-**reserving** philosophy. Sources are cited
> inline and collected at the end._

The people in this story: **Lena** (an application developer at Meridian, pairing with Claude Code),
**Marcus** (claims operations lead — a business user, not a developer), and **Devi** (an SIU
investigator who never opens the repo and works entirely in the back-office Portal).

---

## 1. The brownfield setup, and the migration posture

Meridian has run motor claims for two decades on two systems that are not going away on day one:

- a **Policy Admin System (PAS)** — an Oracle database of policies, endorsements, and their
  effective-dated terms (the source of truth for _what was covered on the day of loss_); and
- a **legacy claims system** — a SQL Server database of claims, reserves, payments, and historical
  outcomes (liability decisions, settlement amounts, declines).

ichiflow does **not** rip these out. It arrives through **"map first, migrate last"**
([`../../architecture/11-migration-in-and-out.md`](../../architecture/11-migration-in-and-out.md) §2):
**Ring 0** binds the legacy tables onto ichiflow's canonical Schema with **zero or additive-only DDL**,
the legacy DBs stay authoritative, and read models (DB views / Trino federation) serve the data
without moving it.

```yaml
# migration/ring0/claim.mapping.yaml — canonical entity  <-  legacy binding (doc 11 §2.1)
entity: Claim
source: { table: CLM_MASTER, primaryKey: CLM_NO, system: legacy-claims-sqlserver }
fields:
  id:            { from: CLM_NO }
  policyNo:      { from: POL_REF }
  lossDate:      { from: DT_LOSS, type: plainDate }
  reportedDate:  { from: DT_NOTIFIED, type: dateTime }
  lossCause:     { from: CAUSE_CD, valueMap: codeset:loss-causes@2026.1.0 }   # legacy code → CodeSet
  status:        { from: STAT_CD, valueMap: { O: OPEN, S: SETTLED, D: DECLINED, R: REOPENED } }
  reserveTotal:  { from: RSV_AMT, type: money(currency=CCY) }
readModel: view
writePolicy: read-only          # Ring 0 never writes legacy tables; read-write is a governed upgrade
```

**PolicySnapshot — bitemporal stress, made explicit.** Coverage is not judged against the policy _now_;
it is judged against the terms **in force at the loss date**. ichiflow models this as a
**`PolicySnapshot`** entity: the as-of projection of the PAS over `lossDate`. Because the PAS keeps
effective-dated endorsement history, the Ring 0 read model reconstructs it — and because ichiflow's
audit spine is **bitemporal as-of** ([`../../architecture/08-audit-and-observability.md`](../../architecture/08-audit-and-observability.md) §3),
a claim decided today remains reconstructable against _both_ the policy terms in force at loss and the
_CodeSet / DecisionModel versions_ in force at decision time. Two time axes, one snapshot.

```yaml
# migration/ring0/policy-snapshot.mapping.yaml  (as-of loss date; bitemporal)
entity: PolicySnapshot
source:
  table: POL_TERMS                       # PAS effective-dated terms (Oracle), untouched
  asOf: "${ claim.lossDate }"            # temporal predicate → the terms row in force at loss
  primaryKey: [POL_REF, EFF_FROM]
fields:
  policyNo:     { from: POL_REF }
  inForce:      { from: [EFF_FROM, EFF_TO], transform: "asOf between EFF_FROM and EFF_TO" }
  perils:       { from: COVER_CDS, valueMap: codeset:perils@2026.1.0 }
  excess:       { from: XS_AMT, type: money(currency=CCY) }
  ncdPct:       { from: NCD_PCT }
  exclusions:   { from: EXCL_CDS, valueMap: codeset:exclusions@2026.1.0 }
```

**Decision parity is the safety net (doc 11 §4).** Meridian's legacy liability, coverage, and
settlement logic lived in PL/SQL and a spreadsheet. Re-expressing it as DecisionModels is only "done"
when it **matches historical outcomes** on a **golden dataset** of closed claims — not when it compiles.
Parity runs as business-readable Gherkin, continuously, over the full typed `Outcome` shape (type +
reasons + attached conditions), not a scalar:

```gherkin
# parity/liability-parity.feature  (runs continuously; doc 11 §4.3)
Feature: Migrated liability apportionment matches legacy claim outcomes
  Scenario: Rear-end collision, no sudden-braking defence
    Given a claim from golden dataset "closed-2024-liability" with scenario "REAR_END" and no defence flag
    When evaluated by the legacy engine and by DecisionModel "liability-apportionment@2.0.0"
    Then both outcomes apportion 100% to the rear vehicle
    And both cite BOLA scenario code "BOLA-01"
  Scenario: Approved-with-condition must migrate to the same typed outcome
    Given a golden claim the legacy engine settled with a post-repair inspection obligation
    When evaluated by DecisionModel "settlement-authority@1.0.0"
    Then the outcome type is "conditional-approve"
    And it carries condition "REPAIR-INSP-14" of kind "post-approval-obligation"
```

The cutover ladder is **shadow → canary → authoritative** (doc 11 §4.2; doc 03 §5.7): the migrated
DecisionModels evaluate _beside_ the legacy engine on live FNOL traffic, serve the trusted legacy
result, and record every mismatch until parity and SLOs hold. Only then does ichiflow become
authoritative for a slice — one loss cause, or one product, at a time (strangler routing, doc 11 §2.2).

---

## 2. Artifacts — the model

### 2.1 Schemas

Authored in TypeSpec, emitting the canonical JSON Schema / OpenAPI
([`../../architecture/02-schema-foundation.md`](../../architecture/02-schema-foundation.md) §1). The
core entities: **`Claim`** (carries `case_id`), **`PolicySnapshot`** (above), **`DamageAssessment`**,
**`ClaimItem`** (a repair line, referencing a repair-code CodeSet row), **`Party`** / **`Vehicle`**,
and **`ReserveLedgerEntry`** (append-only reserve history — see the reserving discussion in §8).

```typespec
// contracts/src/claim.tsp  (excerpt)
@jsonSchema model Claim {
  @doc("Global correlation id; the Case carries this as case_id.") id: string;
  policyNo: string;
  lossDate: plainDate;
  reportedDate: utcDateTime;
  lossCause: string;                 // codeRef → loss-causes CodeSet
  channel: FnolChannel;              // how the FNOL arrived (multi-channel intake, §2.4)
  vehicles: Vehicle[];
  thirdParty?: Party;                // present on third-party / liability claims
  items: ClaimItem[];
}
enum FnolChannel { phone: "PHONE", portal: "PORTAL", broker: "BROKER", workshop: "WORKSHOP" }
```

### 2.2 CodeSets (governed reference data, with `codeRef` interdependencies and owning Teams)

Reference tables are not string literals sprinkled through rules — they are governed **CodeSets**:
schema'd, semver-versioned, effective-dated, each with an **owning Team**, and **interdependent** via
`codeRef` columns whose referential integrity is validated at publish
([`../../architecture/02-schema-foundation.md`](../../architecture/02-schema-foundation.md) §9.1; BRIEF vocab).

| CodeSet | Purpose | `codeRef` dependencies | Owning Team |
|---|---|---|---|
| `loss-causes@2026.1.0` | Collision, theft, fire, flood, windscreen, third-party | — | Claims Policy |
| `injury-codes@2026.1.0` | Bodily-injury classification (BI reserving) | — | Claims Policy |
| `repair-item-codes@2026.2.0` | Labour + part operations | → `parts-catalogue` rows | Motor Assessing |
| `parts-catalogue@2026.2.0` | Part numbers + list prices (priced live via external-task, §2.5) | — | Motor Assessing |
| `bola-apportionment@2.0.0` | **Liability scenario → fault split** (the published BOLA chart) | → `loss-causes` | Claims Policy |
| `workshop-panel-tiers@2026.1.0` | Panel workshop tiers (A/B/C) + authorised repair scope | → `workshop` Team ids | Motor Assessing |

The **BOLA CodeSet is a real published decision table** — the GIA Barometer of Liability Agreement,
used by all Singapore insurers to apportion fault in common accident scenarios
([BOLA overview](https://sgaccident.com/understanding-the-barometer-of-liability-agreement-bola-in-singapore/);
[GIA MCF](https://gia.org.sg/motor-insurance/22-premium-renewal-of-policy/348-motor-claims-framework.html)).
Ichiflow imports it as governed reference data, preserving its dated revisions so a past claim stays
reconstructable against the chart in force at its decision time (doc 11 §2.5a):

```yaml
# codesets/bola-apportionment.yaml — the published BOLA chart as a governed CodeSet
kind: CodeSet
metadata: { id: bola-apportionment, version: 2.0.0, governanceState: released,
            owningTeam: claims-policy, effective: { from: 2008-06-01, to: null } }
rows:                              # apportionment = liability of the "claimant" vehicle
  - code: BOLA-01  scenario: "Rear vehicle hits front vehicle"            faultClaimant: 0    faultOther: 100
  - code: BOLA-05  scenario: "X changes lane into Y travelling in-lane"   faultClaimant: 0    faultOther: 100
  - code: BOLA-06  scenario: "Both vehicles changing lanes"              faultClaimant: 50   faultOther: 50
  - code: BOLA-11  scenario: "Emerging from minor road / car park"       faultClaimant: 100  faultOther: 0
  - code: BOLA-14  scenario: "Right-turn across oncoming traffic"        faultClaimant: 80   faultOther: 20
# NCD is unaffected where the insured's liability is <= 20% against an identified vehicle (GIA MCF).
```

### 2.3 DecisionModels

Authored as **decision source** (the LLM-friendly projection over the full DMN 1.6 surface,
FEEL throughout), compiling one-way to the executed DMN 1.6 XML
([`../../architecture/03-decision-layer.md`](../../architecture/03-decision-layer.md) §2.6). Each
returns a typed `Outcome` and references CodeSets by `id@version`.

**(a) Coverage verification** — evaluates the claim against the `PolicySnapshot` **as of loss date**:
policy in force, loss cause is a covered peril, no exclusion bites, excess applies. Output:
`approve | deny | refer` with reasons attributed to the coverage authority.

**(b) Liability apportionment** — a DMN **decision table** that _is_ the BOLA chart in decision source
form. The scenario is an input (classified from the accident circumstances); the table maps it to a
fault split and cites the BOLA code, with a `refer` fallthrough for scenarios the chart does not cover
or where a documented defence (e.g. front vehicle braked without valid reason) reopens the split:

```text
# decisions/liability-apportionment.decision-source (decision table, hit policy FIRST) — rendered view
| # | scenario  | defenceFlag | outcome.type | apportionment (claimant%) | reasons               |
|---|-----------|-------------|--------------|---------------------------|-----------------------|
| 1 | REAR_END  | false       | approve      | 0                         | BOLA-01 @2.0.0        |
| 2 | REAR_END  | true        | refer        | -                         | BOLA-01-DEFENCE @2.0.0|
| 3 | LANE_INTO | false       | approve      | 0                         | BOLA-05 @2.0.0        |
| 4 | BOTH_LANE | -           | approve      | 50                        | BOLA-06 @2.0.0        |
| 5 | -         | -           | refer        | -                         | BOLA-UNLISTED @2.0.0  |
```

**(c) Fraud score** — a **feature-prep compute** (a typed feature function, the same unified
code-activity contract as a Flow `compute` step; doc 03 §2.4) derives red-flag features from the
claim + policy + prior-claims history — **policy age at loss** ("policy freshness"), **time-to-report**,
**prior-claim count**, **provider/workshop anomaly** — which are the documented SIU red flags
([GEICO SIU](https://www.geico.com/claims/claimsprocess/special-investigations-unit/);
[Superunit, what is an SIU](https://www.superunit.com/blog/what-is-a-special-investigations-unit-siu)).
The features feed a **PMML scoring node** (doc 03 §4.1, §9), and a small DMN routes on the score band:

```text
# decisions/fraud-triage.decision-source (routing on the PMML score) — rendered view
| # | fraudScore | outcome.type | route                          | reasons          |
|---|------------|--------------|--------------------------------|------------------|
| 1 | < 0.40     | approve      | fast-track                     | -                |
| 2 | 0.40–0.75  | refer        | desk-review (adjuster)         | FRAUD-DESK @1.0  |
| 3 | > 0.75     | refer        | SIU investigation (human Task) | FRAUD-SIU  @1.0  |
```

> The scoring **model** itself is versioned and promoted through **shadow → canary → authoritative**
> (doc 03 §5.7). A new fraud model runs in **shadow mode** on 100% of live traffic — scored but not
> acted on — with catch-rate / false-positive metrics collected before it is promoted to champion,
> the standard insurance **champion/challenger** discipline
> ([FICO on champion/challenger](https://www.fico.com/blogs/benefits-championchallenger-testing-decision-management);
> [SparklingLogic, champion/challenger rollout](https://www.sparklinglogic.com/champion-challenger-for-rolling-out-deployments/)).
> Feature-prep in **Python** is the expected first post-v1 code-activity worker (BRIEF §4); in v1 the
> feature function is Kotlin/TS.

**(d) Settlement authority limits — approval routing as a Decision.** Who may approve a settlement is
a Decision over the amount, not a hard-coded `if`. It emits an `Outcome` carrying the required
**`authority`**, which the Flow uses to route the approval Task:

```text
# decisions/settlement-authority.decision-source (hit policy FIRST) — rendered view
| # | settlementAmount     | outcome.type          | authority           | conditions            |
|---|----------------------|-----------------------|---------------------|-----------------------|
| 1 | <= 5,000             | conditional-approve   | adjuster            | REPAIR-INSP-14        |
| 2 | > 5,000 and <=50,000 | conditional-approve   | claims-manager      | REPAIR-INSP-14        |
| 3 | > 50,000             | refer                 | settlement-committee | -                    |
```

### 2.4 The Flow

FNOL enters through **multiple channels** — phone (contact-centre app), the customer Portal, a broker
message, or a panel workshop — each an inbound **Adapter** normalising to one canonical
`ClaimReported` command
([`../../architecture/05-adapters.md`](../../architecture/05-adapters.md) §1). The MCF requires the
insured to report within **24 hours / the next working day**
([GIA MCF, Dos & Don'ts](https://gia.org.sg/motor-insurance/22-premium-renewal-of-policy/349-dos-and-don-ts-following-an-accident.html));
that window is a **pausable SLA clock** on the intake Task.

```typescript
// flows/motor-claim.flow.ts  (typed builder — compiles one-way to canonical Flow JSON; doc 04 §2.5)
export const motorClaimFlow = flow("motor-claim", { case: "Claim" })
  .decision("coverage",  { model: "coverage-verification@3.1.0", input: "policySnapshot" })
  .branch(on("coverage.type"), {
    deny:  seq(issueDoc("decline-letter", { doctemplate: "claim-decline@1.0" }),
               step.emit("notify", { adapter: "notify-insured" })),
    refer: human("coverage-review", { assignBy: "assign-adjuster@1.0.0", sla: "P7D" }),
    approve: seq(
      parallel(                                            // triage fans out (doc 04 §2.3)
        step.compute("damage-assessment", { ref: "kt://motor/AssessDamage@2.0.0" }),
        step.decision("liability", { model: "liability-apportionment@2.0.0" }),
        step.decision("fraud",     { model: "fraud-triage@1.4.0" })),      // shadow-promoted model
      step.branch(on("fraud.route"), {
        "siu-investigation": human("siu-referral", {                        // §3 trace 2
              team: "siu", sla: "P30D", escalation: "chain/siu-lead" }),
        "desk-review":       human("desk-review", { assignBy: "assign-adjuster@1.0.0", sla: "P5D" }),
        "fast-track":        seq(
          externalTask("parts-pricing", {                                   // §2.5 — supplier system
              submit: "adapter://suppliers/parts-quote-request",
              await:  "adapter://suppliers/parts-quote-reply",
              sla: "PT4H", correlation: { inject: "case_id & '/' & step.id",
                                          extract: "response.quoteRef" }}),
          step.decision("authority", { model: "settlement-authority@1.0.0" }),
          human("settlement-approval", { assignByAuthority: "authority.authority",  // §2.3(d)
                sla: "P3D", escalation: "chain/next-authority" }),
          issueDoc("repair-approval", { doctemplate: "approval-of-repair@1.0",
                to: "partner-portal:workshop" }),                           // partner workshop, §2.6
          externalTask("payment", {                                         // §2.5 — finance system
              submit: "adapter://finance/payment-instruction",
              await:  "adapter://finance/payment-confirmation",
              sla: "P2D", correlation: { inject: "case_id", extract: "response.paymentId" }}),
          issueDoc("discharge-voucher", { doctemplate: "discharge-voucher@1.0", to: "insured" }),
          issueDoc("settlement-letter", { doctemplate: "settlement-letter@1.0", to: "insured" }))),
    ) })
  .onThirdPartyLiability(subflow("subrogation", { flow: "subrogation@1.0.0" }));  // §3 trace 3
```

> **What Marcus judges (playground, read-only flow diagram):** a Mermaid projection rendered _from_ the
> canonical JSON — `coverage → {decline | review | triage → (fast-track | desk | SIU)}` with the
> parallel triage fan-out and the settlement approval chain — showing each Task's SLA and escalation.
> It is a read-only projection, not a second editable canvas (doc 04 §2.5).

Three flow moves carry weight and are called out below: **`issue-document`** steps, **`external-task`**
delegations, and the **`subrogation` sub-flow**.

### 2.5 `external-task` delegations — the machine analogs of a human Task

Three partners/systems are reached by **`external-task`**, ichiflow's canonical delegation step: submit
a schema'd request through an outbound Adapter, durably **await a correlated reply** through an inbound
Adapter, race a **pausable SLA clock**, and resume — the machine analog of a human Task
([`../../architecture/04-flow-and-case-layer.md`](../../architecture/04-flow-and-case-layer.md) §2.8, §5.8;
[`../../architecture/05-adapters.md`](../../architecture/05-adapters.md) §11). _Which_ system is chosen
can itself be a Decision (mirror of assignment routing).

| Delegation | Transport profile (doc 05 §11.2) | Correlation | v1? |
|---|---|---|---|
| **Parts pricing** → supplier system | (b) HTTP async callback | `quoteRef` echoed in callback | ✅ |
| **Payment** → finance/payment system | (d) MQ request-reply | `reply-to` + correlation-id header | ✅ |
| **Subrogation** → **external insurer** | **(e) SFTP file round-trip** | manifest / filename token; **record-level** for batches | **design-only, post-v1** |

The failure taxonomy is first-class: a **no-response timeout** is the SLA expiry (escalates), a
**negative-ack** is a typed reject the flow compensates on, and a **malformed/unmatchable reply** lands
in the **DLQ** and surfaces on the Case — never a silently stuck flow (doc 04 §2.8; doc 05 §11.3).

### 2.6 Teams — the third-party ecosystem and its data isolation

Panel workshops, independent adjusters, and tow operators are **partner-organisation Teams** — a Team
whose members federate through a **partner IdP** and reach _only_ artifacts and Cases their Team owns
or is assigned, enforced by the **same PDP** (OpenFGA ReBAC) at run time
([`../../architecture/06-identity-and-access.md`](../../architecture/06-identity-and-access.md) §4;
BRIEF vocab "Team"). A workshop logs into a **partner Portal** and sees **only its assigned repairs** —
not other workshops', not the fraud score, not the reserve. The **external insurer** in a subrogation
is _not_ a partner Team (it never federates into Meridian's deployment); it is a pure external system
reached over an Adapter — the distinction matters for isolation (§4).

### 2.7 `issue-document` — governed correspondence from `doctemplate`s

Outbound correspondence is modelled with the **`issue-document`** step: it renders a governed
**`Document`** from a versioned **`doctemplate`** and delivers it through an Adapter or a Portal. The
domain uses four: the **approval-of-repair letter** (to the workshop Portal), the **discharge voucher**
(to the insured, whose signature releases the claim), the **settlement letter**, and the
**decline letter**. Each rendered `Document` is snapshotted into the DecisionRecord so an auditor can
reproduce exactly what was sent. _(`Document` / `doctemplate` / `issue-document` are being specified by a
sibling design track; this case study uses the nouns ahead of their normative doc, now [ADR-0029](../../adr/0029-document-issuance.md)
/ [04 §2.9](../../architecture/04-flow-and-case-layer.md) / [07 §15](../../architecture/07-ui-and-portals.md) —
see [§8](#8-honest-gaps).)_

---

## 3. Walkthrough traces

### Trace 1 — a clean fast-track claim, within authority limits

A windscreen-and-bumper own-damage claim, reported same day through the customer Portal.

1. **FNOL intake.** The Portal Adapter normalises to `ClaimReported`; a **Case** opens with `case_id`
   `CLM-88213`. The MCF 24-hour reporting clock is satisfied and closed.
2. **Coverage.** `coverage-verification@3.1.0` reads the `PolicySnapshot` as of the loss date — policy
   in force, "collision" and "windscreen" are covered perils, excess $500 applies → `approve`.
3. **Triage (parallel).** `AssessDamage` computes a $3,900 repair estimate; `liability-apportionment`
   is not needed (own damage, no third party); `fraud-triage` scores **0.18** → `fast-track`.
4. **Parts pricing (`external-task`, HTTP callback).** The repair lines are priced against the supplier
   system; the reply correlates on `quoteRef` within the 4-hour SLA. Net of excess: **$3,400**.
5. **Authority.** `settlement-authority@1.0.0` → `conditional-approve`, `authority: adjuster` (≤ $5,000),
   carrying one **post-approval obligation** `REPAIR-INSP-14` (post-repair inspection within 14 days).
6. **Approval Task.** Routed to an **adjuster** by `assignByAuthority`. The adjuster approves. Note the
   **separation of duties**: the adjuster who _assessed_ is not the approver — the assignment Decision
   excludes the assessing user (§4).
7. **Correspondence + payment.** `issue-document` renders the **approval-of-repair letter** to the
   assigned workshop's Portal; the **payment** `external-task` (MQ request-reply) instructs finance and
   awaits the correlated `paymentId`; `issue-document` renders the **discharge voucher** and
   **settlement letter** to the insured.
8. **Obligation + close.** The Case moves to `ObligationsOpen` tracking `REPAIR-INSP-14`; when the
   workshop records the post-repair inspection, the obligation reaches `fulfilled` and the Case closes.

> **What Marcus judges:** an own-damage claim from FNOL to paid, within the adjuster's authority, in
> one uninterrupted flow — coverage against as-of terms, a fast-track fraud pass, two `external-task`
> round-trips, three issued Documents, and a tracked post-repair inspection. He read no FEEL.

### Trace 2 — a fraud-flagged claim → SIU investigation spanning two linked claims → declined + appeal

A theft claim, reported 3 weeks after a policy taken out 5 weeks earlier.

1. **Triage.** `fraud-triage@1.4.0`: the feature-prep compute flags **policy freshness** (loss 5 weeks
   after inception), a **long time-to-report**, and a **provider anomaly** (the same repair shop as a
   recent prior claim). PMML score **0.82** → `refer`, route **`siu-investigation`**.
2. **SIU Task.** A human Task is created on the **SIU Team** (`sla: P30D`, escalate to `siu-lead`) — the
   documented pattern of an adjuster referring a red-flagged claim out of the normal track into SIU
   ([Superunit, SIU](https://www.superunit.com/blog/what-is-a-special-investigations-unit-siu)). Devi
   picks it up. The claimant Portal shows a neutral "under review"; the fraud score is **not** exposed
   to the insured or to workshops (§4).
3. **Cross-claim linkage (the stress point).** Devi's investigation is not about one claim. The provider
   anomaly points at a **second, separate claim** (`CLM-88097`, a different policyholder, same shop).
   She needs **one investigation spanning two independent Cases** — a **peer, many-to-many** link, not a
   parent/child correction. Today ichiflow models parent→child correlated Cases (appeal/correct/withdraw,
   doc 04 §5.6) and batch-over-a-selector fan-out (doc 04 §2.4) — **but not a first-class peer
   Case-link/association entity with its own isolation and its own DecisionRecord**. This is a genuine
   model gap; see [§8](#8-honest-gaps). In the trace it is handled by an **investigation Case** that
   _references_ both claim `case_id`s in an association it must itself define.
4. **Investigation loop.** Devi records surveillance, an examination-under-oath note, and open-source
   findings as Task evidence. The SLA clock **pauses** whenever she issues a request-for-information to
   the insured (`awaiting-claimant`) — the pausable-clock machinery (doc 04 §5.7).
5. **Outcome.** SIU concludes fraud on both linked claims. The four documented SIU outcomes are
   paid-in-full / paid-with-adjustment / **denied on fraud grounds** / referral to authorities
   ([GEICO SIU](https://www.geico.com/claims/claimsprocess/special-investigations-unit/)). Coverage is
   re-decided to `deny` with reason `FRAUD-CONFIRMED`; `issue-document` renders the **decline letter**;
   a Suspicious-Activity referral is filed to the fraud bureau within the statutory window (commonly
   30–60 days from determination — [NY DFS SIU FAQ](https://www.dfs.ny.gov/apps_and_licensing/insurance_companies/faqs_fraud_siu)).
6. **Appeal (correlated child Case).** The insured appeals within the appeal window. This opens a
   **correlated child review Case** referencing the parent's DecisionRecord (doc 04 §5.6) — the
   supported operation. A different reviewer (not Devi, not the declining adjuster) works it; the appeal
   is dismissed and the decline stands.

> **What Devi judges:** a fraud path that scored, referred, paused-and-resumed across RFIs, declined,
> and filed a bureau referral — with the appeal as a clean correlated child. The **one** thing the
> model made her work around is the peer link between two independent claims.

### Trace 3 — a third-party liability claim → subrogation file-batch round-trip with the other insurer

Meridian's insured is rear-ended by a vehicle insured elsewhere. Meridian pays its own insured, then
**recovers** (subrogates) against the other insurer.

1. **Liability.** `liability-apportionment@2.0.0` classifies the scenario as `REAR_END`, no
   sudden-braking defence → **BOLA-01**, other vehicle **100%** at fault
   ([BOLA](https://sgaccident.com/understanding-the-barometer-of-liability-agreement-bola-in-singapore/)).
   The insured's NCD is protected (liability ≤ 20% against an identified vehicle, per the MCF).
2. **Own settlement.** Meridian settles its insured's own-damage repair via the fast-track path (Trace 1
   mechanics), then triggers the **`subrogation` sub-flow** to pursue recovery.
3. **Inter-company correspondence — the SFTP profile (design case).** The external insurer is reached
   over the classic industry **EDI / file-batch** pattern: a **subrogation demand** is written to an
   outbound SFTP directory as `subro-req-<corr>.xml` (or a **batch** of demands with a manifest), and a
   response file `subro-resp-<corr>.xml` appears later carrying accept / dispute / counter-offer per
   demand. This is the **`external-task` transport profile (e) — SFTP file round-trip**, which is
   **designed now and implemented post-v1** (doc 05 §11.2e). The v1 value is that the flow can already
   **declare** the delegation against a stable correlation contract:

   ```yaml
   # flows/subrogation.flow.yaml — external-task over the SFTP file round-trip (profile (e))
   - id: subrogation-demand
     type: external-task
     submit: adapter://interco/subro-demand-out          # OUTBOUND SFTP drop (§05 §2, §8)
     await:  adapter://interco/subro-response-in          # INBOUND response file, schema-validated
     correlation:
       inject:  { as: filenameToken, pattern: "subro-req-${case_id}.xml" }
       extract: "manifest.correlationId"                  # naming-convention / manifest correlation
       recordLevel: "row.demandRef"                       # batch: each demand row matched to its result
     sla: { budget: P30D, onTimeout: chain/recovery-lead } # inter-co replies are slow; SLA measures theirs
     response: { schema: schemas/SubrogationResponse.json } # malformed → DLQ + Case surfacing
   ```

4. **Round-trip resolution.** The response file accepts the 100% demand; the recovery is booked. Had it
   **disputed**, the negative-ack would branch the sub-flow to a negotiation Task; a **malformed** file
   would land in the **DLQ** and surface on the Case (doc 05 §11.3). Zone placement rides the **one-way
   DMZ relay** — the demand egresses through a controlled outbound Adapter and the response re-enters
   through an inbound DMZ Adapter, no synchronous callback into the intranet (doc 05 §11.3, §8).

> **What Lena judges:** a subrogation round-trip declared today against a transport that lands
> post-v1 — same `external-task` step, same correlation contract, only the SFTP binding implementation
> deferred. The step is unchanged whether the reply arrives over MQ, a webhook, or a response file.

---

## 4. Checks and balances

| Control | Mechanism in ichiflow | Where |
|---|---|---|
| **Settlement authority limits** | `settlement-authority` **Decision** emits `Outcome.authority` (adjuster ≤ $5k, manager ≤ $50k, committee > $50k); the Flow routes the approval Task by that authority — limits are a versioned, simulated, explained Decision, not a hidden `if` | §2.3(d); doc 03 §2.3 |
| **Adjuster / approver separation** | The `assign-*` **assignment Decision** excludes the user who performed the assessment; approval is a distinct Task; both actors are attributed in the DecisionRecord | Trace 1.6; doc 04 §5.3 |
| **Investigator / decline / appeal separation** | The SIU investigator, the declining adjuster, and the appeal reviewer are three different actors, enforced by assignment Decisions and role-as-relation | Trace 2.5–2.6 |
| **Partner-org data isolation** | A workshop Team reaches **only its assigned repairs** via OpenFGA ReBAC ownership; it never sees the fraud score, the reserve, or other workshops' Cases; the external insurer is not a Team at all | §2.6; doc 06 §4 |
| **Fraud-score confidentiality** | The score is a back-office/SIU artifact; customer and partner Portals render a neutral status, driven by per-audience field-level PDP | Trace 2.2; doc 06 §8 |
| **Model change safety** | Fraud/liability model changes promote **shadow → canary → authoritative** with champion/challenger metrics before acting | §2.3(c); doc 03 §5.7 |
| **Parity vs legacy** | Migrated Decisions must match historical outcomes on a golden dataset (full typed `Outcome`, incl. conditions), run continuously as Gherkin | §1; doc 11 §4 |
| **Correspondence integrity** | Every `issue-document` snapshots the rendered `Document` into the DecisionRecord | §2.7 |
| **As-of correctness** | Coverage judged against the `PolicySnapshot` in force at loss date; CodeSet/DecisionModel versions pinned per Case (bitemporal) | §1; doc 08 §3 |

---

## 5. What exists in git at the end, and the exit story

```text
meridian-motor/
  migration/ring0/          claim.mapping.yaml · policy-snapshot.mapping.yaml   # Ring 0, read-only
  parity/                   liability-parity.feature · coverage-parity.feature  # golden-dataset gates
  contracts/src/            claim.tsp · policy-snapshot.tsp · document.tsp
  codesets/                 loss-causes · injury-codes · repair-item-codes · parts-catalogue
                            bola-apportionment · workshop-panel-tiers          # owning Teams
  decisions/                coverage-verification · liability-apportionment · fraud-triage
                            settlement-authority · assign-adjuster (+ scenarios/)
  flows/                    motor-claim.flow.ts → .json · subrogation.flow.yaml
  doctemplates/             approval-of-repair · discharge-voucher · settlement-letter · claim-decline
  adapters/                 fnol-{portal,phone,broker,workshop} · suppliers · finance · interco(SFTP)
```

Nothing is trapped: Decisions export as **DMN 1.6 XML** to any TCK-L3 engine, the Flow as
**CNCF-Serverless-Workflow-aligned JSON**, Schemas as **OpenAPI 3.1 / JSON Schema 2020-12**, CodeSets
and case data as standard dumps, and the parity harness proves equivalence on the way out — **migration
OUT is as supported as migration IN** (doc 11 Part B). The one non-portable artifact is the fraud
feature-prep code activity, but it is **schema'd at its boundary with golden datasets**, so its
behaviour is specified even though the code does not port, and it is counted against the workspace
portability score (doc 04 §2.6).

---

## 6. Where to go deeper

- Ring 0 mapping, parity testing, shadow/canary cutover, exit story — [`../../architecture/11-migration-in-and-out.md`](../../architecture/11-migration-in-and-out.md)
- DMN Decisions, decision source, feature functions, PMML, authority/composition, shadow promotion — [`../../architecture/03-decision-layer.md`](../../architecture/03-decision-layer.md)
- Flows, `external-task`, human Tasks, pausable SLA clocks, Case operations (appeal) — [`../../architecture/04-flow-and-case-layer.md`](../../architecture/04-flow-and-case-layer.md)
- Adapters, transport profiles (incl. SFTP file round-trip), DMZ one-way relay — [`../../architecture/05-adapters.md`](../../architecture/05-adapters.md)
- Partner-org Teams, PDP isolation, per-audience field-level rendering — [`../../architecture/06-identity-and-access.md`](../../architecture/06-identity-and-access.md)

---

## 7. Sources (publicly documented industry practice)

- GIA **Motor Claims Framework** (reporting timelines, 3-step process, consequences): <https://gia.org.sg/motor-insurance/22-premium-renewal-of-policy/348-motor-claims-framework.html> · Dos & Don'ts: <https://gia.org.sg/motor-insurance/22-premium-renewal-of-policy/349-dos-and-don-ts-following-an-accident.html> · MCF brochure (PDF): <https://gia.org.sg/images/pdf-files/MCF_Brochure.pdf>
- GIA **Barometer of Liability Agreement (BOLA)** — the published apportionment chart: <https://sgaccident.com/understanding-the-barometer-of-liability-agreement-bola-in-singapore/> · chart (PDF): <https://sgcarsworkshop.weebly.com/uploads/2/8/5/6/28568763/barometer_of_liability_chart_v3_dated_1_jun_08.pdf>
- **SIU** fraud-investigation practice (red flags, referral, four outcomes, SAR timeframes): GEICO <https://www.geico.com/claims/claimsprocess/special-investigations-unit/> · Superunit <https://www.superunit.com/blog/what-is-a-special-investigations-unit-siu> · NY DFS SIU FAQ <https://www.dfs.ny.gov/apps_and_licensing/insurance_companies/faqs_fraud_siu>
- **Reserving** philosophy (review reserve whenever the file is touched; BI subjective+objective): CLM Magazine <https://www.theclm.org/Magazine/articles/claims-liability-case-reserve-management/536> · JAMS <https://www.jamsadr.com/insight/2021/a-mediators-guide-to-claims-reserves-in-the-insurance-industry>
- **Champion/challenger & shadow deployment** for fraud/scoring models: FICO <https://www.fico.com/blogs/benefits-championchallenger-testing-decision-management> · SparklingLogic <https://www.sparklinglogic.com/champion-challenger-for-rolling-out-deployments/>

---

## 8. Honest gaps

Where the domain strains the current design. **[BLOCKING]** needs a design decision before v1 could
claim this case; **[MINOR]** is a known phasing or a resolvable modelling choice.

- **[BLOCKING] Cross-Case peer linkage (many-to-many).** A single SIU investigation spanning **multiple
  independent claim Cases** (Trace 2.3) is a **peer, many-to-many association**, not the parent→child
  correlation ichiflow supports today (appeal/correct/withdraw child Cases, doc 04 §5.6) nor the
  batch-over-a-selector fan-out (doc 04 §2.4). There is **no first-class Case-link / association
  primitive** with its own visibility scope, its own DecisionRecord, and cross-Case isolation rules
  (an SIU investigation must be readable across the linked claims _without_ collapsing their separate
  ownership/audit boundaries). This needs a designed **Case-association entity** (typed link kind,
  PDP-scoped, audited) before the fraud-investigation dimension is honestly "modelled." It is the single
  hardest thing this case study surfaces.

  **Resolved (2026-07 gap-fix round):** adopted as the first-class **`Case association`**
  ([ADR-0032](../../adr/0032-case-association.md), [04 §5.11](../../architecture/04-flow-and-case-layer.md)) — a
  typed (`investigation-group`), PDP-scoped, audited many-to-many peer link whose **own visibility scope**
  grants an investigator read **across** the linked claims without collapsing their separate ownership/audit
  boundaries, carrying its own DecisionRecord and cross-Case invariant checks. This SIU-across-claims gap was
  the source; the grants portfolio gap confirmed it independently. **No longer blocking.**

- **[MINOR, but a real tension] Reserve-writing Decisions.** The requirement that _each state change
  re-computes the reserve_ collides with a locked property of the Decision layer: a Decision is a
  **pure evaluation with no hidden side effects** (doc 03 §3, SPI `evaluate` — "in → out, no hidden side
  effects"). A Decision **cannot write entity state**. The resolvable pattern is **emit-then-persist**:
  a `reserve-estimate` Decision returns the new reserve as an `Outcome`, and a Flow **`compute` step +
  the audited runtime path** appends a `ReserveLedgerEntry` (never git — runtime business data, BRIEF
  §21a). So "a Decision writes the reserve" is a category error; the _Flow_ persists the Decision's
  output. Two residual strains remain worth flagging: (a) re-evaluating on **every** state transition is
  a high-frequency Decision cadence whose cost/audit-volume should be measured; and (b) the reserve is a
  **read-model-derived write back into an owned ledger**, which is exactly the Ring 0 `read-only →
  read-write` upgrade whose governance is still an open question (doc 11 open Q7). Not blocking, but the
  "Decision writes state" framing should be corrected to "Decision emits, Flow persists" wherever it
  appears.

- **[MINOR] SFTP file-round-trip transport is design-only (post-v1).** The subrogation round-trip with
  the external insurer (Trace 3) uses `external-task` transport profile **(e)**, which is **designed now,
  implemented post-v1** (doc 05 §11.2e). A v1 deployment can _declare_ the delegation against a stable
  correlation contract but cannot _execute_ the inter-company file batch until the binding lands. Known
  phasing, not a design gap — but this case study cannot run end-to-end in v1 for the third-party
  recovery leg.

- **[MINOR] `Document` / `doctemplate` / `issue-document` are pre-normative.** These nouns are being
  specified by a sibling design track; this case study uses them ahead of their owning doc. The shape
  assumed here (an `issue-document` Flow step rendering a governed `Document` from a versioned
  `doctemplate`, snapshotted into the DecisionRecord) should be reconciled with that spec when it lands.

  **Resolved (2026-07 gap-fix round):** reconciled against [ADR-0029](../../adr/0029-document-issuance.md) /
  [04 §2.9](../../architecture/04-flow-and-case-layer.md) / [07 §15](../../architecture/07-ui-and-portals.md) —
  the assumed shape (an `issue-document` step rendering a governed `Document` from a versioned `doctemplate`,
  snapshotted into the DecisionRecord) matches the normative definition directly, and the **discharge voucher
  whose signature releases the claim** is the ADR-0029 **acceptance facet** (`issued → accepted`) whose
  accepted-event gates the settlement step.

- **[MINOR] PolicySnapshot as-of fidelity depends on legacy PAS history.** Reconstructing policy terms
  as of the loss date (bitemporal §1) assumes the PAS retained effective-dated endorsement history with
  enough granularity. Where the legacy PAS overwrote terms in place, the Ring 0 read model cannot
  reconstruct a faithful as-of snapshot, and coverage-at-loss must fall back to a stored snapshot taken
  at FNOL — a data-availability caveat inherited from the brownfield source, not an ichiflow defect.

- **[MINOR] Python feature-prep is post-v1.** The fraud feature function is naturally Python (ML
  feature-prep), but v1 code-activity workers are Kotlin/TS only; Python is the **expected first post-v1**
  worker (BRIEF §4). In v1 the feature-prep is Kotlin/TS, which is adequate but not the ergonomic target
  for a data-science team.
