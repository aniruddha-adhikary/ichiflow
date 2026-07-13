---
name: run-verify
description: Run `ichiflow verify` and read the machine-readable verdict. Use whenever you need to know whether/what/how-much of a subsystem is done and correct.
---

# run-verify

The single verification entry point. Done-ness is a JSON verdict, never a prose claim.

## Steps

1. Build first if you changed TypeSpec or TS: `pnpm build`.
2. Run the scope you care about (tight loop while editing one thing):
   ```
   pnpm verify --scope <subsystem|artifact> --json
   ```
   Omit `--scope` to run everything (CI's full loop).
3. Read the verdict envelope (doc 13 §3.2):
   - `verdict`: `pass` | `fail`.
   - `summary`: `{ checks, passed, failed, skipped }`.
   - `progress`: enumerable "how much is done" (`conformance.green/total`, `coverage`).
   - `checks[]`: each failed check carries a **structured diff** (expected/actual/artifact) — fix that.
4. `flaky` must be `false`. If a check flips between runs, it is a **harness defect** — fix the
   determinism (seed time/data), never retry to clear (doc 13 §3.6).

## Registered scopes

`self-check` (the meta-harness), `agent-kit`, `schema-fidelity-spike`, `schema-pipeline`, `codegen`,
`contract-vectors`, `reference-data`, `decision-projection-spike`, `contract-gate`, `decision-layer`,
`interpreter-determinism-spike`, `flow-layer`, `decisionrecord`, `entity-store`, `entity-api`, `authz`, `ui`, `portal`, `adapters`, `code-quality`. More come online phase by phase (doc 14).

`schema-fidelity-spike` cross-checks Ajv (TS) against networknt (JVM) on a hard probe corpus, so it
needs the JVM verdicts on disk first: run `pnpm spike:jvm` before `pnpm verify` (or the full loop).

`schema-pipeline` validates the committed OpenAPI 3.1 + JSON Schema 2020-12 artifacts (existence,
`$ref` integrity, canonical-model reuse). Byte-level drift is a separate gate: `pnpm schema:drift`.

`codegen` asserts the generated edges — TypeScript types (hey-api) and Kotlin models (Fabrikt) —
cover every OpenAPI component schema. Regenerate with `pnpm codegen:ts` / `./gradlew generateModels`;
byte-level drift is gated by `pnpm codegen:drift` (TS) and `./gradlew checkModelsUpToDate` (Kotlin).

`contract-vectors` cross-checks Ajv (TS) against networknt (JVM) on a corpus of accept/reject vectors
for the _real_ contract (VerdictEnvelope & members); run `pnpm vectors:jvm` before `pnpm verify`.

`reference-data` validates the committed CodeSet fixtures (`schemas/reference-data/fixtures/*.codeset.json`)
against the emitted `CodeSet` contract and enforces cross-CodeSet `codeRef` referential integrity —
each reference must resolve to a live row whose effective window covers the referencing row's.

`decision-projection-spike` compiles the `decision-source` fixture to DMN 1.6 and executes it and a
hand-authored reference DMN on Apache KIE / Drools, asserting identical results per input vector; run
`pnpm decision:jvm` before `pnpm verify` to produce `core/build/decision-projection-results.json`.

`contract-gate` asserts **zero breaking changes** in the emitted OpenAPI vs the released baseline
(`schemas/contract/openapi.baseline.yaml`), using oasdiff. It reads the git-ignored results file
`.ichiflow/contract-diff.json`, so run `pnpm contract:diff` first (like `pnpm spike:jvm` for the
fidelity spike). To **accept** an intentional breaking change: run `pnpm contract:accept` (copies the
emitted OpenAPI over the baseline) and commit the updated baseline — that commit is the record of the
deliberate contract change.

`decision-layer` runs the curated DMN-TCK subset through the Decision Engine SPI reference engine
(Drools) and asserts `tck_cases_green == total` plus the capability descriptor; run
`pnpm decision-tck:jvm` before `pnpm verify` to produce `core/build/decision-tck-results.json`. It
also asserts **projection coverage** — every construct in the DMN feature matrix
(`schemas/decision-source/projection/matrix.json`) projects from `decision-source` to DMN 1.6 and
executes correctly on the SPI engine (`constructs_covered == total`); run `pnpm projection:jvm` first
to produce `core/build/projection-coverage-results.json`. It also asserts **trace-shape conformance**
— every `evaluate` emits a typed `DecisionTrace` (doc 03 §7) that must validate against the frozen
`DecisionTrace` JSON Schema (`traces_valid == total`); run `pnpm trace:jvm` first to produce
`core/build/decision-trace-results.json`. It also runs a DecisionModel's governed **`Harness`** (doc
03 §6): the scenario suite must produce each case's full typed `Outcome` (`scenarios_pass == total`)
and meet the declared rule/row **coverage** threshold (`rule_row_coverage_pct >= threshold`); run
`pnpm scenario:jvm` first to produce `core/build/scenario-coverage-results.json`. And it asserts the
frozen **FEEL semantics vectors** (doc 13 §2.b) still evaluate to their pinned results on the
reference engine (`feel_vectors_green == total`); run `pnpm feel:jvm` first to produce
`core/build/feel-vector-results.json`.

