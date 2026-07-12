# 04 — Flow & Case Layer

> Architecture doc. Consistent with [BRIEF.md](./BRIEF.md) (locked decision §2). Research input:
> [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md).

## What this covers

How ichiflow runs long-running business processes and human work: **Flows** (declarative,
long-running process definitions) and the first-party **Case & Task** module (manual review,
assignment, SLA, escalation). It covers the durable-execution substrate (Temporal), the ichiflow
**Flow DSL** and its generic interpreter, the step-type catalogue (including the first-class
**`compute`** code-activity step), the **three authoring surfaces** (typed code | YAML | AI chat) that
compile to one canonical Flow, the multi-language worker
topology, the Case/Task contract that Portals consume, how event history feeds the
**DecisionRecord**, and the testing / evolution / failure semantics for processes that live for
months.

## Position in the system

The Flow layer is the spine that ties the other modules together. A **Case** carries the global
`case_id`; its **Flow** decides what happens next by calling **Decisions** (the rule layer, DMN via
the Decision Engine SPI — see [../research/01-rule-engines.md](../research/01-rule-engines.md)),
invoking **Adapters** (ports in/out — see [05-adapters.md](./05-adapters.md)), and raising
**Tasks** for humans through **Portals** (audience-scoped UIs). Everything that happens is recorded
into the per-case **DecisionRecord** and queryable through the *why* API
([BRIEF.md](./BRIEF.md) §9; audit substrate in
[../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md)).

```
Decisions (DMN)   Adapters (ports)   Portals (task inbox)   DecisionRecord (why API)
      ▲                 ▲                    ▲                        ▲
      └───────────┬─────┴──────────┬─────────┴───────────┬───────────┘
                  │      FLOW      │       CASE / TASK     │
                  └──────── Temporal durable execution ────┘
```

---

## 1. Substrate: Temporal (durable execution)

ichiflow does not build a durable-execution engine; it stands on **Temporal** as the substrate
(locked decision, [BRIEF.md](./BRIEF.md) §2). The rationale is in
[../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) §1–§4 and is
not re-litigated here. The load-bearing facts:

- **MIT-licensed** server and SDKs. Self-host with zero license fees, air-gap capable, no rug-pull
  risk of the kind that removed Camunda 8 from consideration. This is what makes Temporal
  acceptable as an *embedded* substrate a customer must self-host
  ([../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) §7).
- **Event history + replay is the durability mechanism** — every command, timer, signal, and
  activity input/output is persisted and re-derivable. This is also, for free, the raw material of
  ichiflow's audit story (§8 below).
- **Determinism is the price.** Workflow code (here: the interpreter, §2) must be deterministic —
  no wall-clock, RNG, or uncontrolled I/O. All non-deterministic work happens in **activities**.
- **Multi-language via task-queue routing.** Workers poll named task queues; Kotlin rule-eval
  activities and TS integration activities live on separate queues and scale independently (§4).
  TypeScript is a first-class SDK; Kotlin is served through the Java SDK's `temporal-kotlin`
  extension and is therefore confined to *activity* workers, which have no determinism constraint.

Temporal runs in every tier ([BRIEF.md](./BRIEF.md) core vocabulary): a single dev binary at the
Dev tier, a small cluster at Team, and a zoned HA cluster (Postgres/Cassandra backing store) at
Enterprise. Same app code across tiers; config only.

---

## 2. The ichiflow Flow DSL

A **Flow** is a declarative document (JSON/YAML), **aligned with the CNCF Serverless Workflow**
specification, **schema-validated**, and **versioned in the Workspace** git repo. Flows are *not*
Temporal workflow code. Instead, a single generic **interpreter workflow** — a normal, deterministic
Temporal workflow — loads a Flow definition, walks its graph, and drives activities. This is the
"declarative DSL over a durable engine" pattern, which is established prior art, not speculation
(Temporal's own Serverless-Workflow DSL sample, Zigflow; see
[../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) §5).

### 2.1 Why this design

| Property | How the interpreter-over-Temporal design delivers it |
|---|---|
| **Business-comprehensible** | The Flow document *is* the shared artifact between analysts, engineers, and auditors. A domain user reads and diffs a YAML flow far more easily than TS/Kotlin workflow code — this recovers BPMN's comprehension benefit without adopting a BPMN engine. |
| **Migratable** | Authoring in CNCF Serverless Workflow makes the definition a portable, vendor-neutral artifact. It is the migration-out hedge against "proprietary Temporal code" — flows export cleanly ([BRIEF.md](./BRIEF.md) §13). |
| **Safe for LLM authoring** | An AI agent authors a *constrained, schema-validated JSON/YAML document* rather than free-form workflow code. The schema bounds what can be expressed; a validator rejects malformed flows pre-deploy. This is dramatically safer than letting an LLM emit code that must itself be deterministic. |
| **Replay-audit for free** | Because the interpreter is an ordinary Temporal workflow, every flow instance gets event history + replay + versioning/patching automatically. The "why did this case take this path" answer is re-derivable from the history (§8). |

