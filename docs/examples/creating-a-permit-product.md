# Building a Permit Product on ichiflow — a "show me" walkthrough

> _This is **design fiction grounded in the real design**: an illustrative narrative of the
> **target v1 experience**, not a transcript of a shipping product. Every artifact, CLI line, skill
> invocation, and MCP tool result below is written to be consistent with the architecture docs
> ([`../architecture/BRIEF.md`](../architecture/BRIEF.md) and `00`–`11`); where a reader wants the
> normative depth behind a moment here, the prose links to the doc that owns it. Nothing here runs
> yet — it is what building an **outdoor event permit** product should **look like** when v1 lands._

The domain is a municipal **Outdoor Event Permit**: a resident or event company applies to hold an
event in a public space. The city checks eligibility, computes a fee, and routes the application to
two internal units — a **Safety** unit and a **Zoning** unit — that must *both* approve. An approval
can carry obligations (submit a noise-control plan; pass a site inspection). A rejection carries
coded reasons. Some applications are referred to a human for manual review.

The two people in this story are **Devon** (an application developer, pairing with Claude Code) and
**Priya** (the city's permits manager — a business user, not a developer).

---

## Act 1 — Bootstrap: from empty directory to a running system in under ten minutes

> **Devon:** "Set me up a new ichiflow workspace for an outdoor-event-permit product, then start it."

Claude Code runs the two Dev-tier commands. At the **Dev tier** everything is a single binary with
embedded services (SQLite, an embedded Temporal dev server, an embedded rule engine), governance
dialled **off**, and a target time-to-first-screen under ten minutes
([`../architecture/00-vision-and-principles.md`](../architecture/00-vision-and-principles.md) §5.1;
[`../architecture/04-flow-and-case-layer.md`](../architecture/04-flow-and-case-layer.md) §1).

```console
$ ichiflow init permits
✔ Scaffolded Workspace "permits" (tier: dev · governance: off)
✔ Wrote agent kit: AGENTS.md · CLAUDE.md · .claude/{skills,agents,hooks}
✔ Registered ichiflow-mcp server config (.mcp.json) — runtime tools, Tier-0 auto-approved
  Next: cd permits && ichiflow dev

$ ichiflow dev
✔ contracts       tsp compile → openapi/ jsonschema/ (0 schemas yet)
✔ temporal-dev    embedded server           :7233
✔ rule-engine     Drools (embedded)         SPI ready
✔ core            modular monolith          :8080
✔ playground      live preview + audience toggle   http://localhost:8080/_playground
▶ dev server ready in 6m48s · watching Workspace for changes
```

The scaffolded Workspace is the agent-operable repo from
[`../architecture/10-ai-native-experience.md`](../architecture/10-ai-native-experience.md) §2.2:

```text
permits/
  AGENTS.md            # ichiflow overview, build/test commands, "how to reproduce a case"
  CLAUDE.md            # @imports AGENTS.md
  .claude/
    skills/            # add-schema · add-decision · add-flow · add-adapter · run-parity-tests
                       #   (+ debug-stuck-case · explain-decision · reproduce-incident)
    agents/            # incident-investigator (read-only) · adapter-author
    hooks/             # block edits to generated code · regenerate-and-diff · repro-before-fix
  contracts/src/       # TypeSpec — the ONLY hand-authored contract surface
  contracts/{openapi,jsonschema,ui}/   # generated + designer-owned (empty for now)
  decisions/  flows/  adapters/  codesets/   # declarative artifacts (empty)
  .mcp.json            # ichiflow-mcp runtime server (why/case/flow query tools)
```

> **What Devon judges:** the dev server is up, the playground renders (an empty app shell so far),
> and the five core build-time skills are present. One command, embedded services, nothing to
> configure. This is the "productive in minute one" contract, not a promise on a slide.

---

## Act 2 — The domain model, by chat

> **Devon:** "We issue outdoor event permits. An application has an event name and type (concert,
> market, sports, parade), a public venue, expected attendance, start/end dates, whether it uses
> amplified sound, and an organizer with contact details and an indemnity-insurance flag. Model it."

Claude Code invokes the **`add-schema`** skill (TypeSpec → regenerate; doc 10 §2.2). It writes one
TypeSpec model — the LLM-legible authoring surface — and lets the deterministic pipeline emit the
canonical artifacts ([`../architecture/02-schema-foundation.md`](../architecture/02-schema-foundation.md) §1).

