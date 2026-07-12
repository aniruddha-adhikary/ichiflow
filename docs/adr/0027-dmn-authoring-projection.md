# 0027 — LLM-friendly DMN authoring projection (decision-table source → DMN 1.6 XML)

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/01-rule-engines.md](../research/01-rule-engines.md), [../research/07-ai-native-operations.md](../research/07-ai-native-operations.md)
- Relates to: [0001](0001-canonical-rule-representation-dmn.md) (DMN canonical), [0004](0004-declarative-flow-dsl-on-temporal.md) (Flow two-layer authoring), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md) (TypeSpec two-layer authoring), [0019](0019-ai-chat-first-authoring.md) (chat-first authoring)

## Context

DMN 1.6 XML is ichiflow's canonical, source-of-truth Decision representation ([0001](0001-canonical-rule-representation-dmn.md)) and stays so: it is the executed, exported, and interchange artifact that runs on any TCK-L3 engine, the anti-lock-in keystone. But DMN XML is genuinely **LLM-hostile to author directly** — verbose, positional, deep boxed-expression nesting, namespace ceremony — the *same* trait that disqualified BPMN XML as a Flow authoring surface ([0004](0004-declarative-flow-dsl-on-temporal.md) alternatives). Every other core artifact class was deliberately given an LLM-legible **canonical authoring projection that compiles one-way** to its hostile-but-portable executed form:

- **TypeSpec → OpenAPI/JSON Schema** ([0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)) — a ~500-line OpenAPI document is ~50 lines of TypeSpec.
- **typed flow builder / YAML → canonical Flow JSON** ([0004](0004-declarative-flow-dsl-on-temporal.md) amendment).

Decisions — "ichiflow's heart" — were the asymmetry: their canonical format was the one the framework itself calls LLM-hostile, with **no defined friendly projection**. The chat loop ([0019](0019-ai-chat-first-authoring.md)) proposed DMN and judged it via a read-only dmn-js render, and Doc 03 §5.3 gestured at "guided articulation … deterministically compiled to the canonical format," but the intermediate authoring form was never named or specified. An agent authoring a *new* rule therefore either emitted DMN XML directly (the hostile path rejected everywhere else) or relied on an undefined compile step.

## Decision

Adopt an **LLM-friendly canonical DMN authoring projection** — the **decision-table source**: a decision-table markdown/JSON form (crisp cells, FEEL expressions, hit-policy, DRD wiring as data) that **compiles deterministically one-way to DMN 1.6 XML**. This mirrors TypeSpec→OpenAPI and flow-builder→FlowJSON exactly:

1. **DMN 1.6 XML remains the executed / exported / interchange artifact** — nothing about portability, TCK-L3 execution, or the exit story changes. The decision-table source is an *authoring* surface, not a second executed representation, and **no round-trip is promised** (you do not regenerate the source from hand-edited DMN XML).
2. **The compile is deterministic and one-way**, checked in alongside the emitted DMN XML and covered by the regenerate-and-diff gate like every other two-layer artifact ([02](../architecture/02-schema-foundation.md) §4.3), so a reviewer diffs the source and its emitted DMN together.
3. **`authored-in` provenance extends to DecisionModels**: `dmn-xml | table-source | ai-chat` (mirroring a Flow's `code | yaml | ai-chat`). The canonical DMN XML is the governed/executed/audited artifact regardless of which surface produced it.
4. **Direct DMN XML authoring stays available** for developers and for imported/engine-bound models; spreadsheet import/export remains an interchange path into the source or the DMN. AI chat authors the decision-table source (or DMN) from conversation and the human judges via the read-only decision-table view + simulation ([0019](0019-ai-chat-first-authoring.md)).

This closes the Decision-layer authorability asymmetry and is squarely in the spirit of [0001](0001-canonical-rule-representation-dmn.md)/[0004](0004-declarative-flow-dsl-on-temporal.md): keep the portable canonical format as the executed artifact, put an LLM-legible projection in front of it.

## Alternatives considered

- **DMN XML as the only authored form (status quo).** Rejected: it is the one hostile-format asymmetry in an otherwise two-layer architecture; it degrades the highest-value LLM path (rule authoring by agents and business users).
- **Adopt GoRules JDM as the authoring form.** Clean JSON, best AI-authorability — but JDM is a *different execution model* with no DMN conformance ([0001](0001-canonical-rule-representation-dmn.md)); adopting it as the authoring source would blur the canonical/executed boundary and risk the projection being lossy against DMN semantics. JDM stays a *deployment projection* for the edge engine, not the authoring source. Rejected.
- **Chat-only, no named intermediate format.** Rejected: an undefined compile target is unreviewable and untestable; the whole point of the two-layer pattern is a diffable, validatable authored artifact, not an opaque chat-to-XML step.

## Consequences

Positive:
- Symmetry restored: Schemas, Flows, and now Decisions all have an LLM-legible canonical authoring projection with a deterministic one-way compile to a portable executed artifact.
- The highest-value LLM path (authoring rules) targets a crisp, validatable form instead of DMN XML.
- Portability/exit story is untouched — DMN 1.6 XML is still what executes and exports.

Negative / costs:
- ichiflow builds and maintains the **decision-table-source → DMN 1.6 XML compiler** and its schema — real engineering, and the compile must be deterministic (covered by regenerate-and-diff).
- A second authoring surface for Decisions adds `authored-in` bookkeeping and the discipline that DMN XML stays the sole canonical/executed artifact (no source↔XML round-trip, no persistent hand-DMN/source mix for one model).
- The projection must track FEEL/DMN construct coverage; constructs the source cannot express (deep inference, CEP) stay direct-DMN / engine-bound escape hatches ([03](../architecture/03-decision-layer.md) §4.3), and the source records what it does not cover.

## References

- Research 01 §5 (standards), §6 (LLM-authorability of FEEL/DMN tables)
- Research 07 §3.3 ("declare, don't code"; LLM-legible authoring surfaces)
- Doc 03 §2.6, §5.3 (decision-table source authoring), Doc 02 §1 (two-layer pattern)
- Related: [0001](0001-canonical-rule-representation-dmn.md), [0004](0004-declarative-flow-dsl-on-temporal.md), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md), [0019](0019-ai-chat-first-authoring.md)
