# Case study — a multi-agency business-licensing platform (Singapore GoBusiness Licensing / LicenceOne)

> _This is a **design-validation case study**, not a shipped product and not the canonical reference
> product. It deliberately models a **real, publicly documented** government platform — Singapore's
> **GoBusiness Licensing** (the portal formerly branded **LicenceOne**, itself the successor to the
> **Online Business Licensing Service, OBLS**) — because a whole-of-government licensing hub is one of the
> most **multi-organization, catalog-shaped, autonomy-preserving** pieces of public infrastructure in the
> world, and therefore an honest, checkable stress-test of whether ichiflow's primitives are **generic
> enough** to host a platform of that class. Every fact about the real system below is grounded in public
> sources (GovTech, MDDI, gobusiness.gov.sg, agency pages), cited inline; nothing here is invented policy._
>
> _**On the "no real government systems are named" rule (BRIEF §16).** That rule governs ichiflow's
> shipped **templates and reference product** — the canonical example stays the fictional municipal permit
> ([`../creating-a-permit-product.md`](../creating-a-permit-product.md)). This document is a different
> artifact class: an **external validation fixture** whose facts are a matter of public record, used to
> pressure-test the framework the way a compiler team tests against a published language spec. It ships as
> documentation, never as an onboarding template. The distinction is restated in [GAPS](#gaps)._
>
> _This study is the **generalization** of its nearest cousin,
> [`./customs-declaration.md`](./customs-declaration.md). Customs is **multi-authority fan-out on ONE fixed
> application** (one declaration, a `CompositeOutcome` over a computed CA set). This study asks the harder
> question: can **ONE ichiflow deployment host N quasi-autonomous agencies**, each owning its own artifacts
> and issuing its own licences, where even the **set of applications** is computed per applicant — without
> hard-coding anything per-agency? Where the two overlap (routing-is-a-Decision, `CompositeOutcome`,
> `external-task`, `issue-document`) the customs study carries the detail; this one focuses on what is
> **new**: the catalog, the bundle-Case, and the agency-as-Team-vs-tenant seam._

---

## 1. Why this case, and what it stresses

OBLS launched in **January 2004** with online application for ~20 licences; within its first year it
covered the licences ~80% of new start-ups needed.[^obls] It was re-platformed as **LicenceOne in 2016**
and **rebranded GoBusiness Licensing on 31 October 2019**,[^rebrand][^mddi] and today advertises a
one-stop gateway to roughly **200–260 business licences issued by ~29–30+ government agencies**[^scale][^wiki]
(the range is real — see [PART 1](#part-1--the-real-system) on why sources disagree). The parent GoBusiness
platform reports **120+ e-services, 200+ e-Advisers, and 6 million+ government-to-business
transactions**.[^govtech] The design question is not "can ichiflow model *a* licence" (the reference
product already does) — it is whether the framework is **generic enough to be the substrate for a platform
of that shape**, where agencies stay autonomous and the catalog is open-ended.

Each later section exercises one stress dimension, stated up front, and each maps to one of the six
assessment axes in the brief:

- **(S1) N quasi-autonomous agencies in ONE deployment.** SFA, SPF, BCA, NEA, MOM, … each own their own
  rules, forms, SLAs, approval chains, and back-ends, yet share one portal.[^scale] This is the
  **Agency-as-Team** question, and it is where the **sub-org-vs-tenant seam** ([06 Part 3/4](../../architecture/06-identity-and-access.md))
  gets its sharpest test.
- **(S2) Licence-type as a declarative bundle in a catalog.** A "Food Shop Licence" is *itself* a
  composite artifact: schema + applicability rule + processing Flow + fee CodeSet + doctemplate + SLA
  config, discoverable and versioned. Is that a **new first-class catalog primitive**, or does artifact
  discovery + CodeSets suffice?
- **(S3) Guided Journey = an applicability Decision over the catalog.** "Tell us about your business → here
  are the licences you need" is a Decision that must **quantify over every registered licence type's
  applicability rule**.[^eadviser][^ssic] Cross-artifact evaluation — does the architecture support it?
- **(S4) Dynamic composite applications.** Unlike customs (a *fixed* CA set per declaration), here the
  **set of sub-Cases is computed per applicant**, each sub-Case running a **different agency's** Flow with
  its own SLA, tracked as one bundle with **partial outcomes** (three approved, one rejected).[^multi] Does
  parent-Case/sub-Case + `CompositeOutcome` express this, or is a new **bundle** shape needed? Relate to
  the housing-ballot cohort gap ([public-housing-ballot G4](./public-housing-ballot.md)).
- **(S5) Centralized issuance from multiple agencies, two depths at once.** Some agencies issue **through
  the platform** (doctemplate + `issue-document`); others issue **in their own systems** (BCA runs its own
  Advertisement Licensing System) with the platform recording metadata + verification — **external
  delegation depth 2** (ADR-0029).[^bca][^apex] Both must coexist, chosen per licence type.
- **(S6) Checks and balances across organizations.** Agency A cannot see or change agency B's rules or
  cases; the central platform team owns shared reference data (SSIC business-activity codes) that *every*
  agency reads; cross-agency data-sharing is consented.[^ssic][^apex] All through the one PDP + owning-Team
  model ([06 Part 4](../../architecture/06-identity-and-access.md)).

---

## PART 1 — the real system

### 1.1 History and scale (verify the numbers honestly)

| Era | Name | Scope (as published) |
|---|---|---|
| Jan 2004 | **OBLS** (Online Business Licensing Service) | launch with ~20 licences; UN Public Service Award 2005; processing 21→8 days by 2005[^obls][^wiki] |
| ~2016 | **LicenceOne** | re-platform of OBLS; "260 business licences … more than 30 government agencies"; update/renew/terminate for ~65[^wiki] |
| 31 Oct 2019 → now | **GoBusiness Licensing** | one-stop portal, "~200+ licences across ~29 agencies"; part of GoBusiness (120+ e-services, 6M+ transactions)[^rebrand][^mddi][^scale][^govtech] |

**Where the numbers run out (stated honestly):** public sources **disagree on the exact counts** — the
LicenceOne-era Wikipedia figure is *260 licences / 30+ agencies*;[^wiki] recent GovTech/portal marketing
says *~200–220 licences / ~29 agencies*.[^scale][^govtech] Both are plausibly correct at their respective
dates (licences get consolidated, digitized-then-retired, or moved to agency-native e-services). This study
**does not depend on a precise count** — the load-bearing fact is the *order of magnitude*: **tens of
licence types, ~30 agencies, one portal.** Where a number below is used illustratively it is marked.

### 1.2 The Guided Journey / e-Adviser — applicability determination

The discovery layer answers *"which licences does my business need?"* before any application exists. Two
public surfaces:

- **e-Adviser** — the applicant answers guided questions about their activity; the tool returns a
  **tailored list of required licences and permits**.[^eadviser] There are **200+ e-Advisers**.[^govtech]
  The determination is seeded by the business's **SSIC code** (Singapore Standard Industrial
  Classification, the up-to-5-digit activity code chosen at ACRA registration): the SSIC "serves as a guide
  to help you understand what licences you need," and ACRA may **refer** an application to the relevant
  licensing authority.[^ssic]
- **Guided Journey / Application Journey** — a phased successor (launched **food-services first**, expanding
  to more industries) that not only lists the licences but shows the **correct order** to apply, customized
  to the business concept, and **auto-routes the forms to the relevant agencies concurrently for parallel
  processing**.[^eadviser][^multi] Some licences are **prerequisites** of others and some are **mutually
  exclusive** (Halal Certification vs Liquor/Tobacco licences), and the Journey encodes those
  dependencies.[^multi]

The applicability determination is therefore a **rule evaluated against the whole catalog**, seeded by a
shared activity taxonomy (SSIC) — exactly the cross-artifact shape (S3) stresses.

### 1.3 Composite / bundled applications spanning agencies

GoBusiness lets a business **apply for multiple licences simultaneously in a single transaction**, with
**one payment** and a **centralised dashboard** that tracks status and **shows which agency is reviewing**
each part.[^multi][^status] The set is **not fixed** — it is whatever the Journey computed for that
business. This is the crucial generalization over customs: customs has *one* application decided by many
authorities; GoBusiness has *many* applications (one per licence), each owned by a different agency,
**bundled** for the applicant.

### 1.4 Per-licence SLAs, fees, validity (illustrative, cited)

Each licence type carries its **own** fee, processing time, and validity — set by the issuing agency, not
the platform. Concretely (figures cited; treat as illustrative-of-shape, agencies revise them):

| Licence type | Agency | Fee | Processing SLA | Validity |
|---|---|---|---|---|
| **Food Shop Licence** | SFA | **S$195**[^sfa] | ~**7 working days** (complete app)[^sfa] | **1 year**[^sfa] |
| **Liquor Licence** (Class 1A…4) | SPF | **S$110–S$880** by class[^liquor] | ~**3 weeks**[^liquor] | ~1–2 years[^liquor] |
| **Outdoor Advertising Sign / Signboard Licence** | BCA | (per size/type) | ~**7 working days**, **+2 weeks if URA evaluation**[^bca] | per licence |

The heterogeneity is the point: the platform holds **no single SLA or fee model** — each licence type
declares its own, and the bundle view must aggregate three different clocks and three different fees.

### 1.5 How agencies retained autonomy — the integration split

This is the least-documented and most important architectural fact, so the inference is marked. What is
**public**: GovTech's **APEX (API Exchange)** is the central, authorised API repository through which
GoBusiness talks to agencies; because "different agencies use different protocols … some of those methods
… legacy systems," GovTech **"service-wraps"** legacy agency formats into a form GoBusiness can call.[^apex]
The Guided Journey **auto-routes forms to relevant agencies concurrently**, and the dashboard reflects
**which agency is reviewing**.[^multi] Independently, **BCA runs its own Advertisement Licensing System
(ALS)** for signboard licences — a distinct agency back-end.[^bca]

From these public facts the **split is evident** (and this is the inference): **some agencies process
applications inside the shared platform's back-office** (their officers review in the portal), while
**others integrate the platform to their own licensing back-ends** (the application is handed off over an
APEX-wrapped API and the agency decides/issues in its own system, returning status/metadata). Public
documentation does **not** enumerate which agency is on which side, or the message contracts — so this study
**models both modes** and marks the mapping as illustrative. The design consequence is unambiguous: a
generic platform must support **per-licence-type choice of "review here" vs "delegate to the agency's
system"** without forking.

### 1.6 Amendments, renewals, cancellations; issuance & verification

- **Manage licences** — GoBusiness offers **renew / amend / cancel** from *My Licences* (a "Due for
  Renewal" tab), but **not uniformly**: "not all licence types support self-service amendments … your
  licence may require you to contact the issuing agency directly," and "amendment may require a separate
  approval process depending on the licence and amendment type."[^amend][^status] i.e. the **operation set
  is per-licence-type**, again agency-owned.
- **Issuance & delivery** — for licences applied through the portal, the approved licence is **downloadable
  from *My Licences* within one business day of approval**; the applicant logs in with **Singpass** (acting
  for a UEN-registered entity via **Corppass** assignment).[^download] Status is tracked in *My
  Submissions* with email notification on determination.[^status]

Public docs do not describe a cross-agency cryptographic verification endpoint (unlike customs' CCP), so
this study treats **portal-issued vs agency-issued** licences as the two issuance depths and does **not**
overclaim a unified verify API.

---

## PART 2 — mapping to ichiflow, generically

The whole point is to map the *class of platform*, never a per-agency special case. Each subsection takes
one assessment axis, shows the generic artifact shape, and argues where it strains.

### 2.1 (S1) Agency-as-Team — and where a Team stops being a Team and becomes a tenant

An agency is modelled as a **Team** ([06 Part 4](../../architecture/06-identity-and-access.md)): a
first-class sub-structure of the one deployed org that **owns** its Schemas, DecisionModels, CodeSets,
doctemplates, and Flows, with `steward`/`approver`/`editor`/`viewer` **role-as-relations** and its own
approval chains. Teams **nest**, so `sfa` can have `sfa-food-retail` and `sfa-food-manufacturing`
sub-teams, and every artifact carries an `owner` relation to its Team — the same PDP enforces design-time
edit/approve and runtime case-view rights.

```yaml
# One Team per agency; artifacts owned by the agency Team (owner metadata + OpenFGA relation, 06 §4.1/§4.3)
kind: Team
metadata: { id: sfa, displayName: "Singapore Food Agency", parent: gov-licensing-org }
stewards: [ officer.a@sfa ]                 # accountable named stewards
subTeams: [ sfa-food-retail, sfa-food-manufacturing ]
governanceDial: two-person-approval        # SFA sets its OWN artifact-change governance (03 §5, per-artifact overridable)
```

**What Team handles cleanly:**

- **Per-agency artifact ownership + approval chains.** The `can_approve = approver from owner or steward
  from owner` rule ([06 §4.3](../../architecture/06-identity-and-access.md)) means an SFA rule change routes
  to SFA approvers, never to SPF's — four-eyes is structural, not convention.
- **Per-agency governance dial.** The dial is set **per owning Team and overridable per artifact**
  ([03 §5](../../architecture/03-decision-layer.md), [BRIEF CodeSet](../../architecture/BRIEF.md)) — SFA can
  demand two-person approval on its fee CodeSet while a low-risk signage-copy CodeSet stays single-approver.
- **Runtime case isolation.** A Case for an SFA licence is `owned_by: sfa`; the ReBAC filter set makes SPF
  officers structurally unable to list it ([06 §2.3/§4.3](../../architecture/06-identity-and-access.md)).

**Where Team strains — the honest seam.** Three agency wishes push past what a sub-org Team was scoped for:

1. **An agency wants its own IdP for its officers.** ichiflow's IdP isolation is **per-Portal**, not
   per-Team ([06 §1.1/§1.5](../../architecture/06-identity-and-access.md), [BRIEF §7](../../architecture/BRIEF.md)):
   a realm/Organization per *audience*. This is **satisfiable** — give each agency (or agency-class) its own
   back-office **Portal** with its own realm, and bind that Portal's members to the agency Team. So
   "agency's own officer IdP" is a **Portal** concern the Team rides on, not a Team gap. Federating the
   *agency's existing corporate IdP* (SPF's directory) as an upstream is the partner-org `§1.5` broker
   strategy. **Verdict: expressible, but it is the Portal boundary doing the work, not the Team.**
2. **An agency wants its own release cadence.** Agencies revise rules on independent schedules. But the
   env-pin that activates released versions is a **deployment-wide checked-in file**
   (`environments/prod.pins.yaml`, [09 §6](../../architecture/09-deployment-and-topology.md),
   [BRIEF §21](../../architecture/BRIEF.md)) — there is **no per-Team pin scope**. Two agencies promoting on
   different days both commit to the same pin file. This is a **real strain** and a named gap
   ([G3](#gaps)): ownership is per-Team but *activation* is per-deployment.
3. **Own Portal branding.** Handled — Portals are audience-scoped with their own design tokens/uischema
   ([07](../../architecture/07-ui-and-portals.md)); an agency back-office Portal brands independently.

**Sub-org vs tenant — where the line actually falls.** An agency stays a **Team** as long as it shares the
deployment's tenancy root: one `tenant`, one PDP graph, shared reference data, one audit spine. It becomes
a **tenant** the moment it needs **data-isolation from the platform operator itself** (the platform team
must be unable to read the agency's case data), **independent lifecycle** (spin the agency up/down, migrate
it out), or a **hard regulatory boundary** where the agency is a *different legal data controller* refusing
a shared graph. GoBusiness, as a whole-of-government platform under one operator (GovTech/MTI)[^govtech]
with shared SSIC data and one dashboard, is **squarely the Team side** — which is why ichiflow's *v1
single-org, Teams-as-sub-structure* stance ([06 Part 3](../../architecture/06-identity-and-access.md),
ADR-0017) fits it. But a *cross-jurisdiction* licensing hub (agencies from different states, different
controllers) would cross into **multi-tenant** — the seam the brief already reserves for later
([06 Part 3](../../architecture/06-identity-and-access.md), [BRIEF §11](../../architecture/BRIEF.md)). **The
case validates that the Team/tenant line is drawn in the right place.**

### 2.2 (S2) Licence-type-as-artifact-bundle — does ichiflow need a first-class catalog?

A licence type is a **declarative bundle** of already-first-class artifacts:

```yaml
# licence-types/sfa.food-shop-licence.yaml — a bundle registered in the catalog (proposed shape, see G1)
kind: LicenceType                         # <-- the candidate new primitive
metadata:
  id: sfa/food-shop-licence
  version: 2026.3.0
  owningTeam: sfa
  ssicApplicability: [ "56*" ]            # SSIC food & beverage service — drives the guided journey (§2.3)
  displayName: { en: "Food Shop Licence" }
bundle:
  schema:        schema://sfa/FoodShopApplication/2
  applicability: decision://sfa/food-shop-applicable@2026.3.0   # is this licence needed? (guided journey)
  flow:          flow://sfa/food-shop-processing@2026.3.0       # how it is processed (internal review)
  feeCodeSet:    codeset://sfa/food-fees@2026.1.0               # S$195 (§1.4)
  doctemplate:   doctemplate://sfa/food-shop-licence@1.2.0      # platform-issued (depth 1, §2.5)
  sla:           { budget: P7D }                                # 7 working days (§1.4)
  operations:    [ apply, renew, amend, cancel ]               # per-type operation set (§1.6)
  issuance:      platform                                       # vs "agency-delegated" (§2.5)
```

**The central assessment: is this a new primitive, or a Workspace convention?** The *contents* are all
existing first-class artifacts; nothing here is a new execution mechanism. What is **genuinely missing** is
a **catalog** — a governed registry of these bundles with (a) **discoverability** ("enumerate every licence
type and its applicability rule" — required by S3), (b) **per-type metadata** (SSIC applicability, display,
operation set, issuance mode) that *drives* the guided journey and portal, and (c) **independent
versioning** of the bundle-as-a-unit. Today an agent can *discover artifacts* ([10](../../architecture/10-ai-native-experience.md),
`ichiflow-mcp`) but there is no typed object that says "these six artifacts **are** the Food Shop Licence,
version 2026.3.0, and here is the metadata the journey and portal read." CodeSets are the closest existing
shape and could **carry the catalog as data** (a `licence-types` CodeSet whose rows `codeRef` the six
artifacts) — but a licence type is not reference *data*, it is an **artifact bundle with a lifecycle**, and
overloading CodeSet blurs the "reference table vs product definition" line.

**Verdict:** ichiflow should adopt a **first-class `LicenceType`/`CaseType` catalog primitive** — a thin,
declarative, governed **manifest** binding the six existing artifacts + metadata, owned by a Team, versioned
and discoverable. It adds **no new runtime mechanism** (it resolves to the existing schema/decision/flow/
doctemplate refs); it adds **discoverability, per-type metadata, and bundle-versioning**. This is
[**G1**](#gaps), the headline generalization. (It generalizes the reference product's implicit "a product =
schema + decisions + flow + uischema" into an explicit, enumerable object.)

### 2.3 (S3) Guided Journey — an applicability Decision that quantifies over the catalog

With a catalog in hand, "which licences does this business need?" is a **single Decision that iterates the
catalog**, evaluating each licence type's `applicability` rule against the business profile:

```text
# decisions/guided-journey.decision-source  (authored-in: decision-source → guided-journey.dmn)
inputs:
  business: { ssic: string, activities: string[], premisesType: string, sellsLiquor: boolean, ... }
  catalog:  LicenceType[]                    # every registered licence type (the catalog, §2.2)
context journey:
  # quantify over the catalog: for each licence type, invoke its own applicability BKM
  needed : for lt in catalog
             return if invoke(lt.applicability, business) then lt.id else null
  ordered: applyDependencies(needed, catalog)          # prerequisite ordering + mutual-exclusion (§1.2)
decision: { licences: ordered[not null], excluded: mutualExclusions(needed) }
```

Two architectural questions this raises:

- **Can a Decision quantify over a catalog / invoke other Decisions?** DMN/FEEL supports iteration (`for …
  return`) and **BKM invocation** ([03 §2.6](../../architecture/03-decision-layer.md)) — a decision-source
  model *can* express "for each catalog entry, invoke its applicability BKM." The strain is that the catalog
  is a **dynamic set of artifacts**, and each licence type's applicability is its **own governed
  DecisionModel** owned by its agency (S6 — SFA must own "is a food shop licence needed," not the platform).
  So the journey is a **meta-Decision invoking N agency-owned sub-Decisions**, resolved through the catalog.
  DMN's static `invoke` normally names a BKM at authoring time; **invoking a rule chosen from a runtime set**
  is closer to a **feature-function that dispatches to `decision://{lt.applicability}`** — computation over
  a dynamic ref set, which belongs in a schema'd `compute`/feature-function ([03 §2.4](../../architecture/03-decision-layer.md)),
  not a static DRD edge. **It works, but the cleanest expression is a `compute` step that fans the business
  profile across the catalog's applicability refs and collects results** — and that wants the catalog to be
  first-class (G1) so the fan set is enumerable and pinned.
- **Whose rules run?** Each applicability sub-Decision is **agency-owned and independently governed**, so
  the journey composes them without the platform team authoring any agency's applicability logic. The
  platform team owns only the **orchestration** (iteration + dependency ordering + mutual exclusion) and the
  **shared SSIC CodeSet** the applicability rules read (S6, §2.6).

**Verdict:** supported, contingent on G1. The applicability determination is a **Decision (or `compute`)
quantifying over the catalog and invoking per-type agency-owned applicability rules** — a clean fit *once
the catalog is enumerable and pinned*. Without a first-class catalog, the fan set is an ad-hoc artifact
scan, which is not audit-pinnable.

### 2.4 (S4) Dynamic composite applications — the bundle-Case, and the housing-cohort relation

This is the sharpest generalization over customs. In customs, the CA set is computed but the **unit of work
is one Case** (one declaration) with a `CompositeOutcome` join. Here, the guided journey computes a **set of
distinct sub-applications**, each of which is a **full Case in its own right** — its own schema, its own
agency Flow, its own SLA, its own lifecycle (renew/amend independently, years apart). They are **bound
together only for the applicant's view**.

```yaml
# flows/licence-bundle.flow.yaml  (authored-in: yaml) — the parent bundle Flow (proposed, see G2)
id: licence-bundle
case: LicenceBundle                          # the parent Case: one business's start-up licence set
steps:
  - id: guided-journey
    type: decision-eval
    model: guided-journey@2026.7.0           # computes the needed licence-type set (§2.3)
  - id: compose
    type: parallel                           # ONE sub-Case per needed licence type (dynamic fan-out)
    forEach: "journey.licences"              # <-- the set is COMPUTED, not statically listed
    spawn:
      type: sub-case                         # each sub-Case runs its licence type's OWN Flow
      caseType: "${item.id}"                 # e.g. sfa/food-shop-licence → flow://sfa/food-shop-processing
      owner: "${item.owningTeam}"            # sub-Case owned by the AGENCY Team, not the bundle
    join: bundle-status                      # aggregate, but DO NOT gate: partial outcomes are valid (§1.3)
  - id: bundle-view
    type: compute                            # projects per-sub-Case status into the applicant's dashboard
```

**Does the existing machinery express this?** Partly, and the gaps are precise:

- **Parent-Case / sub-Case fan-out exists** ([04 §2.3/§5.6](../../architecture/04-flow-and-case-layer.md),
  and customs Trace C uses a correlated child Case). What is **new** is that the **set of sub-Cases is
  computed** (customs' children are corrections of one parent; here they are N heterogeneous applications),
  and each sub-Case runs a **different Team's Flow** with a **different SLA** — the fan-out must spawn
  **different `caseType`s per element**, resolved through the catalog (G1).
- **`CompositeOutcome` is the wrong join here.** Customs uses `all-must-approve` — the permit issues only if
  *every* CA clears. A licence **bundle is explicitly NOT all-or-nothing**: three licences approve and one
  is rejected, and the applicant proceeds with the three ([§1.3](#13-composite--bundled-applications-spanning-agencies)).
  `CompositeOutcome` aggregates **per-authority Outcomes into ONE decision on ONE Case**; a bundle is **N
  independent Cases** whose outcomes are **displayed together but never joined into a single gated
  determination**. So the bundle needs a **status aggregation, not an outcome composition** — a
  `partial`-tolerant **bundle view**, not a composition policy.
- **The bundle is an entity, not just a Flow.** The applicant's dashboard shows one bundle with per-part
  status, each part advancing (and later renewing) independently. That is a **long-lived parent Case that
  references its children's states** without owning their lifecycles.

**Relation to the housing-ballot cohort gap ([G4](./public-housing-ballot.md)) — same family or different?**
**Different family, adjacent.** The housing G4 is a **set-level *decision*** (a gather-barrier over N Cases
that emits *one global ordering* — a ballot must see all applications at once) plus a **cohort-scoped
DecisionRecord**. The licensing bundle is a **set-level *container*** — N **independent** decisions
displayed together, with **no barrier and no shared computation** (each licence decides on its own; the
bundle never computes across them). Housing needs *fan-in to one decision*; licensing needs *fan-out to N
decisions + a status roll-up*. They share the insight that **the DecisionRecord/Case model is per-`case_id`
and does not natively key a set-level artifact** — but housing wants a *cohort record* (one shared
computation) while licensing wants a *bundle record* (a parent that references N child records without
merging them). **Verdict:** the bundle needs a **first-class parent "bundle-Case" shape** — a `caseType`
whose children are a *computed, heterogeneous* set spawned via the catalog, joined by **status aggregation
(partial-tolerant), not `CompositeOutcome`**. This is [**G2**](#gaps).

### 2.5 (S5) Centralized issuance at two depths simultaneously

Per ADR-0029's placement profiles, issuance is **per-licence-type**, and both depths coexist in one
deployment:

- **Depth 1 — platform-issued** (SFA Food Shop Licence). The agency's Flow ends in an **`issue-document`**
  step binding an SFA-owned **doctemplate**; the Document (licence) is rendered through the platform's
  rendering SPI, allocated a number, and delivered to *My Licences* — the applicant downloads within one
  business day ([§1.6](#16-amendments-renewals-cancellations-issuance--verification), matching the real
  portal[^download]). The platform is the Document registry + lifecycle spine.
  ```yaml
  - id: issue                                 # in flow://sfa/food-shop-processing
    type: issue-document
    template: sfa/food-shop-licence@1.2.0     # SFA-owned doctemplate
    binds: { application: "${case}", outcome: "${review.outcome}", fee: "${fee}" }
    delivery: { portal: my-licences, notify: adapter://notify/email }
  ```
- **Depth 2 — agency-delegated issuance** (BCA signboard licence, issued in BCA's own ALS[^bca]). The
  agency's Flow ends in an **`external-task`** that submits to BCA's back-end over an APEX-wrapped
  adapter[^apex] and **awaits the licence metadata + reference number** the agency system minted; the
  platform records a **Document whose render/authority lives in the agency system**, keeping only the
  **registry entry + verification metadata + lifecycle pointer** — the *designed external-delegation path*
  of ADR-0029 (an enterprise/agency system owns issuance while ichiflow keeps the audit spine).
  ```yaml
  - id: delegate-issue                        # in flow://bca/signboard-processing
    type: external-task
    request:  { schema: schema://bca/AlsIssueRequest/1, adapter: adapter://bca/apex-submit }   # APEX-wrapped
    response: { schema: schema://bca/AlsLicenceMeta/1,  inbound: adapter://bca/apex-callback }  # licence no + status
    correlation: { inject: { as: header, name: x-correlation-id, from: "case_id & '/BCA'" },
                   extract: "response.correlationId" }
    onResponse:
      - id: record-external-document
        type: issue-document                  # registry-only mode: metadata + verification, render owned externally
        mode: external-authority              # ADR-0029 delegation depth 2
        binds: { externalRef: "${response.licenceNo}", status: "${response.status}", issuer: BCA }
  ```

**Does the design accommodate both, per licence type?** Yes, and cleanly: the choice is a **field on the
catalog bundle** (`issuance: platform | agency-delegated`, §2.2), and the two mechanisms — `issue-document`
(canonical, owns number allocation + lifecycle) and `external-task` + registry-only `issue-document`
([04 §2.8/§2.9](../../architecture/04-flow-and-case-layer.md), ADR-0028/0029) — **already exist**. The one
honest caveat: ADR-0029's "external authority owns render, platform keeps registry+verification" is a
**designed** delegation path; a *unified cross-agency verify API* (like customs' CCP verify) is **not**
something the real GoBusiness publicly exposes, so this study does not assert it — depth-2 licences are
**verifiable only to the extent the agency system exposes it**, and the platform holds a pointer. **Verdict:
both depths coexist per-type with no per-agency forking; issuance mode is catalog metadata.**

### 2.6 (S6) Checks and balances — PDP scoping, shared reference data, consent

- **Agency independence (A cannot see/change B).** Each agency Team `owns` its bundle artifacts and Cases;
  the OpenFGA graph makes cross-agency read/edit **impossible by construction** — `can_edit` resolves only
  through `owner`→Team relations, and the ReBAC filter is Team-scoped
  ([06 §4.3](../../architecture/06-identity-and-access.md)). SPF officers cannot list SFA's food-shop Cases;
  BCA cannot edit SPF's liquor rules.
- **Shared CodeSets — who owns SSIC?** The **SSIC business-activity taxonomy** is the shared spine every
  agency's applicability rule reads (S3). It is a **platform-team-owned CodeSet** (`owningTeam:
  gov-licensing-platform`), governed at a high dial, that agency Decisions **reference by `id@version`** but
  **cannot edit** — the classic "central platform team owns shared reference data, agencies own their own
  rules" split. A change to SSIC triggers **publish-time impact analysis** across every dependent
  applicability Decision ([02 §9.4](../../architecture/02-schema-foundation.md)), so the platform team sees
  which agencies a taxonomy change affects before it ships.
- **Cross-agency data-sharing consent.** When the bundle passes a business profile fact from one agency's
  form to another (or reuses ACRA registration data), that is a **cross-Team data flow** — modelled as an
  explicit consented handoff (a schema'd field with provenance recording the applicant's consent), not an
  ambient shared blob. The PDP scopes *which* fields a downstream sub-Case may read; the DecisionRecord
  records the consent event. (Public docs confirm the *behaviour* — reduced re-entry, 845→90 form
  fields[^apex] — but not the consent mechanics, so the mechanism here is ichiflow's, applied to the real
  data-minimization goal.)

---

## PART 3 — walkthrough trace: a new restaurant

A prospective restaurateur (`biz-uen-201899` acting via Corppass-assigned Singpass) starts a business. The
trace runs the guided journey → a **computed bundle** of three licences from three agencies → parallel
agency sub-Cases (one reviewed **in-platform**, one **delegated** to an agency back-end) → **partial
approval** bundle status → licences issued at **both depths**.

### Trace — guided journey → composed bundle → partial approval → dual-depth issuance

| Step | Artifact consulted | Data flowing | Outcome / trace | Who sees / does |
|---|---|---|---|---|
| `guided-journey` | `guided-journey@2026.7.0` over the **catalog**; `ssic-codes@2026.2.0` | SSIC `56*` (F&B), `sellsLiquor:true`, external signage | needed = **{ sfa/food-shop, spf/liquor-1a, bca/signboard }**, ordered | applicant (e-Adviser result[^eadviser]) |
| `compose` | catalog → 3 `caseType`s | one sub-Case spawned per licence type, each `owned_by` its agency Team | 3 child Cases created, 3 independent SLAs start | dashboard shows 3 parts[^status] |
| ↳ `sfa/food-shop` | `flow://sfa/food-shop-processing`, `food-fees` (S$195) | premises, layout plan, pest-control contract[^sfa] | **internal human-task** review → **approve** in 7d | SFA officer, in back-office Portal |
| ↳ `spf/liquor-1a` | `flow://spf/liquor-processing`, liquor-fees | Class 1A on-premise 6am–midnight[^liquor] | **internal human-task** → **deny** (premises objection) | SPF officer |
| ↳ `bca/signboard` | `flow://bca/signboard-processing` → **`external-task`** to BCA ALS[^bca] | sign dimensions, Town Council consent | **delegated**: BCA ALS returns **approve + licence no** | BCA's own system (APEX-wrapped[^apex]) |
| `bundle-status` | bundle-view `compute` | 3 child outcomes: approve / deny / approve | **partial** bundle: 2 issued, 1 rejected (NOT gated) | applicant dashboard |
| `issue` (SFA) | `issue-document`, `sfa/food-shop-licence@1.2.0` doctemplate | approved application snapshot | **Depth-1**: Document rendered by platform, in *My Licences*[^download] | applicant downloads PDF |
| `record-external-document` (BCA) | `issue-document` mode `external-authority` | BCA licence no + status | **Depth-2**: registry entry + pointer; render owned by BCA | applicant sees "issued (BCA)" |

```jsonc
// get_bundle_trace("BUNDLE-4471") → the parent bundle Case referencing 3 heterogeneous children (excerpt)
{ "bundle_id": "BUNDLE-4471", "business": "biz-uen-201899",
  "journey": { "ssic": "56101", "licences": [ "sfa/food-shop", "spf/liquor-1a", "bca/signboard" ],
               "pins": { "guided-journey": "2026.7.0", "ssic-codes": "2026.2.0", "catalog": "2026.7.0" } },
  "children": [
    { "case_id": "SFA-88231", "caseType": "sfa/food-shop", "owner": "sfa", "sla": "P7D",
      "outcome": { "type": "approve" }, "issue": { "depth": 1, "documentId": "SFA-FSL-88231", "delivery": "my-licences" } },
    { "case_id": "SPF-70155", "caseType": "spf/liquor-1a", "owner": "spf", "sla": "P21D",
      "outcome": { "type": "deny", "reasons": [ "PREMISES_OBJECTION" ] } },
    { "case_id": "BCA-33902", "caseType": "bca/signboard", "owner": "bca", "sla": "P7D",
      "external_task": { "adapter": "bca/apex-submit", "correlation": "BCA-33902/BCA" },
      "outcome": { "type": "approve" }, "issue": { "depth": 2, "externalRef": "BCA-ALS-556677", "issuer": "BCA" } } ],
  "bundle_status": { "type": "partial", "issued": 2, "rejected": 1, "note": "not all-or-nothing (§1.3)" } }
```

**What the trace exercises:** a **catalog-driven guided journey** (S3) computing a **heterogeneous
sub-Case set** (S4); each sub-Case running a **different agency Team's Flow** with its **own SLA** (S1);
**two review modes** (SFA/SPF internal human-task vs BCA `external-task` to an agency back-end, S1/S5); a
**partial bundle status** that is *not* a gated `CompositeOutcome` (S4 — the deny does not block the two
approvals); and **dual-depth issuance** (SFA platform `issue-document` vs BCA delegated `external-authority`
registry entry, S5). The parent `BUNDLE-4471` **references** three child DecisionRecords without merging them
— the bundle-record shape (G2) surfacing concretely.

---

## Checks-and-balances verification table

| Control / property | Enforcement mechanism | Verified / gap |
|---|---|---|
| **(S1)** N agencies, one deployment | Agency = **Team** owning its artifacts + Cases; nested; per-Team governance dial ([06 Part 4](../../architecture/06-identity-and-access.md), [03 §5](../../architecture/03-decision-layer.md)) | **Verified** |
| **(S1)** agency's own officer IdP | per-**Portal** realm/Org ([06 §1.1](../../architecture/06-identity-and-access.md)); agency back-office Portal binds to agency Team | **Verified** — Portal does it, not Team |
| **(S1)** agency's own release cadence | env-pin is **deployment-wide** (`prod.pins.yaml`, [09 §6](../../architecture/09-deployment-and-topology.md)) — no per-Team pin | **Gap — G3** |
| **(S1)** sub-org vs tenant line | Team while sharing tenancy root/PDP/audit; tenant when data-isolated from operator or cross-controller ([06 Part 3](../../architecture/06-identity-and-access.md)) | **Verified** — line correctly placed |
| **(S2)** licence-type = artifact bundle | schema + applicability + flow + fee CodeSet + doctemplate + SLA, owned by a Team | **Verified (contents)** |
| **(S2)** discoverable, versioned catalog + per-type metadata | no first-class catalog object; artifact discovery ≠ enumerable pinned bundle | **Gap — G1** |
| **(S3)** guided journey over catalog | Decision/`compute` quantifying (`for … return`) over catalog, invoking per-type agency-owned applicability rules ([03 §2.4/§2.6](../../architecture/03-decision-layer.md)) | **Verified** — contingent on G1 for a pinnable fan set |
| **(S3)** SSIC seeds applicability | platform-owned `ssic-codes` CodeSet referenced (not editable) by agency Decisions | **Verified** |
| **(S4)** computed heterogeneous sub-Case set | parallel fan-out spawning **different `caseType`s per element** via catalog | **Partial — needs G1 + G2** |
| **(S4)** partial-tolerant bundle (not all-or-nothing) | status aggregation, **not** `CompositeOutcome` composition | **Gap — G2** (composition ≠ container) |
| **(S4)** parent bundle referencing N child records | per-`case_id` DecisionRecord; parent references children (vs housing cohort-record fan-in) | **Gap — G2** |
| **(S5)** platform issuance (depth 1) | `issue-document` + doctemplate + rendering SPI ([04 §2.9](../../architecture/04-flow-and-case-layer.md), ADR-0029) | **Verified** |
| **(S5)** agency-delegated issuance (depth 2) | `external-task` + registry-only `issue-document` `external-authority` (ADR-0028/0029) | **Verified (design)** — depth-2 verify only as agency exposes |
| **(S5)** issuance mode per licence type | `issuance:` field on catalog bundle | **Verified** — no per-agency forking |
| **(S6)** agency A cannot see/change B | OpenFGA `owner`→Team; ReBAC filter Team-scoped ([06 §4.3](../../architecture/06-identity-and-access.md)) | **Verified** |
| **(S6)** shared SSIC ownership | platform-team-owned CodeSet; agencies reference, can't edit; publish-time impact analysis ([02 §9.4](../../architecture/02-schema-foundation.md)) | **Verified** |
| **(S6)** cross-agency data-sharing consent | schema'd consented handoff + provenance; PDP field-scoping; DecisionRecord consent event | **Verified (mechanism)** — real consent mechanics not public |
| **(S1/6)** per-type operation set (amend/renew/cancel) | operations declared on the bundle; some types agency-referred (real behaviour[^amend]) | **Verified** — catalog metadata (G1) |

---

## GAPS

**Blocking — none for the paper build.** Every runtime mechanism the platform-class needs already exists or
is a small, declarative generalization of one that does: agencies map to Teams, applicability is a Decision,
sub-Cases fan out on Temporal, issuance runs at both ADR-0029 depths. The gaps below are about **generic
shapes ichiflow should adopt to express a platform of this class first-class**, not missing engines.

**Framing (must-state, non-technical).** This case **names a real government system, which the shipped
product must not** (BRIEF §16). It is admissible **only** as an external validation fixture in
documentation, on the strength of its facts being public — never an onboarding template, ADR example, or the
reference product (the fictional permit remains canonical). If it risks being read as "ichiflow ships a
GoBusiness template," move or retitle it. **A governance guardrail, not a technical gap.**

### G1 — a first-class `LicenceType` / `CaseType` **catalog** primitive — **MINOR (generalization, adopt)**
A licence type is a **governed bundle** (schema + applicability Decision + processing Flow + fee CodeSet +
doctemplate + SLA + operation set + issuance mode, §2.2). Its *contents* are all first-class; what is
missing is a **thin, declarative, versioned catalog manifest** that (a) makes the set of types
**enumerable and pinnable** (required so the guided journey's fan set is auditable — G1 blocks clean S3/S4),
(b) carries **per-type metadata** that drives the journey and portal (SSIC applicability, display, operation
set, issuance mode), and (c) versions the **bundle-as-a-unit**. CodeSets could carry it as data but a type
is a *product definition with a lifecycle*, not reference data — overloading CodeSet blurs the line.
**Proposal:** add a `CaseType`/`LicenceType` catalog artifact class — a manifest of refs + metadata, owned
by a Team, governed and discoverable via `ichiflow-mcp`, adding **no new runtime mechanism** (it resolves to
existing refs). This generalizes the reference product's *implicit* "a product = schema+decisions+flow+
uischema" into an *explicit, enumerable* object, and is the substrate S3 quantifies over.

**Resolved (2026-07 gap-fix round):** adopted as the **CaseType catalog** artifact class in
[02 §10](../../architecture/02-schema-foundation.md) — a thin, **additive, optional** governed manifest binding
a case-type's artifact bundle + applicability metadata (e.g. SSIC), owned by a Team, versioned as a unit and
discoverable/pinnable via `ichiflow-mcp`, adding **no new runtime mechanism** (it resolves to existing refs).
Single-product Workspaces need none (kept an optional aggregation layer, BRIEF §21b). Related:
[ADR-0031](../../adr/0031-set-level-cases.md) (the bundle fan-out resolves `caseType` through it) /
[ADR-0033](../../adr/0033-packaging-and-placement.md) (packaging & placement doctrine).

### G2 — a **bundle-Case** shape: computed heterogeneous sub-Cases + partial-tolerant status aggregation — **MINOR-TO-MODERATE (adopt)**
The dynamic composite (§2.4) is **not** a `CompositeOutcome` (that composes N Outcomes into **one gated
decision on one Case**; a licence bundle is **N independent Cases** whose outcomes are **displayed together
but never joined** — partial approval is a valid, common end state). Two sub-gaps: **(a) computed
heterogeneous fan-out** — the parent spawns **a different `caseType` per computed element** (each a
different agency's Flow + SLA), which the current fixed/correlated child-Case pattern
([04 §5.6](../../architecture/04-flow-and-case-layer.md)) does not first-class; it needs a `forEach` over the
journey result resolving `caseType` through the catalog (G1). **(b) bundle record** — the per-`case_id`
DecisionRecord ([08 §1](../../architecture/08-audit-and-observability.md)) has no shape for a **parent that
references N child records** with a **partial** roll-up. **Relation to housing G4:** *adjacent, different
family.* Housing needs **fan-in to one set-level decision + a cohort record** (one shared computation over N
Cases); licensing needs **fan-out to N independent decisions + a status-aggregating parent record** (no
shared computation). Both reveal that Case/DecisionRecord is per-`case_id` and lacks a **set/parent-level
artifact** — worth a single ADR that introduces (i) a **cohort record** (housing) and (ii) a **bundle
parent-Case** (licensing) as two points on one "set-level Case" design.
**Proposal:** a `bundle` parent-Case `caseType` whose children are a **computed, heterogeneous** set spawned
via the catalog, joined by **partial-tolerant status aggregation, not `CompositeOutcome`**, with the parent
DecisionRecord **referencing** (not merging) child records.

### G3 — **per-Team env-pins** (independent release cadence) — **MINOR (adopt)**
Artifact **ownership** is per-Team, but artifact **activation** is per-deployment: the env-pin that releases
a version is a single checked-in file (`environments/prod.pins.yaml`,
[09 §6](../../architecture/09-deployment-and-topology.md), [BRIEF §21](../../architecture/BRIEF.md)). N
agencies promoting on independent schedules all commit to one pin file — a coordination bottleneck and a
blast-radius concern (one agency's bad pin sits in the same file as another's). **Proposal:** allow env-pins
to be **partitioned by owning Team** (e.g. `environments/prod/<team>.pins.yaml`), so an agency promotes its
own bundle versions independently while the deployment composes them — preserving "version control is the
write path" (BRIEF §21) but scoping activation to the ownership boundary that already governs edit/approve.
This is the direct strain surfaced in §2.1 and the one place agency-as-Team most wants to be more
tenant-like without crossing the tenancy line.

### Minor modelling notes (not architectural)
1. **Issuance-verification asymmetry.** Depth-1 (platform) licences get the full Document registry +
   lifecycle + (optional) verification; **depth-2 (agency-issued) licences are verifiable only as the agency
   system exposes** — the platform holds a pointer, not authority (ADR-0029 by design). Unlike customs' CCP,
   the real GoBusiness does not publish a unified cross-agency verify API, so this study **does not** assert
   one. A real deployment wanting uniform verification would need agencies to expose a verify hook — a policy
   ask, not an ichiflow gap.
2. **The internal-vs-external agency split is partly inferred.** GovTech's APEX legacy service-wrapping and
   BCA's separate ALS are **public**;[^apex][^bca] the **per-agency mapping** of "reviews in-platform" vs
   "delegates to own back-end" is **not** publicly enumerated. This study models **both modes** and marks
   the mapping illustrative. The load-bearing design fact — *per-licence-type choice without forking* — holds
   regardless of which agency is on which side.
3. **Licence/agency counts are a moving target.** 260/30+ (LicenceOne era)[^wiki] vs ~200–220/~29 (recent)
   [^scale][^govtech] — the study depends only on the order of magnitude, not a precise count (§1.1).
4. **Guided Journey is phased in reality.** It launched **food-services-first** and is expanding;[^eadviser]
   the restaurant trace is therefore the *most* production-realistic industry to walk, which is why it was
   chosen.

**Does the catalog/bundle model strain anything else?** One honest place. Once `CaseType` (G1) exists, it is
tempting to make it the *only* way to define a product — but the canonical reference product
([`../creating-a-permit-product.md`](../creating-a-permit-product.md)) is a **single** product and does not
need a catalog to exist. The catalog should be an **optional aggregation layer** over products, not a
mandatory wrapper — otherwise every single-product deployment pays for machinery only a multi-agency hub
needs. Keep `CaseType` **additive**, per the closed-core/declared-extension doctrine (BRIEF §21b).

---

### Where to go deeper

- Teams, role-as-relation, owning-Team, the sub-org-vs-tenant seam, one PDP —
  [`06-identity-and-access.md`](../../architecture/06-identity-and-access.md) Part 3 (multi-tenancy seam) +
  Part 4 (Teams).
- `CompositeOutcome` + composition policies (and why a bundle is *not* one), routing-is-a-Decision,
  feature-functions, quantifying Decisions, governance dial + impact analysis —
  [`03-decision-layer.md`](../../architecture/03-decision-layer.md) §2.3–§2.6, §5.
- Parent/sub-Case fan-out, `external-task`, `issue-document` + both ADR-0029 issuance depths, per-authority
  SLAs, Case operations — [`04-flow-and-case-layer.md`](../../architecture/04-flow-and-case-layer.md) §2.3,
  §2.8, §2.9, §5.6; adapter request-reply (APEX-style wrapping) — [`05-adapters.md`](../../architecture/05-adapters.md) §11.
- CodeSets, `codeRef` integrity + dependency graph (SSIC as shared reference data) —
  [`02-schema-foundation.md`](../../architecture/02-schema-foundation.md) §9; env-pins + promotion —
  [`09-deployment-and-topology.md`](../../architecture/09-deployment-and-topology.md) §6.
- Nearest cousin (fixed multi-authority on ONE application) —
  [`./customs-declaration.md`](./customs-declaration.md); the cohort/set-level counterpart (housing G4) —
  [`./public-housing-ballot.md`](./public-housing-ballot.md); canonical (fictional) reference product this
  case generalizes — [`../creating-a-permit-product.md`](../creating-a-permit-product.md).

---

<!-- Sources — GoBusiness / GovTech / Singapore agency public references (accessed July 2026) -->

[^obls]: Online Business Licensing Service (OBLS) — launched Jan 2004 with ~20 licences; within its first
    year covered licences ~80% of new start-ups needed; average processing time 21→8 days by 2005; UN Public
    Service Award 2005. https://en.wikipedia.org/wiki/Online_Business_Licensing_System
[^wiki]: Online Business Licensing System — Wikipedia: "260 business licences … more than 30 government
    agencies"; update/renew/terminate for ~65 licences; >80% of start-ups without counter visits.
    https://en.wikipedia.org/wiki/Online_Business_Licensing_System
[^rebrand]: OBLS → LicenceOne (2016 re-platform) → **GoBusiness Licensing** (rebrand **31 Oct 2019**).
    https://www.incorp.asia/blogs/gobusiness-licensing/
[^mddi]: Ministry of Digital Development and Information / MTI, "Launch of GoBusiness Licensing Portal" —
    GoBusiness jointly developed by MTI and GovTech; one-stop portal for licence application/payment;
    apply for multiple licences simultaneously. https://www.mddi.gov.sg/newsroom/launch-of-gobusiness-licensing-portal/
[^scale]: GoBusiness Licensing — "one-stop application gateway to over 200 business licences across ~29
    government agencies." https://www.incorp.asia/blogs/gobusiness-licensing/ ·
    https://licensing.gobusiness.gov.sg/
[^govtech]: GovTech Singapore, "GoBusiness" product page — 120+ government e-services, 200+ e-Advisers,
    6 million+ government-to-business transactions; Singpass login; jointly by MTI + GovTech.
    https://www.tech.gov.sg/products-and-services/for-businesses/corporate-transactions/gobusiness/
[^eadviser]: GoBusiness Licence e-Advisers — answer guided questions about your business to get a tailored
    list of required licences; **Guided Journey** launched food-services-first, expanding to more
    industries; shows the correct order to apply. https://licensing.gobusiness.gov.sg/e-adviser
[^ssic]: ACRA, "Finding the right SSIC code" + GoBusiness e-Adviser for starting a business — SSIC (up to
    5-digit activity code chosen at ACRA registration) guides which licences are needed; ACRA may refer the
    application to the relevant licensing authority.
    https://www.acra.gov.sg/register/business/choosing-reserving-a-business-name/finding-the-right-ssic-code/
[^multi]: GoBusiness — apply for **multiple licences simultaneously in one transaction** with a single
    payment; **Application Journey** shows the correct order (prerequisites) and flags mutually-exclusive
    licences (e.g. Halal Certification vs Liquor/Tobacco); Guided Journey auto-routes forms to relevant
    agencies **concurrently for parallel processing**. https://licence1.business.gov.sg/feportal/web/frontier/help/apply-for-new-licence ·
    https://www.gobusiness.gov.sg/licensing-faqs/application/
[^status]: GoBusiness — track application/amendment status in *My Submissions* with email notification on
    determination; centralised dashboard shows which agency is reviewing.
    https://www.gobusiness.gov.sg/dashboard-faqs/view-licence-statuses/
[^sfa]: Singapore Food Agency — **Food Shop Licence** applied via GoBusiness; fee **S$195**, validity **1
    year**, ~**7 working days** to approve a complete application; required docs incl. URA/HDB change-of-use,
    tenancy agreement, cleaning programme, pest-control contract.
    https://www.sfa.gov.sg/food-retail/licence-permit/application-process-fees-for-licence-permit-for-food-retail ·
    https://licensing.gobusiness.gov.sg/licence-directory/sfa/food-shop-licence
[^liquor]: Singapore Police Force — **Liquor Licence** (Classes 1A–4) applied via GoBusiness; fees ~**S$110–
    S$880** by class; ~**3 weeks** processing; Class 1A = all liquor for on-premise consumption, 6am–before
    midnight. https://www.police.gov.sg/E-Services/Apply-for-Liquor-Licence/Types-of-Liquor-Licences-and-Fees ·
    https://licensing.gobusiness.gov.sg/licence-directory/spf/liquor-licence-class-1a-1b-2a-2b-3a-3b-4
[^bca]: Building and Construction Authority — **Outdoor Advertising Sign / Signboard Licence** applied via
    BCA's **Advertisement Licensing System (ALS)**; ~**7 working days**, **+2 weeks if URA evaluation**
    required; Town Council/landlord consent; Permit to Use for signs >10m² or roof-mounted. (An agency
    running its own back-end issuance system — depth-2 example.)
    https://www1.bca.gov.sg/safety-and-standards/applications-and-licenses/outdoor-advertising-sign-signboard-licence-application/
[^apex]: GovTech, "An inside look at how GovTech reduced 845 form fields to just 90 on the GoBusiness
    Licensing portal" — GovTech's **APEX (API Exchange)** as the central authorised-API repository;
    agencies use different/legacy protocols, so GovTech **"service-wraps"** legacy formats for GoBusiness to
    call; data minimization / re-entry reduction. https://www.tech.gov.sg/technews/inside-look-at-gobusiness/
[^amend]: GoBusiness — renew/amend/cancel from *My Licences* ("Due for Renewal"); **not all licence types
    support self-service amendment** ("your licence may require you to contact the issuing agency directly");
    amendment may need a separate agency approval depending on licence/amendment type.
    https://licensing.gobusiness.gov.sg/faq/manage-licences/amend
[^download]: GoBusiness — approved licences **downloadable from *My Licences* within one business day** of
    approval; login via **Singpass** (Corppass-assigned for UEN entities since 11 Apr 2021).
    https://licensing.gobusiness.gov.sg/faq/manage-licences/download-licence
</content>
</invoke>
