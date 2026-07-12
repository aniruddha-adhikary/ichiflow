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

| Command                                 | What it does                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm install`                          | Install the TS workspace.                                                        |
| `pnpm build`                            | Build every workspace package.                                                   |
| `pnpm --filter @ichiflow/schemas build` | Emit canonical JSON Schema from TypeSpec sources.                                |
| `pnpm verify --scope self-check --json` | Run the meta-harness (the harness that judges harnesses).                        |
| `pnpm verify --json`                    | Full verify — every registered scope (CI's loop).                                |
| `pnpm spike:jvm`                        | Produce the JVM (networknt) fidelity-spike verdicts.                             |
| `pnpm contract:diff`                    | Run oasdiff → write the breaking-change results the `contract-gate` scope reads. |
| `pnpm contract:accept`                  | Accept an intentional contract change (advance the baseline).                    |
| `pnpm license:check`                    | License-allowlist gate (ADR-0016).                                               |
| `(cd core && ./gradlew build)`          | Build + test the Kotlin core.                                                    |

Registered scopes: `self-check`, `agent-kit`, `schema-fidelity-spike`, `schema-pipeline`,
`contract-gate`.
`schema-fidelity-spike` runs a hard JSON Schema probe corpus through **two** validators — Ajv (TS)
and networknt (JVM) — and requires them to agree; run `pnpm spike:jvm` first to produce the JVM
verdicts it cross-checks. `schema-pipeline` guards the emitted contract artifacts (OpenAPI 3.1 +
JSON Schema 2020-12) authored once in TypeSpec. `contract-gate` fails on any **breaking** change to
the emitted OpenAPI vs the released baseline (`schemas/contract/openapi.baseline.yaml`): run
`pnpm contract:diff` first (it runs oasdiff and writes the git-ignored `.ichiflow/contract-diff.json`
the scope reads). When a breaking change is **intentional and reviewed**, run `pnpm contract:accept`
to advance the baseline over the emitted OpenAPI, then commit the updated baseline — that commit is
the record of the accepted contract change.

## Layout

- `schemas/` — TypeSpec authoring; emitted JSON Schema + OpenAPI 3.1 in `schemas/generated/` are the contract of record.
- `packages/cli/` — the `ichiflow` CLI and the verify harness engine.
- `core/` — the Kotlin core (Gradle).
- `.claude/` — skills and the scoped-verify hook (the guaranteed-execution layer, doc 10 §2.2).
- `.ichiflow/resources.manifest.yaml` — version pins + named resources (doc 10 §2.5).

## Rules

- Never edit files under any `generated/` directory by hand — regenerate and commit (drift check gates this).
- Add a new verify scope by registering it in `packages/cli/src/verify/registry.ts` with its checks.
- Keep every dependency on the license allowlist (`tools/license-check/allowlist.json`).
