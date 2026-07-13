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
`interpreter-determinism-spike`, `flow-layer`, `decisionrecord`, `entity-store`, `code-quality`. More come online phase by phase (doc 14).

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

`code-quality` consumes detekt (SARIF, zero findings) + ArchUnit rule results (SPI boundary etc.),
both build-failing in Gradle; run `pnpm quality:jvm` before `pnpm verify` to produce
`core/build/reports/detekt/detekt.sarif` and `core/build/arch-rules-results.json`.
