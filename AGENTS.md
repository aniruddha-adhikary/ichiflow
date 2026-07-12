# AGENTS.md — building ichiflow

ichiflow is built **harness-first** (ADR-0026, docs 13 & 14): every subsystem ships a
deterministic verification harness **before** its implementation. You do not claim a unit is done —
you run `ichiflow verify` and read the JSON verdict.

## The one loop

```
edit an artifact → ichiflow verify --scope <subsystem|artifact> --json → read the verdict → iterate
```

- **Verdicts are JSON, never prose.** Done-ness is an enumerable count over a suite of checks
  (`passed/total`), not a narrated claim (doc 13 §1.2).
- **Flake policy is retry-forbidden** (doc 13 §3.6). A check that passes on retry is a harness
  defect — fix the determinism (seed time/data), never re-run to clear.
- **Harness-first.** Write the harness (scope + checks) red first; turn it green with the
  implementation. A new step type / schema / adapter ships its vectors first.

## Commands

| Command                                 | What it does                                                           |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm install`                          | Install the TS workspace.                                              |
| `pnpm build`                            | Build every workspace package.                                         |
| `pnpm --filter @ichiflow/schemas build` | Emit canonical JSON Schema from TypeSpec sources.                      |
| `pnpm verify --scope self-check --json` | Run the meta-harness (the harness that judges harnesses).              |
| `pnpm verify --json`                    | Full verify — every registered scope (CI's loop).                      |
| `pnpm spike:jvm`                        | Produce the JVM (networknt) fidelity-spike verdicts.                   |
| `pnpm vectors:jvm`                      | Produce the JVM (networknt) contract-vector verdicts.                  |
| `pnpm decision:jvm`                     | Compile decision-source → DMN 1.6 and execute on KIE/Drools.           |
| `pnpm decision-tck:jvm`                 | Run the DMN-TCK subset on the Decision Engine SPI (Drools).            |
| `pnpm quality:jvm`                      | Produce detekt (SARIF) + ArchUnit rule-result artifacts.               |
| `pnpm codegen:ts` / `codegen:drift`     | Regenerate / drift-check the TS contract types (hey-api).              |
| `(cd core && ./gradlew generateModels)` | Regenerate the Kotlin contract models (Fabrikt).                       |
| `pnpm contract:diff`                    | Run oasdiff → write the breaking-change results `contract-gate` reads. |
| `pnpm contract:accept`                  | Accept an intentional contract change (advance the baseline).          |
| `pnpm license:check`                    | License-allowlist gate (ADR-0016).                                     |
| `(cd core && ./gradlew build)`          | Build + test the Kotlin core (incl. model drift gate).                 |

Registered scopes: `self-check`, `agent-kit`, `schema-fidelity-spike`, `schema-pipeline`, `codegen`, `contract-vectors`, `reference-data`, `decision-projection-spike`, `contract-gate`, `decision-layer`, `code-quality`.
`schema-fidelity-spike` runs a hard JSON Schema probe corpus through **two** validators — Ajv (TS)
and networknt (JVM) — and requires them to agree; run `pnpm spike:jvm` first to produce the JVM
verdicts it cross-checks. `schema-pipeline` guards the emitted contract artifacts (OpenAPI 3.1 +
JSON Schema 2020-12) authored once in TypeSpec. `codegen` asserts the generated edges — TypeScript
types (hey-api) and Kotlin models (Fabrikt) — cover every OpenAPI component schema; byte-level
reproducibility is gated by `pnpm codegen:drift` (TS) and `./gradlew checkModelsUpToDate` (Kotlin).
`contract-vectors` runs a real-contract validation corpus through the same two validators (Ajv +
networknt) and requires agreement; run `pnpm vectors:jvm` first to produce the JVM verdicts.
`reference-data` validates the committed CodeSet fixtures against the emitted `CodeSet` contract and
enforces cross-CodeSet `codeRef` referential integrity — every reference must resolve to a live row
whose effective window covers the referencing row's (bitemporal, ADR-0025 / doc 02 §9.4).
`decision-projection-spike` compiles the `decision-source` fixture to DMN 1.6 and executes it and a
hand-authored reference on Apache KIE / Drools (pinned 10.2.0), asserting identical results across
every input vector — the Phase 2.0 proof that the hard boxed-expression kinds (BKM FEEL functions,
boxed contexts, invocations) project and execute correctly; run `pnpm decision:jvm` first.
`contract-gate` fails on any **breaking** change to the emitted OpenAPI vs the released baseline
(`schemas/contract/openapi.baseline.yaml`): run `pnpm contract:diff` first (it runs oasdiff and
writes the git-ignored `.ichiflow/contract-diff.json` the scope reads). When a breaking change is
**intentional and reviewed**, run `pnpm contract:accept` to advance the baseline over the emitted
OpenAPI, then commit the updated baseline — that commit is the record of the accepted contract change.
`decision-layer` runs a curated **DMN-TCK subset** (decision tables with UNIQUE hit policy, FEEL
built-in functions, BKM + invocation + boxed context) through the **Decision Engine SPI** reference
engine (Drools) and asserts `tck_cases_green == total` plus the engine's **capability descriptor** —
the Phase 2.1 proof that a capability-declared, engine-neutral SPI executes canonical DMN 1.6; run
`pnpm decision-tck:jvm` first. `code-quality` is the non-negotiable Kotlin quality gate: it consumes
**detekt** (zero findings, from SARIF) and **ArchUnit** rule results (notably the SPI boundary — only
`…decision.spi` may depend on `org.kie..`), both of which also fail `./gradlew check`/`test`; run
`pnpm quality:jvm` first.

## Layout

- `schemas/` — TypeSpec authoring; emitted JSON Schema + OpenAPI 3.1 in `schemas/generated/` are the contract of record.
- `packages/cli/` — the `ichiflow` CLI and the verify harness engine.
- `packages/contracts-ts/` — generated TypeScript contract types (hey-api) in `src/gen/`; regenerate, never hand-edit.
- `core/` — the Kotlin core (Gradle); generated contract models (Fabrikt) in `core/generated/`.
- `.claude/` — skills and the scoped-verify hook (the guaranteed-execution layer, doc 10 §2.2).
- `.ichiflow/resources.manifest.yaml` — version pins + named resources (doc 10 §2.5).

## Rules

- Never edit files under any `generated/` directory by hand — regenerate and commit (drift check gates this).
- Add a new verify scope by registering it in `packages/cli/src/verify/registry.ts` with its checks.
- Keep every dependency on the license allowlist (`tools/license-check/allowlist.json`).
- Kotlin quality is non-negotiable: **detekt** (config `core/config/detekt/detekt.yml`) and **ArchUnit**
  (`core/src/test/kotlin/ai/ichiflow/core/architecture/`) fail `./gradlew build`. Fix findings —
  don't relax rules to pass. Only the `…decision.spi` package may depend on `org.kie..`/`org.drools..`.