```typespec
// contracts/src/permit.tsp  (authored by add-schema)
import "@typespec/json-schema";
using TypeSpec.JsonSchema;

@jsonSchema
@doc("An outdoor-event permit application flowing through the permits Flow.")
model PermitApplication {
  @doc("Global correlation id; the Case carries this as case_id.") id: string;
  eventName: string;
  eventType: EventType;
  @doc("Registered public space code.") venueCode: string;
  @minValue(1) expectedAttendance: int32;
  startDate: plainDate;
  endDate: plainDate;
  amplifiedSound: boolean = false;
  organizer: Organizer;
}

enum EventType { concert: "CONCERT", market: "MARKET", sports: "SPORTS", parade: "PARADE" }

model Organizer {
  fullName: string;
  @format("email") email: string;
  @doc("Public-liability cover in place?") indemnityInsured: boolean;
}
```

```console
$ # add-schema regenerates and runs the diff gate
✔ tsp compile → contracts/jsonschema/PermitApplication.json  (canonical, checked in)
✔ contracts/openapi/permit.yaml  POST /permit-applications
✔ kotlin/contracts-kt/.../PermitApplication.kt   (Fabrikt — data class + enum)
✔ packages/contracts-ts/permit.ts                (hey-api — type + Zod v4 schema)
✔ contracts/ui/PermitApplication.uischema.json   (baseline, --if-absent, designer-owned)
✔ regenerate-and-diff gate: clean
```

The uischema is a **generated-once baseline** JSON Forms document, never re-clobbered
([`../architecture/07-ui-and-portals.md`](../architecture/07-ui-and-portals.md) §2). Because the
schema now exists, the playground renders a real intake form the moment codegen finishes — no
backend logic yet — over MSW-mocked data (doc 07 §14).

> **What Devon judges (playground):** a working "Apply for an Outdoor Event Permit" form — event-type
> dropdown, a date range, an amplified-sound toggle, an organizer sub-form with an email field that
> validates against `format: email`. He flips the **audience toggle** to _customer_ and the same
> schema renders with customer-voice labels. No form code was written.

---

## Act 3 — Reference data: outcome and condition codes as a governed CodeSet

Reason codes and condition codes are not string literals sprinkled through rules — they are a
governed **CodeSet**: schema'd, semver-versioned, effective-dated, and carrying **per-audience
display metadata** so one row renders correctly for both back-office and customer audiences
([`../architecture/02-schema-foundation.md`](../architecture/02-schema-foundation.md) §9.1–§9.2).

> **Devon:** "Create the outcome codes: an eligibility rejection for a disallowed venue, a
> referral-to-review code for very large events, a blocking noise-control-plan condition due within
> 5 days, a post-approval site-inspection obligation within 30 days of the event, and a blocking
> proof-of-insurance condition."

```yaml
# codesets/permit-outcomes.yaml — governed CodeSet (checked in, registry-versioned)
kind: CodeSet
metadata:
  id: permit-outcomes
  version: 1.0.0                        # semver; row/schema changes gated like any contract
  governanceState: released
  effective: { from: 2026-08-01, to: null }
schema: contracts/jsonschema/Code.json  # canonical Code row shape (doc 02 §9.2)
rows:
  - code: VENUE_NOT_PERMITTED           # a deny reason
    kind: reason
    display:
      technical: "ELIG-V1"
      professionalLabel: "Venue not on the permitted-spaces register"
      plainLanguage: { en: "The space you chose isn't available for public events." }
  - code: ATTENDANCE_OVER_AUTO_CAP      # a refer reason
    kind: reason
    display:
      technical: "ELIG-A9"
      professionalLabel: "Attendance above auto-decision cap → manual review"
      plainLanguage: { en: "Your event is large enough that a case officer will review it." }
  - code: NC-05                         # a blocking condition
    kind: blocking
    dueWithin: P5D
    display:
      technical: "NC-05"
      professionalLabel: "Noise-control plan required (submit within 5 days)"
      plainLanguage: { en: "Send us your noise-control plan within 5 days to keep your approval." }
  - code: SITE-INSP-30                  # a post-approval obligation
    kind: post-approval-obligation
    deadline: { beforeEvent: P30D }
    display:
      technical: "SITE-INSP-30"
      professionalLabel: "Site inspection within 30 days of event"
      plainLanguage: { en: "A city officer will inspect the site up to 30 days before your event." }
  - code: INS-PROOF                     # a blocking condition
    kind: blocking
    dueWithin: P10D
    display: { technical: "INS-PROOF", professionalLabel: "Proof of public-liability insurance",
               plainLanguage: { en: "Upload proof of your public-liability insurance." } }
```