### 2.2 Constraints

- **Determinism.** The interpreter is deterministic Temporal workflow code. All non-determinism —
  rule evaluation, integration I/O, time, randomness — is pushed into activities. Flow authors
  cannot introduce non-determinism because the DSL has no primitive for uncontrolled I/O; every
  side-effecting step is an activity call.
- **Two version axes.** A running flow instance is pinned by *both* (a) the **interpreter version**
  (the Temporal workflow code, evolved with Temporal `patched()`/Worker Versioning) and (b) the
  **Flow definition version** (the schema version + the specific flow document version it started
  on). A months-long case keeps replaying against the definition and interpreter it began with; new
  cases start on the new versions (§10).
- **Schema-pinned.** The DSL schema itself is versioned. The interpreter validates a flow against
  the schema version it declares; an instance never silently migrates to a newer DSL schema.

### 2.3 Step types (the DSL catalogue)

The v1 Flow DSL supports a fixed, schema-defined set of step types. Every step maps to a
deterministic interpreter operation and/or an activity invocation.

| Step type | Meaning | Maps to |
|---|---|---|
| **decision-eval** | Evaluate a DMN **DecisionModel** and branch/annotate on the result | Activity on the Kotlin rule-eval queue (Decision Engine SPI) |
| **adapter-call** | Send/request through a declared **Adapter** (outbound port) | Activity on the TS integration queue → canonical bus ([05-adapters.md](./05-adapters.md)) |
| **compute** | Run a typed **code activity** for computation that is neither a Decision nor an Adapter — inter-step data reshaping, loop accumulation, derived state (§2.6) | Activity on a generic code-activity queue; versioned `ref` + schema'd I/O + trace emission |
| **human-task** | Raise a **Task**, block until resolved | `createTask` activity + **await-signal** with an **SLA timer** (§5) |
| **timer / SLA** | Durable wait (wall-clock or business-calendar) | Temporal timer; deterministic in the interpreter |
| **parallel / branch** | Fan-out concurrent branches; join on all/any/quorum. When branches are per-authority Decisions, the join emits a **`CompositeOutcome`** under a declared composition policy (§5.7), not an ad-hoc FEEL merge | Interpreter child scopes over multiple activities |
| **loop** | Iterate over a collection or until a condition | Bounded interpreter loop (guardrailed iteration cap) |
| **sub-flow** | Invoke another Flow definition as a child | Temporal child workflow (its own interpreter instance) |
| **signal / event-wait** | Block until an external signal or a canonical event arrives (with optional timeout) | Temporal signal / inbound canonical event correlated by `case_id` |
| **condition-gate** | Block a downstream Flow segment until a named **blocking Condition** reaches `fulfilled` (or is waived) — analogous to `signal/event-wait` but keyed to a Condition (§5.5) | Temporal await on the Condition's fulfilment signal / canonical event; the transition is recorded |

FEEL expressions (the DMN expression language) are the DSL's expression sublanguage for guards,
routing predicates, and data mapping, so business users use one expression syntax across Decisions
and Flows.

**The boundary rule — where YAML wins, where it degenerates.** A Flow step's YAML expresses **WHICH
steps run and in WHAT ORDER/CONDITION** — the control-flow graph and its guards — never **HOW data is
computed or reshaped** between steps beyond trivial field references. FEEL/JSONata are the
guard/routing/field-mapping sublanguage; they are *not* a place to encode computation. The DSL
degenerates exactly where YAML stops describing the graph and starts encoding logic — the failure
modes are consistent across every workflow DSL that has tried it:

1. **Complex data shuffling between steps** — a projection/merge/reshape of the outputs of several
   prior steps expressed as inline FEEL/JSONata. The single worst failure mode.
2. **Loops with computed state** — accumulating a running total, deduping into a set, maintaining a
   cursor.
3. **Conditional fan-out where the branch *set* is itself computed** (dynamic parallelism over a
   computed list), not a fixed set of declared branches.
4. **Error-handling that derives new state** (beyond saga-compensation-as-declared-steps, §10).

