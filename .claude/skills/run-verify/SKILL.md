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
`code-quality`. More come online phase by phase (doc 14).

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
`core/build/decision-trace-results.json`.

`code-quality` consumes detekt (SARIF, zero findings) + ArchUnit rule results (SPI boundary etc.),
both build-failing in Gradle; run `pnpm quality:jvm` before `pnpm verify` to produce
`core/build/reports/detekt/detekt.sarif` and `core/build/arch-rules-results.json`.
