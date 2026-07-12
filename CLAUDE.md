# CLAUDE.md

See [AGENTS.md](AGENTS.md) for the full build doctrine. Claude Code specifics:

- The `PostToolUse` hook in `.claude/settings.json` runs a **scoped** `ichiflow verify` after you
  write a file, so you get an immediate verdict on what you changed without waiting for CI.
- Skills live in `.claude/skills/`:
  - **run-verify** — run `ichiflow verify` and read the JSON verdict.
  - **add-schema** — author a new canonical type in TypeSpec and regenerate.
- **Never mark work done on a prose claim.** The verdict of record is the JSON envelope from
  `ichiflow verify`. If a scope is red, it is not done, regardless of how finished it looks.
- Determinism is mandatory (retry-forbidden, doc 13 §3.6): seed time/data, never depend on
  wall-clock or RNG inside a harness.