Above that line, computation runs in a first-class **`compute` step** (§2.6) — a typed Kotlin/TS
**code activity** (the same kind of typed activity as `decision-eval` and `adapter-call`, §2.3 table)
that is *more* legible and diffable than sprawling inline expression, and stays on the audit spine
because the activity is schema'd at its boundary and emits a trace like any other step. Below the line
(a graph of named steps, a fixed set of guarded branches) YAML's comprehension/audit/portability
advantage dominates and the flow stays declarative. The `compute` step is the **step-level** hatch —
it keeps the declarative graph intact and drops *only the computation* into typed code — so the coarse
"drop the whole flow to raw Temporal SDK" hatch (ADR-0004) recedes to a last resort for genuinely
code-shaped *orchestration* only.

### 2.4 Scheduled and batch triggers

Flows do not only start from an inbound canonical command. A Flow definition can declare a
**scheduled trigger** — a cron/interval or business-calendar schedule that **maps directly to
Temporal Schedules** — for recurring work: nightly re-scoring campaigns, obligation-deadline sweeps
(§5.5), periodic reconciliation, and batch imports. A **batch trigger** fans a scheduled run out
**over a set of Cases** (a `find_cases`-style selector → a child sub-flow per Case, or a bounded
`loop` over the selection), so "re-score every open Case in region EU tonight" is a **declared Flow,
not a bespoke cron job**. Because the trigger resolves to a Temporal Schedule and the work runs as
ordinary interpreter steps, scheduled/batch Flows inherit the same durability, replay-audit, and
DecisionRecord wiring as command-triggered Flows, and respect the same idempotency and per-Case
version pinning (§2.2) as any other Flow instance.

### 2.5 Flow authoring surfaces (typed code | YAML | AI chat)

A Flow has **three authoring surfaces**, but exactly **one canonical artifact**. The **canonical Flow
JSON is the single executed, audited, and exported artifact** ([BRIEF.md](./BRIEF.md) §2; ADR-0004);
the surfaces are ways to *produce* it, not competing representations of it.

- **Typed TS/Kotlin flow builder.** Steps, guards, and event listeners authored as **pure typed code**
  — IDE autocomplete, refactoring, compile-time step-wiring checks, and host-language loops/conditionals
  to *generate* the graph. It compiles **one-way** to the canonical Flow JSON, exactly the
  **TypeSpec→OpenAPI two-layer pattern** ([02-schema-foundation.md](./02-schema-foundation.md) §1): the
  emitted JSON is checked in and human-primary. **No round-trip is promised** — you do not regenerate
  the builder from hand-edited JSON — and a single flow is never a persistent mix of hand-YAML and
  builder output.
- **YAML.** Simple flows are authored as canonical YAML/JSON directly — the business-user-readable,
  diffable, portable surface that remains primary for straightforward graphs.
- **AI chat.** Under the authoring doctrine (ADR-0019; doc 00 "Chat to author, preview to judge"), the
  AI writes the canonical flow from conversation; the human judges it via the **read-only flow diagram
  projection** (§6) and scenario **simulation** (§8), and approves the **diff + preview** pair.

Every Flow records **`authored-in: code | yaml | ai-chat`** provenance ([BRIEF.md](./BRIEF.md)
vocabulary "authored-in"), so a reviewer knows which surface produced the canonical artifact — while
governance, simulation, versioning, and the interpreter all key off the canonical JSON regardless.

**A visual/drag-and-drop flow builder is a non-goal** (doc 00 non-goals; ADR-0019). The Mermaid flow
diagram (§6) is a **read-only projection** rendered *from* the canonical Flow, the surface a human
*judges* a change on — never a second editable canvas that could drift from the artifact.

### 2.6 The `compute` step — first-class typed code activity

The `compute` step (§2.3 catalogue) is the first-class primitive for computation a Decision or Adapter
does not own. It keeps the flow graph declarative while moving genuine computation off inline
FEEL/JSONata into typed Kotlin/TS:

```yaml
# a compute step — keeps the graph declarative, moves computation to typed code
- id: prepare-underwriting-context
  type: compute                                   # alongside decision-eval / adapter-call
  ref: kt://underwriting/PrepareContext@2.1.0     # registered, versioned code activity (Kotlin or TS)
  input:  { schema: schema://underwriting/PrepareContextInput/1 }    # schema'd at the boundary
  output: { schema: schema://underwriting/PrepareContextOutput/1 }
  # runs as an ACTIVITY (determinism-safe); emits a typed trace exactly like decision-eval
```

Four properties keep it on the audit spine:

- **Schema'd at the boundary** — input/output JSON Schema, validated by the same runtime validators as
  every adapter/decision ("one schema, no drift").
- **Declared in the flow** — referenced by versioned `ref`, so the graph stays complete and a reviewer
  sees "compute step X runs here between the decision and the emit."
- **Unit-testable** in its native language **and stub-able** at the flow boundary — a scenario test
  (§8) stubs its output exactly like a decision outcome.
- **Trace-emitting** — writes a typed trace entry (input snapshot, output, `ref` version, timing) into
  the DecisionRecord, so it appears in the *why* API alongside `decision-eval`.

Because it is an **activity**, it never threatens the interpreter's determinism (§2.2). This is the
**same unified code-activity contract** as a Decision **feature-function**
([03-decision-layer.md](./03-decision-layer.md) §2.4) and an Adapter **code-transform**
([05-adapters.md](./05-adapters.md) §1) — one primitive
(`ref: <lang>://<module>/<Name>@<version>` + boundary JSON Schema + trace), not three weaker,
layer-specific hatches (BRIEF vocabulary "compute step / code activity", ADR-0004). It carries the same
non-portability discipline as the DRL/feature-function hatch — schema'd I/O + golden datasets so
behaviour is *specified* even though the code does not port, denting the workspace portability score
(G6).

---

## 3. Flow interpretation architecture (diagram)

```mermaid
flowchart TB
    subgraph WS["Workspace (git)"]
        DEF["Flow definition\n(JSON/YAML, CNCF-SWF-aligned)\nschema-validated, versioned"]
        DMN["DecisionModels (DMN)"]
        ADP["Adapter declarations"]
    end

    subgraph TS_WF["Temporal Service"]
        INT["Generic Interpreter Workflow\n(deterministic TypeScript)\npinned: interpreter vX + defn vN"]
        EH["Event History\n(commands, timers, signals,\nactivity in/out)"]
    end

    subgraph KQ["Kotlin activity workers\n(task queue: rules)"]
        RE["decision-eval\n(Decision Engine SPI → DMN/FEEL)"]
    end

    subgraph TQ["TS activity workers\n(task queue: integration)"]
        IA["adapter-call\n(outbound port)"]
        TA["createTask / notify"]
    end

    DEF -->|loaded + validated| INT
    DMN -.referenced.-> RE
    ADP -.referenced.-> IA

    INT -->|route by queue| RE
    INT -->|route by queue| IA
    INT --> TA
    INT --> EH

    EH -->|projected| DR["DecisionRecord / why API"]
```

The interpreter reads the versioned definition, walks the graph, and dispatches each step to the
correct **task queue**. It never imports a broker client or a rules engine directly — those live
behind activities. The event history it accumulates is projected into the DecisionRecord (§8).

---

## 4. Worker topology (independently scalable)

Two worker fleets poll two task queues, decoupled from the interpreter and from each other:

- **Kotlin activity workers — task queue `rules`.** Host **decision-eval** activities: the Decision
  Engine SPI evaluating DMN/FEEL on Apache KIE / Drools (default engine, [BRIEF.md](./BRIEF.md) §1).
  Kotlin's confinement to activities sidesteps the "Kotlin is not a first-class Temporal SDK" risk
  ([../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) §1, §3) —
  activities carry no determinism constraint.
- **TypeScript activity workers — task queue `integration`.** Host **adapter-call** activities
  (outbound ports to the canonical bus), **createTask/notify**, and other I/O. The interpreter
  workflow itself is also TypeScript (first-class, GA SDK).

Because each queue's workers are stateless and scale on their own, a spike in rule evaluation does
not starve integration throughput, and vice versa. This is the independent-scalability property
Temporal provides natively via task-queue routing. Later, cross-team/cross-namespace fan-out uses
Temporal **Nexus** without changing the Flow DSL.

---

## 5. First-party Case & Task module

Temporal gives ichiflow durable execution but **no** task store, assignment engine, or reviewer UI
([../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) §6). Building
these is deliberate — it is ichiflow's product moat and is the same work any code-first engine
would require. The Case & Task module is a first-party ichiflow module layered on the substrate.

### 5.1 Case lifecycle

A **Case** is the unit of business work. It is created when a Flow starts (typically from an inbound
canonical command), carries the global `case_id`, and aggregates the flow instance(s), the Tasks,
the fired-Decision traces, its Outcome and its Conditions (§5.5), and the DecisionRecord. Its lifecycle —
`Open → InProgress → (Suspended) → Resolved → (ObligationsOpen) → Closed` — is driven by the Flow, not
hand-managed; the Case row is a projection of flow state plus case-level metadata (owner, tenant,
priority, SLA envelope).

