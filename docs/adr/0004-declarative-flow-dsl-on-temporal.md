# 0004 — Declarative Flow DSL (CNCF-Serverless-Workflow-aligned) interpreted on Temporal

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md)

## Context

[0003](0003-temporal-durable-execution-substrate.md) adopts Temporal, whose native authoring surface is
workflow *code*. But ichiflow is schema-centric, declarative-first, and AI-native: business users must
read/diff flows, migration-out demands a portable definition, and LLM agents should author a
constrained, schema-validated artifact rather than free-form workflow code. Research 02 §2 shows
code-first engines are weak on business-user comprehension and interchange out of the box, while a
declarative DSL layer closes most of that gap. Research 02 §5 establishes that layering a declarative
DSL on Temporal is an **established, de-risked pattern** — CNCF Serverless Workflow, Temporal's own
DSL sample, and Zigflow (2026) all prove it works.

## Decision

Ship a **declarative Flow definition (JSON/YAML, CNCF-Serverless-Workflow-aligned, schema'd)** as
ichiflow's authoring surface, interpreted by a **single deterministic interpreter workflow running on
Temporal**. The interpreter (research 02 §5):

1. loads a versioned ichiflow Flow document (CNCF-SWF-aligned + DMN-like decision nodes that call the
   Decision Engine SPI activities from [0002](0002-pluggable-decision-engine-spi-drools-default.md)),
2. walks the graph, invoking activities on the correct task queue (Kotlin rule-eval vs TS integration),
3. treats **manual-review nodes** as "await signal with SLA timer → escalate"
   ([0005](0005-first-party-case-and-human-task-module.md)).

Alignment with **CNCF Serverless Workflow** buys portability (the migration-out hedge against
"proprietary Temporal code"). The interpreter pins its DSL-schema version with Temporal's `patched()`
so long-running instances keep replaying against the schema they started on. Flow documents are
authored/validated against JSON Schema ([0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)),
so an LLM authors a constrained, checkable artifact — not opaque code.

## Alternatives considered

- **Raw Temporal SDK, code-first only.** Maximum flexibility and best for engineers, and LLMs write
  TS/Kotlin well (research 02 §2). Rejected as the *primary* surface: workflow code is opaque to
  business analysts, is proprietary (weak migration-out), and gives an LLM an unconstrained,
  hard-to-validate authoring target. Raw SDK remains available as an escape hatch for genuinely
  code-shaped flows, but the DSL is the default and the product surface.
- **BPMN-first (adopt a BPMN engine / BPMN as the authoring model).** BPMN 2.0 XML is a genuine
  cross-vendor interchange standard and the diagram *is* the analyst/engineer shared artifact
  (research 02 §2). Rejected: it means adopting a BPMN engine (Camunda 8 licensing / Flowable JVM-only
  authoring — [0003](0003-temporal-durable-execution-substrate.md)), and LLMs emit BPMN XML poorly
  (verbose, positional diagram coordinates, error-prone, hard to validate vs typed/declarative JSON).
  Layering a CNCF-SWF DSL on Temporal captures BPMN's comprehension/interchange benefits without a BPMN
  engine.
- **Netflix Conductor / Orkes (ready-made JSON DSL over a durable engine).** Would give the declarative
  surface for free (research 02 §5). Rejected in [0003](0003-temporal-durable-execution-substrate.md)
  in favor of controlling the flow model and reusing Temporal's replay/versioning; noted as the
  credible alternative had ichiflow preferred not to build a DSL.
- **Invent a bespoke, non-standard DSL.** Rejected: CNCF-SWF alignment is a deliberate anti-lock-in
  choice (portable definitions), consistent with [0001](0001-canonical-rule-representation-dmn.md)'s
  format-over-engine philosophy.

## Consequences

Positive:
- Business users read/diff Flow documents (comprehension + audit); documents are portable (migration
  hedge); the interpreter is a normal Temporal workflow (durability, replay, safe versioning).
- **Safer AI authoring:** the agent produces schema-validated Flow documents, not free-form code
  ([0015](0015-first-party-mcp-server-and-agent-kit.md)).
- Decision nodes call the SPI, so Flows and Decisions compose cleanly and share the DecisionRecord
  ([0011](0011-decisionrecord-and-selective-event-sourcing.md)).

Negative / costs:
- **ichiflow builds and maintains an interpreter + DSL schema + validation** — real engineering, and
  the interpreter must stay deterministic under replay (any non-determinism is a correctness bug).
- CNCF Serverless Workflow is a young spec; ichiflow-specific decision/manual-review node types are
  extensions that are not guaranteed to round-trip to other SWF runtimes — the portability promise is
  "the standard core is portable; ichiflow extensions are documented," not "runs anywhere unchanged."
- A DSL layer is less expressive than raw code; genuinely code-shaped flows must use the escape hatch,
  splitting the mental model across two surfaces.
- DSL-schema versioning must be pinned per-instance via `patched()`, adding lifecycle complexity for
  months-long cases.

## References

- Research 02 §2 (paradigm analysis), §5 (declarative-DSL-over-durable-engine prior art)
- CNCF Serverless Workflow — https://serverlessworkflow.io/ · Zigflow — https://zigflow.dev/articles/why-i-built-a-yaml-dsl-for-temporal-workflows/
- Related: [0003](0003-temporal-durable-execution-substrate.md), [0005](0005-first-party-case-and-human-task-module.md), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)