`interpreter-determinism-spike` is the Phase 3.0 riskiest-bet proof (doc 14 §6): the generic Temporal
interpreter (`packages/flow/`) runs a toy 3-step flow (compute → 30-day SLA timer → compute) on the
time-skipping test env; the harness asserts the recorded history **replays twice with no
non-determinism violation**, the result is stable across an independent re-execution, and the
month-long SLA timer **fast-forwards** to milliseconds. Run `pnpm interpreter:spike` before
`pnpm verify` to produce `packages/flow/build/interpreter-spike-results.json`.

`flow-layer` is the Phase 3.1–3.3 conformance gate (doc 04 §2/§5): the committed flow-JSON
**conformance vectors** (`schemas/flow/vectors/*.vector.json`) validate against the emitted canonical
Flow DSL schema (authored in `schemas/flow.tsp`), and the _same_ generic interpreter run over each
vector — across the core step set (`compute` via a versioned code-activity ref, `decision-eval`,
`human-task` with **assignment-as-Decision** routing, a **pausable SLA** clock (resolve/pause/resume
signals), and an **escalation** chain, `timer`) — hits its independently-pinned oracle (final
blackboard/steps/SLA + a complete per-step trace + the pinned Case/Task **event history** keyed by
`case_id` + timer fast-forward) with clean replay determinism under time-skip (`vectors_green ==
total`). It also asserts **real-source DecisionRecord completeness** — every vector's assembled record
stitches into a gap-free chain (orphan detector clean). The DSL check runs in-process; run
`pnpm flow:conformance` before `pnpm verify` to produce
`packages/flow/build/flow-conformance-results.json`.

`decisionrecord` is the Phase 3.4 gate (ADR-0011, doc 08 §1, doc 13 §2.g): the per-Case
**DecisionRecord** stitches the flow event history + fired-Decision traces + Task resolutions into one
causal chain keyed by `case_id`, and its correctness is **completeness** (no gap). The committed case
fixtures (`schemas/decisionrecord/cases/*.case.json`) validate against the emitted
`DecisionRecordCase.json`, and the pure assembler run over each fixture's `FlowResult` must match the
pinned chain-completeness + `orphans` + stitched Decision/Task counts — positive fixtures stitch clean,
negative fixtures inject a gap (a Task-lifecycle event with no `task.created`, a dangling Task) the
**orphan-event detector** must flag (`cases_green == total`). Assembly is pure, so run
`pnpm decisionrecord:assemble` before `pnpm verify` to produce
`packages/flow/build/decisionrecord-results.json`.

`entity-store` is the Phase 4.1 gate (ADR-0018/0012, doc 13): the domain **entity store** is CRUD +
append-only audit log + **transactional outbox** (not event-sourced) for ordinary business records
(the reference `LoanApplication`). The committed vectors (`schemas/entity-store/vectors/*.vector.json`)
validate against the emitted `EntityStoreVector.json`, every persisted payload validates against the
schema-defined entity (`LoanApplication.json`) at the boundary, and replaying each vector's CRUD/query
ops against a fresh deterministic Repository SPI reference binding must reproduce the pinned audit-log +
outbox oracle in order, with the relay marking every outbox record delivered
(`vectors_green == total`, `outbox_delivered == outbox_total`). The binding uses monotonic sequence
stamps (no wall-clock/RNG), so run `pnpm entity:jvm` before `pnpm verify` to produce
`core/build/entity-store-results.json`.

`entity-api` is the Phase 4.2 gate (ADR-0018, doc 02 §5): the **generated BFF** over the entity store.
The LoanApplication CRUD/list HTTP surface is authored once in TypeSpec (`schemas/entity-api.tsp`) and
emitted to OpenAPI 3.1; the BFF (`packages/api/`) routes by that emitted document and validates every
request body and every response against the _same_ JSON Schema (zero-drift). The committed API-contract
vectors (`schemas/entity-api/vectors/*.vector.json`) validate against the emitted `ApiContractVector.json`;
replaying each through a fresh BFF+store yields responses that validate against the emitted OpenAPI
response schema for their status and hit the pinned ids/versions/totals/error-codes; every non-`Verify_status`
operation is covered; and the runtime boundary validator provably rejects malformed writes (≥1 `422`,
`vectors_green == total`). The store binding uses monotonic sequence stamps (no wall-clock/RNG), so run
`pnpm api:contract` before `pnpm verify` to produce `packages/api/build/api-contract-results.json`.