- **`ObligationsOpen`** is the lightweight state a Case sits in when it has **resolved** but still
  carries live **post-approval obligations** (§5.5) — deadline-bearing conditions and retention windows
  that must be tracked *after* the substantive work is done. A Case reaches `Closed` only when its
  obligations are all fulfilled/waived/expired. (Equivalently, an obligation may spawn a durable child
  timer/Task that outlives the parent Case; §5.5.)
- **Case ↔ artifact versioning.** The governed output artifact a Case produces (its "permit/decision"
  record) is **versioned**. Amendment and correction (§5.6) produce a **new version** of that artifact,
  version-linked to its predecessors, with the **DecisionRecord spanning all versions** — so the audit
  chain survives amendments ([08-audit-and-observability.md](./08-audit-and-observability.md) §1).

### 5.2 Manual review = await-signal + SLA timer + escalation

A **human-task** step implements the documented, battle-tested Temporal human-in-the-loop pattern:

1. **Create task.** An activity writes a **Task** = `{ case_id, workflow_id, type, payload, queue,
   assignee?, sla, state }` to the task store and emits a `task.created` event.
2. **Block on a signal.** The interpreter waits for a resolve **signal** (`approve` / `reject` /
   structured outcome). Signal handlers are **idempotent** so double-clicks and retried deliveries
   resolve once.
3. **SLA timer runs concurrently.** A Temporal timer races the signal. On expiry the flow follows
   its **escalation chain** — reassign, notify, escalate to a supervisor queue, or auto-decide via a
   fallback Decision — each step itself an ordinary DSL step, so escalation is authored, not
   hard-coded.

The SLA timer is **pausable** (clock-stop): when a Task enters an `awaiting-external` /
`awaiting-applicant` sub-state — because the ball has moved to the applicant or another party for
more information — the SLA clock pauses and the paused interval is excluded from SLA accounting.
This is a common, legally-material pattern (SLA is measured excluding the party's own wait); the
mechanics are in §5.7.

Because this is all durable Temporal state, a Task can wait days or months across worker crashes and
restarts without losing position.

### 5.3 Assignment routing is itself a Decision

Who a Task goes to — round-robin, skill/role-based, load-based, tenant-scoped — is **not** bespoke
code. It is a **decision-eval** step against an assignment **DecisionModel** ([BRIEF.md](./BRIEF.md)
§2: "assignment routing is itself a decision"). The rule layer the platform already runs decides the
assignee/queue; routing rules are governed, simulated, and explained like any other DMN Decision,
and their output lands in the DecisionRecord.

The same "routing is a Decision" pattern governs **design-time** approvals too: a **reference-data
(CodeSet) change** opens an approval Case (approval is itself a Flow) whose reviewers are routed **by role
within the artifact's owning Team**, again as a Decision — see
[03-decision-layer.md](./03-decision-layer.md) §5.8 and [06-identity-and-access.md](./06-identity-and-access.md)
Part 4.

### 5.4 Task inbox contract (consumed by Portals)

The module exposes a schema'd **task inbox contract** (TypeSpec-authored → OpenAPI/JSON Schema,
[BRIEF.md](./BRIEF.md) §5) that back-office and other **Portals** consume. The contract is
UI-agnostic: list/claim/reassign/resolve operations plus a filter/search surface over the task
store. Row/field visibility on the inbox is enforced by the central PDP (ReBAC filter + ABAC field
masks, [BRIEF.md](./BRIEF.md) §8), so the same authorization drives the generated inbox UI and its
API. Resolving a Task through the contract sends the Temporal signal back into the waiting flow.

```yaml
# Task (canonical, schema'd — the shape Portals render and resolve)
Task:
  case_id: c-2026-000431
  task_id: t-9f2a
  type: loan.manual_review.v1
  queue: underwriting-tier2
  assignee: null                 # set by the assignment Decision
  sla:                           # pausable clock-stop SLA (§5.7)
    budget: P3D
    elapsed: P1D4H
    clock: running               # running | paused
    escalation: chain/underwriting-esc-1
  state: open                    # open | claimed | awaiting-external | resolved | escalated | expired
  payload_ref: schema://loan/ManualReviewContext/1
  correlation: { signal: resolve, idempotency_key: t-9f2a }
```

### 5.5 Conditions: typed, stateful outcome obligations

