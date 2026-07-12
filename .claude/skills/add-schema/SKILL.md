---
name: add-schema
description: Author a new canonical type in TypeSpec and regenerate the JSON Schema contract of record. Use when adding or changing any schema.
---

# add-schema

TypeSpec is the authoring source; the emitted JSON Schema in `schemas/generated/` is the contract
of record (ADR-0006). Never hand-edit generated files.

## Steps

1. Add or edit a `.tsp` file under `schemas/` (import it from `schemas/main.tsp` if new).
   - Decorate a namespace with `@jsonSchema` so its models emit.
   - Use `@minValue`/`@maxValue`/`@format` etc. so validators agree cross-language.
2. Regenerate:
   ```
   pnpm --filter @ichiflow/schemas build
   ```
3. Verify no drift and that consumers still validate:
   ```
   pnpm --filter @ichiflow/schemas drift
   pnpm verify --json
   ```
4. Commit both the `.tsp` source **and** the regenerated `schemas/generated/**` output together.
   The drift check (regenerate-and-diff, doc 02 §4.3) fails CI if they diverge.