> **What Devon judges (playground, audience toggle):** the same `NC-05` row renders as
> **"NC-05 · Noise-control plan required (submit within 5 days)"** for the back-office audience and
> as **"Send us your noise-control plan within 5 days to keep your approval."** for the customer
> audience — one governed source, two audiences, no duplicated meaning
> ([`../architecture/07-ui-and-portals.md`](../architecture/07-ui-and-portals.md) §4.1).

---

## Act 4 — Decisions, by chat: eligibility, fee, and a two-unit composition

> **Devon:** "Eligibility: reject if the venue isn't permitted; refer to review if attendance is over
> 5,000; otherwise pass. Then a fee based on event type and attendance tiers from a rate table, plus a
> surcharge if amplified sound is used. Then Safety and Zoning both review, and the permit only issues
> if both approve."

Claude Code invokes **`add-decision`** three times (DMN authoring + simulate; doc 10 §2.2,
[`../architecture/03-decision-layer.md`](../architecture/03-decision-layer.md) §5.3). Each Decision is
a **DecisionModel** — a DMN 1.6 document plus the ichiflow envelope — whose output is a canonical
typed **`Outcome`**, and which **references CodeSets by `id@version` rather than inlining rows**
(doc 03 §2.2).

**(a) Eligibility** — a DMN decision table, rendered here as its compact FEEL form:

```text
# decisions/eligibility.dmn  (FEEL decision table, hit policy: FIRST) — rendered view
| # | venuePermitted | expectedAttendance | outcome.type          | reasons                         |
|---|----------------|--------------------|-----------------------|---------------------------------|
| 1 | false          | -                  | "deny"                | VENUE_NOT_PERMITTED @1.0.0       |
| 2 | true           | > 5000             | "refer"               | ATTENDANCE_OVER_AUTO_CAP @1.0.0  |
| 3 | true           | <= 5000            | "approve"             | -                               |
```

**(b) Fee** — an ordinary Decision reading a **versioned rate table** that stays a governed CodeSet,
never inlined in the DMN (doc 03 §2.4):

```yaml
# decisions/fee.decisionmodel.yaml (envelope excerpt)
kind: DecisionModel
metadata: { id: permit-fee, version: 1.0.0, governanceState: released }
model: { dmn: ./fee.dmn, entryPoint: PermitFee }
contracts: { input: { schema: schemas/PermitApplication.json },
             output: { schema: schemas/Outcome.json } }
references:
  - fee-schedule@2026.3.0     # rate table CodeSet; version pinned into the DecisionRecord
  - permit-outcomes@1.0.0
# fee.dmn reads base-rate by eventType, a per-attendee tier, and a +15% amplified-sound surcharge
# from fee-schedule@2026.3.0 — the rate-table version is recorded alongside the computed amount.
```

**(c) The two-unit composition** — Safety and Zoning each emit their own `Outcome` (attributed to
their authority); the join is a **declared, governed composition policy**, not an ad-hoc FEEL merge.
The result is a canonical **`CompositeOutcome`** with `policy: all-must-approve` (doc 03 §2.3):

```yaml
# decisions/permit-review.composition.yaml
kind: CompositionPolicy
metadata: { id: permit-review, version: 1.0.0, governanceState: released }
policy: all-must-approve         # both members must approve; a deny from either blocks the whole
members:                         # each an independent DecisionModel, attributed to its authority
  - authority: safety   decisionModel: safety-review@1.0.0
  - authority: zoning   decisionModel: zoning-review@1.0.0
```

Claude runs `ichiflow simulate` over a sample application to let Devon judge by output, not by
reading DMN (doc 03 §5.4). The result is a typed `CompositeOutcome`, its members' conditions
attributed to the originating authority:

```console
$ ichiflow simulate permit-review --input samples/mid-size-concert.json
```
```json
{
  "policy": "all-must-approve",
  "rolledUp": "conditional-approve",
  "members": [
    { "authority": "safety", "type": "conditional-approve",
      "reasons": [],
      "conditions": [
        { "code": "NC-05", "codeSet": "permit-outcomes@1.0.0",
          "kind": "blocking", "state": "pending" },
        { "code": "SITE-INSP-30", "codeSet": "permit-outcomes@1.0.0",
          "kind": "post-approval-obligation", "state": "pending" }
      ] },
    { "authority": "zoning", "type": "conditional-approve",
      "reasons": [],
      "conditions": [
        { "code": "INS-PROOF", "codeSet": "permit-outcomes@1.0.0",
          "kind": "blocking", "state": "pending" }
      ] }
  ]
}
```

> **What Devon judges:** the composed outcome is `conditional-approve` with three conditions — two
> blocking (`NC-05`, `INS-PROOF`), one post-approval obligation (`SITE-INSP-30`) — and every
> condition stays attributed to the unit that raised it. If Zoning had returned `deny`, `all-must-approve`
> would roll the whole thing up to `deny`. He didn't read a line of FEEL to see this.

---

## Act 5 — The Flow, by chat: both authoring surfaces, one canonical artifact

> **Devon:** "Wire the flow: validate the application, evaluate eligibility, branch — reject on deny,
> route to a manual-review task on refer (24h SLA, escalate to a supervisor queue), and on pass run the
> fee and the two-unit review, then notify the applicant. Also compute crowd density before eligibility
> since Safety wants it."

Claude Code invokes **`add-flow`**. A Flow has **three authoring surfaces** but **one canonical Flow
JSON** that is executed, audited, and exported; the typed builder compiles **one-way** to it, exactly
mirroring TypeSpec→OpenAPI (doc 04 §2.5). Because Devon wants typed step-wiring, Claude authors the
**typed TS flow builder**, so the flow records `authored-in: code`.

```typescript
// flows/permit.flow.ts  (typed builder — compiles one-way to canonical JSON)
export const permitFlow = flow("permit", { case: "PermitApplication" })
  .compute("crowd-density", { ref: "kt://permits/CrowdDensity@1.0.0",   // §2.6 code activity
      input: "schema://permits/CrowdDensityInput/1",
      output: "schema://permits/CrowdDensityOutput/1" })                // schema'd boundary + trace
  .decision("eligibility", { model: "eligibility@1.0.0" })
  .branch(on("eligibility.type"), {
    deny:   step.emit("reject", { adapter: "notify-applicant", template: "rejected" }),
    refer:  human("manual-review", {
              assignBy: "assign-reviewer@1.0.0",     // routing is itself a Decision (doc 04 §5.3)
              sla: "PT24H", escalation: "chain/permits-supervisor" }),
    approve: seq(
      step.decision("fee", { model: "permit-fee@1.0.0" }),
      step.compose("review", { policy: "permit-review@1.0.0" }),        // all-must-approve join
      step.emit("notify", { adapter: "notify-applicant", template: "outcome" })),
  });
```

The builder compiles to the canonical Flow JSON that the interpreter actually runs (doc 04 §2.2, §2.5):

```json
{ "id": "permit", "authored-in": "code", "schemaVersion": "swf/1.0-ichiflow",
  "steps": [
    { "id": "crowd-density", "type": "compute", "ref": "kt://permits/CrowdDensity@1.0.0" },
    { "id": "eligibility", "type": "decision-eval", "model": "eligibility@1.0.0" },
    { "id": "route", "type": "branch", "on": "${ eligibility.type }" } ] }
```

The `compute` step is a first-class typed **code activity** — schema'd at its boundary, referenced by
a versioned `ref`, trace-emitting into the DecisionRecord — so the "how do we derive crowd density"
computation lives in typed Kotlin, not in sprawling inline FEEL, while the graph stays declarative
(doc 04 §2.6; the same unified contract as a Decision feature-function and an Adapter code-transform).

> **What Devon judges (playground, read-only flow diagram):** a Mermaid projection rendered _from_ the
> canonical JSON — `crowd-density → eligibility → {reject | manual-review | fee→review→notify}` — with
> the manual-review node showing its 24h SLA and escalation chain. It is a **read-only projection**, not
> a second editable canvas (doc 04 §2.5). The provenance badge reads `authored-in: code`.

---

## Act 6 — The business-user pass: Priya tunes a threshold and approves

Priya is the permits manager. She never opens the repo. She works in the back-office **Portal's chat**,
under the same **"chat to author, preview to judge"** doctrine as everyone else (doc 00; doc 03 §5.3).