A Case's Outcome (doc 02 §9.3) can carry **Conditions** — a first-class entity the Case module tracks as
part of its projected state. Each Condition is individually typed and individually stateful:

- **`kind`** — `blocking` (gates a downstream event/step) or `post-approval-obligation` (an obligation
  tracked after the substantive decision).
- **`state`** — `pending → fulfilled | waived | breached`.

The two kinds behave differently in the Flow:

- **Blocking conditions gate later steps.** A blocking Condition (e.g. "present the item for
  inspection," "prior approval obtained," "duty paid") holds a downstream Flow segment via a
  **`condition-gate`** step (§2.3) until it reaches `fulfilled` or is `waived`. Fulfilment arrives as a
  signal or canonical event (correlated by `case_id`) and the transition is recorded to the
  DecisionRecord.
- **Post-approval obligations can outlive Case closure.** Obligations carry **deadlines** and
  **retention windows** ("return supporting documents within 48 hours," "retain records five years,"
  "re-export within the window"). They must be trackable *after* the Case reaches `Resolved`: the Case
  either sits in the lightweight `ObligationsOpen` state (§5.1) or the obligation spawns a **durable
  child timer/Task**. A **missed deadline** flips the Condition to `breached`, raises a canonical
  `condition.breached` event, and may open a **remediation Case** — the breach is a distinct,
  audit-first-class event ([08-audit-and-observability.md](./08-audit-and-observability.md) §4.6).

```yaml
# Conditions on a Case Outcome (canonical shapes from doc 02 §9.3)
conditions:
  - code: PRESENT_FOR_INSPECTION
    codeSet: obligations@4.3.0
    kind: blocking
    gates: [cargo-release]          # a condition-gate step keyed here holds the release segment
    state: pending
  - code: RETURN_SUPPORTING_DOCS
    codeSet: obligations@4.3.0
    kind: post-approval-obligation
    deadline: { fromResolution: P0D, dueIn: PT48H }   # tracked after the Case resolves
    state: pending
```

### 5.6 Post-submission Case operations

A submitted Case is not frozen at "decided." ichiflow models **amend, cancel, withdraw, appeal, and
correct** as first-class Case operations. Each operation is:

1. **State-gated** by the Case lifecycle — e.g. *amend* only while the artifact is not yet consumed or
   expired; *cancel* only within a validity window and not while under compliance hold.
2. **Reason-coded** from a governed CodeSet where applicable — cancellation captures a reason code
   (a `cancellation-reasons` CodeSet, doc 02 §9.1).
3. **Field-scoped for amendment** via a governed **field-amendability CodeSet**: some fields are
   amendable in place, others are **non-amendable** — attempting to change a non-amendable field forces
   a **cancel-and-resubmit** path rather than a mutation.
4. **Artifact-versioning** (§5.1): the operation produces a **new version** of the governed output
   artifact while preserving DecisionRecord continuity across versions.
5. **Alternative-remediation aware**: when a hard state gate blocks the operation (e.g. the artifact is
   already consumed, or the case is expired past a threshold, or under audit), the operation branches to
   an **alternative-remediation Flow** (e.g. voluntary disclosure / manual redress) rather than failing
   silently.

**Correlated child Cases.** *Correction*, *appeal*, and *withdraw* open **correlated child Cases** that
reference the parent's DecisionRecord — a correction re-enters as a *new* correlated submission (the
original Case closed as rejected/superseded), an appeal spawns a review sub-case, a withdrawal records a
terminal disposition. This formalises the Case↔Flow cardinality question (Open questions): a Case is not
strictly 1:1 with a root Flow — post-decision operations spawn sibling/child flows under one correlation
lineage.

| Operation | Typical state gate | Reason-coded | Produces |
|---|---|---|---|
| **amend** | not consumed / not expired; field is amendable | (field-amendability CodeSet) | new artifact version |
| **cancel** | within validity; not under hold | cancellation-reason CodeSet | terminal cancel + version |
| **withdraw** | pre-resolution | optional | terminal disposition |
| **appeal** | post-decision, within appeal window | appeal-reason CodeSet | correlated child review Case |
| **correct** | on non-amendable field / post-rejection | correction-reason CodeSet | new correlated child Case |

### 5.7 Clock-stop (pausable) SLA timers and composite per-authority clocks

SLA timers support **pause/resume** so that time spent waiting on an external party does not count
against the processing budget:

- Entering an `awaiting-external` / `awaiting-applicant` Task sub-state (§5.2, §5.4) **pauses** the SLA
  clock; resuming (the party responds) **resumes** it. The paused interval is **excluded** from SLA
  accounting and **recorded distinctly** as a clock-stop event
  ([08-audit-and-observability.md](./08-audit-and-observability.md) §4.6), because it carries SLA-reporting
  weight.
