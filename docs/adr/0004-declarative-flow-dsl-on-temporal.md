# 0004 — Declarative Flow DSL (CNCF-Serverless-Workflow-aligned) interpreted on Temporal

- Status: accepted (amended 2026-07-12)
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md)
- Amendment basis: design review 2026-07 (declarative-boundary critique)

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

## Amendment (2026-07-12) — first-class `compute` step + typed flow builder

Two changes to the flow model, adopted from the design review:

1. **A first-class `compute` step type.** Alongside `decision-eval` and `adapter-call`, the DSL gains
   a `compute` step: a typed Kotlin/TS **code activity** referenced by versioned `ref`
   (`<lang>://<module>/<Name>@<version>`), schema'd at its input/output boundary, unit-testable,
   stub-able in scenario tests, and **trace-emitting** into the DecisionRecord. It is the *same*
   unified code-activity contract as a Decision feature-function
   ([03](../architecture/03-decision-layer.md) §2.4) and an Adapter code-transform
   ([05](../architecture/05-adapters.md) §1). This keeps the flow graph declarative while moving
   genuine computation (inter-step data reshaping, loop accumulation, computed branch sets,
   state-deriving recovery) off inline FEEL/JSONata and into typed code that stays on the audit spine.
   Consequently the **raw-Temporal-SDK escape hatch recedes to a last resort** for genuinely
   code-shaped *orchestration* only; the step-level `compute` activity is the common hatch, so the
   audit spine is never abandoned to drop one computation to code.
2. **A typed TS/Kotlin flow builder as a first-class authoring surface.** Steps, guards, and event
   listeners may be authored as pure typed code that compiles **one-way** to the canonical Flow JSON —
   exactly the TypeSpec→OpenAPI two-layer pattern. The **canonical JSON remains the sole executed,
   audited, and exported artifact**; code-authored flows carry `authored-in: code` provenance (`yaml`
   and `ai-chat` are the other values). No round-trip is promised: simple flows may still be authored
   as YAML directly, and the builder never becomes a second canonical representation.

**Why plain-code-only lost:** raw workflow code is opaque to business analysts, weak for
migration-out (proprietary), and an unconstrained/hard-to-validate LLM target — the original rejection
of "raw SDK as the primary surface" stands. **Why YAML-only lost:** hand-YAML is excellent for the job
graph but degrades into a badly-reimplemented programming language once it must express computation or
when an engineer wants IDE refactoring, compile-time step-wiring checks, and host-language loops to
*generate* the graph. The resolution keeps canonical JSON primary (business-user-readable, portable,
governed) while admitting typed code where it is genuinely more legible — the `compute` step for
computation, the builder as a one-way authoring convenience — with a single code-activity contract
unifying every hatch.

## Alternatives considered

- **Raw Temporal SDK, code-first only.** Maximum flexibility and best for engineers, and LLMs write
  TS/Kotlin well (research 02 §2). Rejected as the *primary* surface: workflow code is opaque to
  business analysts, is proprietary (weak migration-out), and gives an LLM an unconstrained,
  hard-to-validate authoring target. Raw SDK remains available as a **last-resort** escape hatch for
  genuinely code-shaped *orchestration* only; per the amendment above, step-level computation now uses
  the `compute` code-activity step, and engineers who want a typed authoring experience use the
  one-way flow builder — so the DSL/canonical-JSON is the default and the product surface.
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
- A DSL layer is less expressive than raw code; the `compute` step (amendment) absorbs most of the
  gap by admitting typed code *within* the declarative graph, leaving only genuinely code-shaped
  *orchestration* for the last-resort raw-SDK hatch.
- The typed flow builder (amendment) adds a second **authoring** surface (compiling one-way to
  canonical JSON); the discipline that keeps this safe is that JSON stays the sole canonical artifact
  and no round-trip is promised — a hand-YAML/builder *mix* for one flow is disallowed.
- DSL-schema versioning must be pinned per-instance via `patched()`, adding lifecycle complexity for
  months-long cases.

## References

- Research 02 §2 (paradigm analysis), §5 (declarative-DSL-over-durable-engine prior art)
- CNCF Serverless Workflow — https://serverlessworkflow.io/ · Zigflow — https://zigflow.dev/articles/why-i-built-a-yaml-dsl-for-temporal-workflows/
- Related: [0003](0003-temporal-durable-execution-substrate.md), [0005](0005-first-party-case-and-human-task-module.md), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)
- Related: [0027](0027-dmn-authoring-projection.md) applies this same one-way-projection pattern to
  Decisions (the **decision source** → DMN 1.6 XML); Doc 04 §2.7 adds **extension Flow step types**
  (`x-<org>/<stepType>`) as a declared seam over the closed canonical step-type set, and Doc 04 §2.6
  declares the **code-activity worker SPI** (Kotlin/TS v1; Python expected first post-v1).
