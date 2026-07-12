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

`self-check` (the meta-harness), `agent-kit`, `schema-fidelity-spike`, `schema-pipeline`,
`contract-gate`. More come online phase by phase (doc 14).

`schema-fidelity-spike` cross-checks Ajv (TS) against networknt (JVM) on a hard probe corpus, so it
needs the JVM verdicts on disk first: run `pnpm spike:jvm` before `pnpm verify` (or the full loop).

`schema-pipeline` validates the committed OpenAPI 3.1 + JSON Schema 2020-12 artifacts (existence,
`$ref` integrity, canonical-model reuse). Byte-level drift is a separate gate: `pnpm schema:drift`.

`contract-gate` asserts **zero breaking changes** in the emitted OpenAPI vs the released baseline
(`schemas/contract/openapi.baseline.yaml`), using oasdiff. It reads the git-ignored results file
`.ichiflow/contract-diff.json`, so run `pnpm contract:diff` first (like `pnpm spike:jvm` for the
fidelity spike). To **accept** an intentional breaking change: run `pnpm contract:accept` (copies the
emitted OpenAPI over the baseline) and commit the updated baseline — that commit is the record of the
deliberate contract change.