- A **composite Case** (§2.3 in [03-decision-layer.md](./03-decision-layer.md)) runs **independent
  per-authority clocks**: each authority's Decision has its own SLA budget and its own pause/resume
  state, so one authority's request-for-information does not pause another's clock, and the Case-level
  view aggregates the per-authority clocks.
- The **composite fan-out/join** is a `parallel/branch` step (§2.3) whose join applies the declared
  **composition policy** and emits a `CompositeOutcome`; authority-selection is a `decision-eval` routing
  step over a classification CodeSet (§5.3, "routing is a Decision").

```yaml
# Pausable SLA on a Task (clock-stop), with an awaiting-applicant sub-state
Task:
  sla: { budget: P3D, elapsed: P1D4H, clock: paused }   # paused excludes applicant wait
  subState: awaiting-applicant                           # open | claimed | awaiting-applicant | resolved | ...
  clock: { pausedAt: 2026-07-10T09:00:00Z, reason: request-for-information }
```

---

## 6. Manual-review Flow example (diagram)

A loan application that auto-decides when the score is clear and routes to manual underwriting when
it is not.

```mermaid
flowchart TD
    START([LoanApplicationReceived\ncanonical command]) --> SCORE

    SCORE["decision-eval:\nscoreApplication (DMN)"] --> GATE{FEEL: outcome}
    GATE -->|approve| APPROVE
    GATE -->|decline| DECLINE
    GATE -->|refer| ASSIGN

    ASSIGN["decision-eval:\nassignReviewer (DMN)\n= routing is a Decision"] --> TASK

    subgraph REVIEW["human-task: manual underwriting"]
        TASK["createTask →\nawait resolve signal"]
        SLA{{"SLA timer\n(48h)"}}
        TASK -. races .- SLA
    end

    TASK -->|approve/decline signal| MERGE
    SLA -->|expiry| ESC["escalation chain:\nreassign → supervisor →\nauto-decide fallback Decision"]
    ESC --> MERGE

    MERGE --> EMIT["adapter-call:\nemit LoanDecision (outbound port)"]
    APPROVE --> EMIT
    DECLINE --> EMIT
    EMIT --> DONE([Case Resolved])
```

---

## 7. Event history → DecisionRecord integration

The per-case **DecisionRecord** is a first-class typed domain object ([BRIEF.md](./BRIEF.md) §9)
that stitches workflow event history + fired-rule traces + DMN results + human review + AI-agent
actions into one causal chain. The Flow layer is its primary feeder:

- Temporal **event history** provides the ordered spine — every step entry/exit, timer, signal, and
  activity input/output, keyed to `case_id` via a Temporal search attribute.
- **decision-eval** activities attach the DMN result and the fired-rule trace to the corresponding
  history event.
- **human-task** resolutions attach reviewer identity, outcome, and timing (delegation vs
  auto-decide on SLA expiry recorded distinctly).
- **adapter-call** steps attach the correlated message id / DLQ outcome ([05-adapters.md](./05-adapters.md)).

The DecisionRecord is a **projection** of this history (event-source the decision/flow core;
[BRIEF.md](./BRIEF.md) §9), so the *why* API can re-derive "this case took path X because Decision D
returned R and reviewer U approved at T" directly from durable, replayable state. No separate,
drift-prone audit log is authored by hand.

---

## 8. Testing Flows

The DSL-over-Temporal design makes flows testable at three levels, all leaning on Temporal's
first-class test framework ([../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) §3):

- **Deterministic replay tests.** Old event histories are replayed against the current interpreter +
  definition to catch non-deterministic changes *before* deploy. This is the safety net for evolving
  the interpreter under long-running instances (§10).
- **Time-skipping tests.** The time-skipping test server fast-forwards through day/month SLA timers
  so a 48-hour escalation is verified in milliseconds.
- **Scenario tests business users can read.** Because the Flow definition and its Decisions are
  declarative, a scenario is expressed as `given inbound command + stubbed Decision outcomes +
  simulated signals/timer expiries → expected path and Tasks`. These read as business narratives,
  not code, and double as living documentation and regression fixtures. Decision parity testing
  (legacy vs migrated rules on golden datasets, [BRIEF.md](./BRIEF.md) §13) plugs in at the
  decision-eval boundary.

---

## 9. Flow evolution for months-long cases

