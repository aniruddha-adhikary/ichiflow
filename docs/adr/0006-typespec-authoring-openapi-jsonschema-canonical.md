# 0006 — TypeSpec authoring; emitted OpenAPI 3.1 / JSON Schema 2020-12 are the contract of record

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/03-schema-and-types.md](../research/03-schema-and-types.md)

## Context

ichiflow is schema-centric: TS and Kotlin types, runtime validators on both sides of every adapter
boundary, the UI generator, docs, and the schema registry must all descend from **one source** with no
drift (research 03 R1–R6). There is an apparent tension between "author in TypeSpec" and "JSON Schema
is canonical." Research 03 §3.3 resolves it with a **two-layer contract architecture** and rejects
Zod-first (lossy projection to Kotlin), Kotlin-first (contract trails implementation), and raw-OpenAPI
(worst authoring/LLM ergonomics).

## Decision

**Two-layer schema strategy:**

1. **Authoring layer — TypeSpec** (`@typespec/compiler`, `http`, `openapi3`, `json-schema`,
   `versioning`; ~1.13.x). Humans and LLM agents write contracts in TypeSpec's concise TS-like DSL —
   the most LLM-legible IDL (≈10x more compact than equivalent OpenAPI YAML), with first-class
   `@discriminated` unions and a real versioning story (`@added`/`@removed`/`@renamedFrom` project one
   source into N spec versions).
2. **Canonical artifact layer — emitted OpenAPI 3.1 + JSON Schema 2020-12**, plus **AsyncAPI 3.1** for
   message contracts (`$ref` the shared JSON Schema components). These emitted, deterministic documents
   are **checked into the repo and are the contract of record** every downstream consumer reads.

Because nothing downstream depends on TypeSpec directly, **TypeSpec is swappable** — any tool (or
TypeSpec itself) can be replaced without breaking consumers (research 03 §1, risk 1). Codegen: **Fabrikt**
(Kotlin), **hey-api (pinned) or orval** (TS, emitting Zod v4). Runtime validation from the *same* JSON
Schema at every boundary: Ajv/TypeBox (TS), OptimumCode (KMP) / networknt (JVM) on Kotlin. Registry:
**Apicurio 3.3**, event schemas at **FULL_TRANSITIVE**; **oasdiff**-style breaking-change gates in CI.
Generated code is checked in with a regenerate-and-`git diff --exit-code` gate.

## Alternatives considered

- **Zod-first (author Zod v4 in TS, project to JSON Schema, generate Kotlin).** Zero-friction for TS
  devs and the validator *is* the schema on the TS side. **Rejected as source:** `z.transform`,
  refinements, and custom checks **do not survive projection to JSON Schema**, so Kotlin silently
  under-enforces — drift by construction — plus TS-centric politics in a two-language org (research 03
  §3.3). Zod is retained only as *generated* TS output.
- **Kotlin-first (annotations / kotlinx-schema → OpenAPI).** Server team never leaves Kotlin, but the
  contract *trails* the implementation (implementation-first, not API-first, violating R2) and TS
  becomes second-class (research 03 §3.3). Rejected.
- **Raw OpenAPI YAML-first.** No extra layer, maximal tool compat, but verbose, error-prone, no
  versioning projection, painful diffs, worst human/LLM authoring ergonomics at scale (research 03
  §3.3). Rejected.
- **Protobuf/gRPC or GraphQL or Smithy as the backbone.** Protobuf: best wire evolution but weak
  validation vocabulary, gRPC-first posture conflicts with API-first-over-HTTP (kept as a later option
  for hot internal RPC). GraphQL: great aggregation layer, weak as a cross-language contract IDL
  (optional future BFF). Smithy: good modeling but TS generators are Developer Preview and thin LLM
  training data (research 03 §3.2). All rejected as the contract source.

## Consequences

Positive:
- Single source, no drift: types + validators in both languages descend from one artifact; docs can
  never describe a different API than ships (research 03 §7).
- Best LLM authoring surface (TypeSpec) + best interchange/LLM-tool-schema format (JSON Schema) at once.
- Emitted specs `$ref`-shared across REST, events, Flow/rule payloads — one schema feeds API, events,
  workflow state, rules, and adapters.

Negative / costs:
- **Extra compile step**, and **AsyncAPI must be hand-authored** — there is no first-party
  TypeSpec→AsyncAPI emitter, so event *documents* are hand-written even though their payload schemas
  are shared by `$ref` (research 03 §3.2, risk 7).
- **TypeSpec's ecosystem is a fraction of raw-OpenAPI's**; some advanced OAS constructs need the
  `@extension` escape hatch (research 03 risk 1). Client/server code emitters remain preview — hence
  codegen runs from emitted OpenAPI, not TypeSpec directly.
- **hey-api is 0.x with frequent breaking changes** — must be pinned exactly; orval 8 is the validated
  drop-in (research 03 risk 2). Fabrikt is community-scale (research 03 risk 9).
- Kotlin JSON Schema validators are less battle-hardened than Ajv — mitigated by a shared cross-language
  conformance suite run against both (research 03 risk 10).
- **Avoid-list applies:** `openapi-fetch`/`openapi-react-query` are in maintenance mode; do not build
  runtime clients on them ([0016](0016-license-hygiene-policy.md)). Do not design around Stainless
  (wound down post-Anthropic acquisition) — Speakeasy is the commercial SDK fallback.

## References

- Research 03 §1 (two-layer summary), §3 (IDL comparison), §4 (codegen), §6 (registry/evolution), §10 (risks)
- TypeSpec — https://typespec.io/ · Fabrikt — https://github.com/fabrikt-io/fabrikt · Apicurio — https://www.apicur.io/registry/
- Related: [0004](0004-declarative-flow-dsl-on-temporal.md), [0007](0007-kotlin-core-typescript-edges.md), [0008](0008-jsonforms-model-ui-overrides.md), [0016](0016-license-hygiene-policy.md)
