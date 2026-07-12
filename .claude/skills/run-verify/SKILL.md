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

`self-check` (the meta-harness), `agent-kit`. More come online phase by phase (doc 14).