Enterprise cases run for months, so a flow *will* change while instances are in flight. ichiflow
evolves flows on two axes (introduced in §2.2), using Temporal's versioning machinery:

- **Definition versioning.** A new Flow document version is a new artifact in the Workspace. New
  Cases start on it; in-flight Cases keep their pinned definition version. The interpreter selects
  the definition version recorded in the instance's history, never "latest."
- **Interpreter patching.** When the interpreter code itself must change (new step semantics, bug
  fixes), Temporal `patched()` / `GetVersion` markers branch new-vs-in-flight executions safely, and
  "deprecated patch" retires a marker once no old instances remain. **Worker Versioning** pins task
  queues to interpreter builds.
- **Patch strategy for structural flow changes.** Adding a step to a running long case uses the same
  patch discipline: gate the new segment behind a definition-version check so replay of an older
  instance follows the path it was authored with. Replay tests (§8) are mandatory in CI before any
  interpreter or definition change ships.

This is exactly the machinery a months-long enterprise flow needs to evolve without corrupting
in-flight state — a key reason Temporal is the substrate rather than a lighter engine.

---

## 10. Failure semantics

| Concern | Stance |
|---|---|
| **Activity retries** | Every activity has a Temporal retry policy: exponential backoff + jitter, capped attempts, per-activity timeouts. Transient integration/rule failures self-heal without touching flow state. |
| **Compensation / saga** | Multi-step outbound effects use the **saga** pattern: the interpreter records compensating steps as it progresses and runs them in reverse on unrecoverable failure. Compensation steps are ordinary **adapter-call** DSL steps, so rollback is authored and auditable. |
| **DLQ handoff to adapters** | Delivery reliability is the Adapter layer's responsibility, not the flow's. An outbound **adapter-call** hands off to the adapter's at-least-once + transactional-outbox + retry/backoff + **DLQ** machinery ([05-adapters.md](./05-adapters.md) §reliability). The flow observes success/failure via the activity result and correlated message id; poison messages land in the adapter DLQ with triage/replay tooling, not in a stuck workflow. |
| **Non-retryable failures** | Business-rule rejections and validation failures are *outcomes*, not errors — they flow through branches (e.g. `decline`), not the retry machinery. |
| **Idempotency** | Human-task signals and inbound canonical events carry idempotency keys; handlers dedupe so redeliveries and double-clicks apply once (mirrors the Idempotent Receiver at the adapter edge, [05-adapters.md](./05-adapters.md)). |

---

## Open questions

- **DSL coverage vs CNCF-SWF fidelity.** How strictly does the v1 DSL track CNCF Serverless Workflow
  1.0 vs. adding ichiflow-specific step types (human-task, decision-eval)? Strict fidelity maximizes
  portability; extensions maximize expressiveness. Likely: a conformant core + a clearly-marked
  ichiflow extension namespace, with the extensions degrading gracefully on export.
- **Case aggregate vs Flow instance cardinality.** §5.6 establishes that post-decision operations
  (appeal / correct / withdraw) spawn **correlated child Cases**, so a Case is *not* strictly 1:1 with a
  root Flow. The residual question is the stitching model for a Case that spans multiple sibling flows
  *concurrently* (e.g. a submission with parallel per-authority sub-cases under §2.3 composition) — how
  the DecisionRecord and task-inbox grouping present one logical Case over N flows.
- **Interpreter granularity.** One universal interpreter workflow vs. a small family (e.g. a
  separate interpreter for high-fan-out vs. long-human-wait shapes) to tune Temporal history size
  and sticky-cache behavior. Undecided pending load testing.
- **Business-calendar timers.** SLA timers need business-hours/holiday calendars per tenant. Whether
  the calendar resolves in the deterministic interpreter (calendar data pinned into history) or via
  an activity (re-fetched on replay) is a determinism trade-off to settle.
- **Long-history mitigation.** Months-long, signal-heavy cases can grow large event histories;
  continue-as-new checkpointing strategy and its interaction with DecisionRecord projection need a
  concrete policy.
- **First-class `compute` step — decided (ADR-0004, amended).** The `compute` step is now a
  first-class step type (§2.6): a schema'd, versioned, trace-emitting code activity alongside
  `decision-eval`/`adapter-call`, so inter-step computation is a *declared* graph node and the coarse
  "drop the whole flow to raw Temporal SDK" hatch recedes to a last resort. It shares one unified
  code-activity contract with decision feature-functions and adapter code-transforms. The residual
  detail is the generic code-activity worker's task-queue topology and its cold-start/versioning story
  under load — an implementation question, not a design one.