> **Priya:** "Five thousand is too low — we're referring street markets that we always wave through.
> Raise the manual-review cap to 8,000, but keep concerts at 5,000."

The Rule Authoring assistance proposes an edit to the **eligibility** DecisionModel: a new table row
splitting the cap by `eventType`. Priya never sees DMN XML — she sees a **live what-if simulation** and
a **plain-language diff** (doc 03 §5.4, the business user's judgement surface):

```text
Proposed change to eligibility@1.0.0 → 1.1.0        (AI-explained diff)
  • Markets & parades: refer only above 8,000 (was 5,000)
  • Concerts & sports: unchanged, refer above 5,000
Live simulation over 12 recent applications:
  ✔ 3 street markets (5,200–7,400) that were REFER → now APPROVE
  ✔ 1 concert (6,100) still REFER                    · no other outcomes changed
```

> **Priya:** "That's exactly right. Approve."

Because this Workspace runs at the **Team tier**, the governance-level dial defaults to **`light`**:
governance states collapse to `draft`/`released`, and approval is a PR merge — **one approval**, no
formal approval-Flow (doc 03 §5.6, ADR-0017). The edit lands as a new **versioned DecisionModel**,
`eligibility@1.1.0`; in-flight Cases stay pinned to the version they started on, new Cases pick up
`1.1.0` (doc 03 §5.1, §5.7). At the Enterprise tier the same edit would route through a `full`
approval-Flow with assigned reviewers, SLA, and an immutable released baseline — same artifact,
different ceremony, config only.

> **What Priya judges:** the twelve-case simulation and the one-line diff. She approved a governed rule
> change from a chat box and never learned what "hit policy FIRST" means.

---

## Act 7 — Scenario tests business users can read, plus parity

Decision tests are **first-class governed artifacts inside the DecisionModel**, business-readable, and
required for release (doc 03 §6). The scenario spec asserts a full typed `Outcome` — its `type`, its
`reasons`, and its `conditions[]` with expected `kind`/`state` — not a bare scalar:

```yaml
# decisions/scenarios/large-concert-conditional.yaml
scenario: A large insured concert with amplified sound → conditional-approve with 3 conditions
decisionModel: permit-review@1.0.0
cases:
  - name: 4,800-attendee concert, amplified sound, insured → CONDITIONAL-APPROVE
    given: { eventType: CONCERT, expectedAttendance: 4800, amplifiedSound: true,
             venuePermitted: true, organizer: { indemnityInsured: true } }
    expect:
      rolledUp: conditional-approve
      conditions:
        - { code: NC-05,        codeSet: permit-outcomes@1.0.0, kind: blocking, state: pending }
        - { code: SITE-INSP-30, codeSet: permit-outcomes@1.0.0,
            kind: post-approval-obligation, state: pending }
        - { code: INS-PROOF,    codeSet: permit-outcomes@1.0.0, kind: blocking, state: pending }
  - name: Disallowed venue → DENY
    given: { venuePermitted: false }
    expect: { type: deny, reasons: [ { code: VENUE_NOT_PERMITTED, codeSet: permit-outcomes@1.0.0 } ] }
```

```console
$ ichiflow test
  decisions/scenarios/  ✔ 2 scenarios (5 cases)  · rule/row coverage 91%
  flows/scenarios/      ✔ permit happy-path · refer→review · deny  (time-skipping: 24h SLA in 4ms)
  ✔ all green · coverage advisory (Team=light: not gating)
```

Flow scenarios read as business narratives — _given inbound command + stubbed Decision outcomes +
simulated signals/timer expiries → expected path and Tasks_ — and the time-skipping test server
fast-forwards the 24-hour SLA in milliseconds (doc 04 §8). A **golden dataset** of historical permit
decisions can be attached to gate regressions and drive decision **parity testing** via
`run-parity-tests`, the same harness used for migration (doc 03 §6.3) — here it just guards that
`eligibility@1.1.0` doesn't silently regress a decision the city made last season.

---

## Act 8 — Runtime: a citizen submits, and gets a conditional approval

The product is deployed. A resident, **Mara**, applies through the **customer Portal** (auto-generated
from `PermitApplication` + uischema, in the DMZ; doc 07 §5, §8) for a 4,800-person amplified concert.

The canonical `PermitApplicationSubmitted` command opens a **Case** with a global `case_id`. The Flow
runs: crowd-density computes, eligibility passes (`approve`), the fee is computed against
`fee-schedule@2026.3.0`, and the two-unit review composes to `conditional-approve` with three
conditions. Because two are **blocking** Conditions, the permit's activation is gated by
`condition-gate` steps until they reach `fulfilled` or are `waived`; the **post-approval obligation**
(`SITE-INSP-30`) is deadline-bearing and tracked after the Case resolves, so the Case sits in
`ObligationsOpen` (doc 04 §5.5, §5.1).

The **same three conditions render for two audiences from the one CodeSet** (doc 07 §4.1, §7.1):

```text
CUSTOMER PORTAL (Mara) — plain-language "what you must still do"
  Approved — with 2 things to do before it's final, and 1 after:
   • Send us your noise-control plan within 5 days.            (blocking · due 2026-08-06)
   • Upload proof of your public-liability insurance.          (blocking · due 2026-08-11)
   • A city officer will inspect the site up to 30 days before your event.  (after approval)
  Fee due: $420.00

BACK-OFFICE PORTAL (case officer) — technical codes + fulfilment actions
  CompositeOutcome: conditional-approve  (all-must-approve)
   safety  NC-05 blocking pending   [mark received] [waive]
   safety  SITE-INSP-30 post-approval-obligation pending   [record inspection]
   zoning  INS-PROOF blocking pending   [mark received] [waive]
  DecisionRecord: fee=$420.00 @ fee-schedule 2026.3.0 · eligibility@1.1.0 · review@1.0.0
```

> Mara sees a truthful, plain-language status and never sees the token `NC-05`. The case officer sees
> the codes and the fulfilment actuators that emit the signal satisfying each `condition-gate`. One
> governed source of meaning, two renderings, zero drift (doc 07 §4.1).

---

## Act 9 — Runtime: debugging a stuck case with Claude Code at 2am

An on-call alert fires: a permit case hasn't advanced. Devon opens Claude Code and asks in plain
English. Claude reaches the running system through **`ichiflow-mcp`** — the runtime MCP server that
exposes the **why API / case queries** as typed, tiered tools; **the "why" API _is_ the debugging API**
(doc 10 §3.1). All of the following are **Tier-0 read-only** tools, server-enforced as having no write
path, so they are **auto-approved** (doc 10 §3.2–§3.3).

> **Devon:** "Why is case PRM-2031 stuck?"

```jsonc
// list_stuck_cases(since:"PT6H", stage:"review")  → Tier-0, auto
[ { "case_id": "PRM-2031", "stage": "review", "stuck_for": "PT5H12M",
    "reason_class": "sla-clock-paused", "task": "t-77c1" } ]
```
```jsonc
// get_case_trace("PRM-2031")  → Tier-0, auto  (excerpt of the DecisionRecord)
{ "case_id": "PRM-2031", "state": "InProgress",
  "composite": { "policy": "all-must-approve", "rolledUp": "pending",
    "members": [ { "authority": "safety", "type": "conditional-approve" },
                 { "authority": "zoning", "type": "pending" } ] },
  "task": { "task_id": "t-77c1", "type": "zoning.review", "state": "awaiting-applicant",
            "sla": { "budget": "P3D", "clock": "paused",
                     "clock_stop": { "reason": "request-for-information", "since": "…T21:04Z" } } } }
```
```jsonc
// explain_decision("PRM-2031")  → Tier-0, auto
{ "answer": "Zoning review is not stuck on error. It issued a request-for-information (missing
   INS-PROOF document) and moved the Task to awaiting-applicant, which PAUSED the per-authority
   SLA clock. The composite cannot roll up because zoning is still 'pending'. No adapter DLQ, no
   engine error.", "cites": [ "zoning-review@1.0.0", "task t-77c1 clock-stop" ] }
```

**Diagnosis:** the case is not broken. Zoning's per-authority SLA clock is **paused** in an
`awaiting-applicant` sub-state because it asked Mara for her insurance proof; the composite is
correctly waiting (doc 04 §5.2, §5.7). One authority's request-for-information pauses only its own
clock, not Safety's — exactly as designed. Devon confirms Mara was emailed and nothing is wrong.

Now suppose the trace had instead shown an outbound `notify-applicant` **adapter-call** landed in a
**DLQ** and the reminder email never sent. Fixing that means **re-driving** the case — a **Tier-2
production-mutating** action. Here the tier boundary bites (doc 10 §3.2–§3.3):

```console
$ # re_drive_case is Tier-2 (destructiveHint:true) — NOT auto-approved
▶ ichiflow-mcp: re_drive_case("PRM-2031") requires:
    · JIT short-lived non-human-identity credential (< 1h, risk-scored)
    · explicit human approval
    · audit-ledger entry attributing the action to the agent's NHI
  Proposed as an artifact for approval. Prefer re-drive/repro over in-place mutation.
```

The read-only diagnosis ran unattended; the production mutation stops for a JIT credential, a human
approval, and an audit entry attributed to the agent's non-human identity (doc 10 §3.3–§3.4). If Devon
wanted to verify a candidate fix first, `reproduce_case("PRM-2031")` (**Tier-1**, an MCP Task) would
seed a branch replica from captured event history for a deterministic one-command repro — never
touching prod (doc 10 §3.2, §4).

> **What Devon judges:** a provenance-cited diagnosis in three tool calls, and a hard stop before any
> write. Read-only was free; the fix requires approval. That asymmetry is the whole point.

---

## Act 10 — What exists in git at the end, and the exit story

Everything built above is **declarative text under version control** — the whole product is a diffable
Workspace:

```text
permits/
  contracts/src/permit.tsp                     # authored (TypeSpec)
  contracts/jsonschema/*.json                  # generated · canonical contract of record
  contracts/openapi/permit.yaml                # generated
  contracts/ui/*.uischema.json                 # designer-owned (baseline emitted once)
  kotlin/contracts-kt/… · packages/contracts-ts/…   # generated types (checked in)
  codesets/permit-outcomes.yaml · fee-schedule.yaml # governed reference data (versioned)
  decisions/  eligibility.dmn · fee.dmn · {safety,zoning}-review.dmn
              permit-review.composition.yaml · assign-reviewer.dmn
              scenarios/*.yaml                 # first-class governed tests
  flows/  permit.flow.ts → permit.flow.json    # authored-in: code · canonical JSON runs
  adapters/  notify-applicant.yaml
  .claude/ · AGENTS.md · .mcp.json             # the agent kit that came with init
```

Nothing here is trapped in an engine's proprietary format. **Migration OUT is as supported as
migration IN** (doc 00 principle; BRIEF §13): Decisions export as **DMN 1.6 XML** to any TCK-L3 engine,
the Flow exports as **CNCF-Serverless-Workflow-aligned JSON**, Schemas are **OpenAPI 3.1 / JSON Schema
2020-12**, CodeSets and case data export as standard dumps, and the differential/parity harness proves
equivalence on the way out. The `compute` step's crowd-density code is the one non-portable artifact —
but it is **schema'd at its boundary with golden datasets**, so its behaviour is _specified_ even
though the code doesn't port, and it is visibly counted against the workspace portability score
(doc 04 §2.6).

> A permit product — eligibility rules, a versioned fee table, a two-unit all-must-approve composition,
> conditional approvals with blocking and post-approval obligations, coded rejections, a manual-review
> referral with SLA and escalation, dual-audience rendering, business-user rule tuning, scenario tests,
> and runtime agent debugging — built by chat, judged by preview, and exportable end to end. That is
> the target v1 experience this document illustrates.

---

### Where to go deeper

- Schemas, CodeSets, the `Outcome`/`CompositeOutcome`/`Code` contracts —
  [`../architecture/02-schema-foundation.md`](../architecture/02-schema-foundation.md)
- DMN Decisions, composition policies, fee tables, governance dial, scenario tests, parity —
  [`../architecture/03-decision-layer.md`](../architecture/03-decision-layer.md)
- Flows, the `compute` step, Cases, Tasks, Conditions, SLA clock-stop, post-submission operations —
  [`../architecture/04-flow-and-case-layer.md`](../architecture/04-flow-and-case-layer.md)
- Generated Portals, JSON Forms overrides, per-audience code rendering, the Design Kit —
  [`../architecture/07-ui-and-portals.md`](../architecture/07-ui-and-portals.md)
- The agent kit, skills, `ichiflow-mcp` tools, and the three guardrail tiers —
  [`../architecture/10-ai-native-experience.md`](../architecture/10-ai-native-experience.md)