`authz` is the Phase 4.3 gate (ADR-0010/0025, doc 06 Parts 2 & 4, doc 13 §2.f): the **PDP slice**. v1
authorization is OpenFGA-only — Teams, membership, role-as-relation (steward/approver/editor/viewer),
and artifact/case ownership are a ReBAC model (`schemas/authz/model.json`), and one central PDP answers
both **design-time** (artifact edit/approve) and **runtime** (Case view/modify) checks over one
relationship graph (`schemas/authz/tuples.json`). The committed vectors
(`schemas/authz/vectors/*.vectors.json`) validate against the emitted `AuthzVector.json`; replaying each
through the PDP over the deterministic in-memory OpenFGA-semantics engine reproduces its pinned
allow/deny across the required relations (`vectors_green == total`), covers both enforcement surfaces
with **design-time = runtime parity** (the artifact-access and data-access PEPs never disagree), and
emits a schema-valid `AuthzDecisionLog` per decision. Deterministic (content-hash decision ids, no
wall-clock/RNG), so run `pnpm authz:jvm` before `pnpm verify` to produce `core/build/authz-results.json`.

`code-quality` consumes detekt (SARIF, zero findings) + ArchUnit rule results (SPI boundary etc.),
both build-failing in Gradle; run `pnpm quality:jvm` before `pnpm verify` to produce
`core/build/reports/detekt/detekt.sarif` and `core/build/arch-rules-results.json`.

`ui` is the Phase 4.5 gate (build plan 4.5, ADR-0024, doc 07 §2/§3/§11/§12, doc 13 §2.e): the
**uischema layer** (JSON Forms). A uischema is a layout tree authored independently of the data schema
(`schemas/ui.tsp` → emitted `UiSchema.json`); the generated-once baseline
(`schemas/ui/baseline/*.uischema.json`, produced by `pnpm ui:generate`) is a `VerticalLayout` with one
scoped Control per data-schema property. The scope asserts, as enumerable counts: the baseline is
DSL-valid + provenance-current; **scope lint** — every `Control.scope` JSON Pointer resolves against the
current data schema (a dangling pointer fails with a fix-it hint naming the pointer + file); **PDP-state
story coverage** — every placed control renders in all four PDP-shaped states (hidden / read-only / error
/ validation-failed), `states_covered == states_required`; **a11y AA** — axe-core (WCAG 2.2 AA) passes on
every story rendered headlessly in jsdom (`axe_aa_pass == stories_run`) with the token-contract contrast
gate met (text ≥ 4.5:1, UI ≥ 3:1); and **preview snapshots** — serialized-DOM baselines regenerate
byte-identically (`snapshots_matched == produced`, no timestamps/random ids). Deterministic (no
wall-clock/RNG/network), so run `pnpm ui:preview` before `pnpm verify` to produce
`packages/uischema/build/ui-results.json`.

`portal` is the Phase 4.4 gate (doc 07 §5/§7/§11, doc 13 §2.e/§2.f): the first back-office **Portal**
(`packages/portal/`, React under jsdom). Its deterministic preview harness renders a **PDP-filtered,
SLA-ordered Task inbox** (each seeded principal sees exactly the id set the SAME authz relation model —
`schemas/authz/model.json` — permits, incl. a cross-team principal who sees strictly fewer rows;
ordered soonest-due first) and a **Case/review view**: an action form whose submit emits a **Flow
signal** (validates against the emitted `FlowSignal.json`, never a direct mutation), the assembled
`DecisionRecord` trace (validates against emitted `DecisionRecord.json`) rendered as nodes, an
obligation checklist, and **field-level entitlements** (≥1 hidden with a "why?" affordance + ≥1
read-only for a lower-privilege principal, doc 07 §6/§11). Deterministic (seeded data + integer SLA, no
wall-clock/RNG), so run `pnpm portal:preview` before `pnpm verify` to produce
`packages/portal/build/portal-results.json`. The action-form uischema fixture is INTERIM (hand-authored
locally); wiring the generated `packages/uischema` (Phase 4.5) is a later follow-up.

`adapters` is the Phase 5.1 gate (doc 05, doc 13 §2.d): the canonical↔wire **adapter** boundary
(`packages/adapters/`), proven **without a live external system**. Its deterministic harness runs three
check families over the committed fixtures (`schemas/adapters/`): **contract tests** — every
Port/Mapping/golden/reliability fixture validates against its emitted canonical JSON Schema and every
canonical output validates against `CanonicalEnvelope`; **mapping goldens** — each **pure**
Message-Translator mapping reproduces its `input wire → expected canonical event` golden and every v1
transport binding (REST/broker/webhook) round-trips `decode ∘ translate` back to the same canonical
event; and **idempotency/DLQ vectors** — a duplicate `messageId` is deduped once (Idempotent Receiver),
a poison message lands in the DLQ after bounded attempts, and a crash redelivery applies once
(`dedup: pass`, `dlq: pass`). Deterministic (committed fixtures, no wall-clock/RNG), so run
`pnpm adapters:preview` before `pnpm verify` to produce `packages/adapters/build/adapters-results.json`.
