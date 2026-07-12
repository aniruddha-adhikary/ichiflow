# 0007 — Kotlin core, TypeScript edges; types generated on both sides from one schema

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md), [../research/03-schema-and-types.md](../research/03-schema-and-types.md)

## Context

ichiflow is polyglot by design. It needs JVM strength where the rules engine (Drools/Apache KIE,
[0002](0002-pluggable-decision-engine-spi-drools-default.md)) and heavy enterprise integration
(Apache Camel, [0012](0012-postgresql-first-storage-spis.md)/adapters) live, and TypeScript strength at
the UI/portal/BFF/CLI edges where the ecosystem (JSON Forms, hey-api, Better Auth) is strongest. The
non-negotiable constraint is **no type drift** between the two languages.

## Decision

Split the stack by language:

- **Kotlin core** — decision evaluation (Drools/KIE via the SPI), Temporal **activity workers** for
  rule-eval and core domain services, and the core domain services themselves. Kotlin calls KIE APIs
  directly and is Quarkus-native (research 01 §3.1).
- **TypeScript edges** — portals/UI + BFFs, CLI/tooling, and integration activities.

**Types on both sides are generated from one schema source** — the emitted OpenAPI 3.1 / JSON Schema
2020-12 from [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md): Fabrikt for Kotlin,
hey-api/orval for TS, Modelina for event models. Runtime validators (OptimumCode/networknt on Kotlin,
Ajv/TypeBox/Zod on TS) descend from the same artifact, so drift is caught in CI.

Temporal task-queue routing carries the split: Kotlin rule-eval activities on one queue, TS integration
activities on another, orchestrated by the interpreter workflow ([0004](0004-declarative-flow-dsl-on-temporal.md)).

### Temporal Kotlin caveat (important)

Temporal has **no first-class Kotlin SDK**: Kotlin is served via the Java SDK's `temporal-kotlin`
extension (idiomatic sugar over the Java SDK), and the community `temporal-kt` is early/unstable
(research 02 §1, §3). Workflow code must be deterministic; Kotlin's extension is fine but not
first-class. **Mitigation:** confine Kotlin to **activity workers**, which have *no* determinism
constraints, and run the deterministic **interpreter workflow in TypeScript** (research 02 §1, §5).

> Consistency note: the brief §4 lists "flow workers" under Kotlin core. Research 02 recommends the
> Temporal *interpreter/orchestration* workflow be TypeScript and Kotlin be confined to activities.
> This ADR follows the research (TS interpreter, Kotlin activities) and flags the divergence; the
> brief's intent (Kotlin does the rule-eval/domain work inside flows) is preserved because that work
> runs as Kotlin activity workers.

## Alternatives considered

- **Single-language stack (all Kotlin, or all TypeScript).** All-Kotlin loses the TS-edge ecosystem
  (JSON Forms override model [0008](0008-jsonforms-model-ui-overrides.md), hey-api, Better Auth) and
  makes Temporal's mature TS SDK unused; all-TS loses direct KIE/Drools access and Camel's connector
  breadth. Rejected: neither language is strong across both core and edge (research 01 §4, 03 §4).
- **Kotlin for Temporal orchestration (workflow code in Kotlin).** Tempting given the Kotlin core, but
  Temporal Kotlin is a Java-SDK extension, not first-class, and workflow code carries the determinism
  burden (research 02 §1). Rejected for orchestration; Kotlin stays in activities.
- **Community `temporal-kt` wrapper.** Early/unstable (research 02 §1). Watch, don't depend on it.
- **Hand-maintained parallel type definitions per language.** Rejected outright — reintroduces the drift
  [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md) exists to prevent (research 03 §6.1).

## Consequences

Positive:
- Each language does what it is best at; the rules engine and heavy integration stay on the JVM, the
  UI/portal/agent-facing surfaces stay in TS.
- One schema source + generated types + shared JSON Schema validation makes cross-language drift a CI
  failure, not a runtime surprise.

Negative / costs:
- **Polyglot ops and cognitive surface**: two toolchains, two validator stacks, two codegen paths to
  keep pinned and green (research 03 risks 2, 9, 10).
- **Temporal Kotlin is second-class** — the architecture must keep Kotlin out of workflow code; teams
  that want to write flows in Kotlin cannot, which is a real ergonomic constraint and a deviation from a
  naive reading of the brief.
- Fabrikt (Kotlin codegen) is community-scale; openapi-generator is the emergency fallback (research 03
  risk 9).
- Cross-language conformance testing of validators is ongoing work (research 03 risk 10).

## References

- Research 02 §1, §3 (Temporal SDKs; Kotlin via Java SDK extension), §5 (TS interpreter workflow)
- Research 03 §4 (Fabrikt/hey-api/orval codegen), §6.1 (no-drift ranking)
- temporal-kotlin — https://mvnrepository.com/artifact/io.temporal/temporal-kotlin
- Related: [0002](0002-pluggable-decision-engine-spi-drools-default.md), [0003](0003-temporal-durable-execution-substrate.md), [0004](0004-declarative-flow-dsl-on-temporal.md), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)
