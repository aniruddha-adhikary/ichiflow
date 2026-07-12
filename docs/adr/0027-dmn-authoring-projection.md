# 0027 — LLM-friendly decision source projection (full DMN 1.6 → XML) + AI-authorable escape hatches

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/01-rule-engines.md](../research/01-rule-engines.md), [../research/07-ai-native-operations.md](../research/07-ai-native-operations.md)
- Relates to: [0001](0001-canonical-rule-representation-dmn.md) (DMN canonical), [0004](0004-declarative-flow-dsl-on-temporal.md) (Flow two-layer authoring), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md) (TypeSpec two-layer authoring), [0019](0019-ai-chat-first-authoring.md) (chat-first authoring), [0026](0026-harness-first-construction.md) (harness-first)

## Context

DMN 1.6 XML is ichiflow's canonical, source-of-truth Decision representation ([0001](0001-canonical-rule-representation-dmn.md)) and stays so: it is the executed, exported, and interchange artifact that runs on any TCK-L3 engine, the anti-lock-in keystone. But DMN XML is genuinely **LLM-hostile to author directly** — verbose, positional, deep boxed-expression nesting, namespace ceremony — the *same* trait that disqualified BPMN XML as a Flow authoring surface ([0004](0004-declarative-flow-dsl-on-temporal.md) alternatives). Every other core artifact class was deliberately given an LLM-legible **canonical authoring projection that compiles one-way** to its hostile-but-portable executed form:

- **TypeSpec → OpenAPI/JSON Schema** ([0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)) — a ~500-line OpenAPI document is ~50 lines of TypeSpec.
- **typed flow builder / YAML → canonical Flow JSON** ([0004](0004-declarative-flow-dsl-on-temporal.md) amendment).

Decisions — "ichiflow's heart" — were the asymmetry: their canonical format was the one the framework itself calls LLM-hostile, with **no defined friendly projection**. The chat loop ([0019](0019-ai-chat-first-authoring.md)) proposed DMN and judged it via a read-only dmn-js render, but the intermediate authoring form was never named or specified. An agent authoring a *new* rule therefore fell back to emitting DMN XML directly — the hostile path rejected everywhere else.

The **completeness bar is 100% AI coverage of the full Kogito/Drools capability surface**, not decision tables only. Decision tables are the most common shape, but a rule author (agent or business user) must be able to author **any** DMN construct, and any legitimate engine-native construct, without hand-writing XML. Anything reachable only by hand-writing DMN XML (or by hand-writing an opaque engine file) is a hole in the AI-native promise.

## Decision

Adopt an LLM-friendly canonical **decision source** projection — a structured markdown/YAML/JSON authoring form (FEEL expressions throughout) that expresses the **entire DMN 1.6 feature set** and **compiles deterministically one-way to DMN 1.6 XML**. This mirrors TypeSpec→OpenAPI and flow-builder→FlowJSON exactly, and it is **complete, not table-only**.

1. **Full-DMN coverage — no construct is XML-hand-authoring-only.** The decision source expresses:
   - **DRDs** — decision nodes, input-data nodes, business knowledge models (BKMs), knowledge sources, and their dependency wiring;
   - **all boxed-expression kinds** — decision tables (the common case), literal FEEL expressions, contexts, invocations, function definitions/BKMs, lists, and relations;
   - **item definitions / types** and imports.
   Decision tables are sugar for the most frequent shape; everything else in DMN 1.6 has a first-class projection form.
2. **DMN 1.6 XML remains the sole executed / exported / interchange artifact.** The decision source is an *authoring* surface, not a second executed representation, and **no round-trip is promised** (the source is not regenerated from hand-edited DMN XML). The compiled `.dmn` is checked in beside the source and covered by the regenerate-and-diff gate ([02](../architecture/02-schema-foundation.md) §4.3), so a reviewer diffs source and emitted DMN together.
3. **`authored-in` provenance extends to DecisionModels**: `decision-source | dmn-xml | drl | ai-chat` (mirroring a Flow's `code | yaml | ai-chat`). The canonical DMN XML (or, for an engine-native model, the engine-native text) is the governed/executed/audited artifact regardless of which surface produced it. Direct DMN XML authoring stays available for developers and for imported models.
4. **Completeness is a verified metric, not a claim — a projection-coverage harness** (harness-first, [0026](0026-harness-first-construction.md); [13](../architecture/13-agent-harness-loops.md) §2.b). A conformance suite enumerates every DMN 1.6 construct against the DMN spec feature matrix / TCK construct set and asserts, per construct: **(a)** a projection form exists, **(b)** it compiles to valid DMN 1.6 XML, and **(c)** the emitted XML executes identically on the default engine to a hand-authored reference. Coverage is an **enumerable count** (`constructs_covered / constructs_total`); "100% AI coverage of the DMN surface" is green on this suite, not a sentence in a doc.
5. **The engine-native escape hatches are first-class AI-authorable governed paths too** (amending [0001](0001-canonical-rule-representation-dmn.md)'s framing that they are *only* import sources / projections). **DRL rules, Drools rule units, and CEP** are text-based and therefore already LLM-legible; ichiflow makes them **authorable and testable by AI on the same footing as DMN**:
   - a **schema'd artifact wrapper** (declared input/output Schema contract + envelope), authorable via chat or directly;
   - **validated in `ichiflow verify`** (a DRL/rule-unit **compile-check** + the SPI `validate` where applicable);
   - **simulation / scenario-testable** with golden datasets, exactly like a DMN model (§6 of doc 03);
   - **trace-emitting** into the DecisionRecord;
   - **covered by `authored-in` provenance** (`drl | ai-chat`).
   The quarantine rules from [0001](0001-canonical-rule-representation-dmn.md) **stay** — engine-native artifacts are marked `portability: engine-bound`, carry the mandatory exportable-adapter contract + golden datasets, and count against the workspace portability score. But **"quarantined" governs *portability*, never *authorability*: AI can author, validate, simulate, and test an escape-hatch artifact like any other Decision.**

## Alternatives considered

- **Decision-tables-only projection.** The first cut of this ADR. Rejected on the founder amendment: it leaves DRDs, contexts, invocations, functions/BKMs, lists, relations, and item definitions reachable only by hand-writing DMN XML — a partial, not 100%, AI coverage of the decision surface.
- **DMN XML as the only authored form (status quo).** Rejected: it is the one hostile-format asymmetry in an otherwise two-layer architecture; it degrades the highest-value LLM path.
- **Adopt GoRules JDM as the authoring form.** JDM is a *different execution model* with no DMN conformance ([0001](0001-canonical-rule-representation-dmn.md)); adopting it as the authoring source would blur the canonical/executed boundary and cannot express full DMN. JDM stays a *deployment projection* for the edge engine. Rejected as the authoring source.
- **Leave escape hatches as import-only / hand-authored.** Rejected on the amendment: DRL/rule-units/CEP are text and thus LLM-legible; excluding them from AI authoring/testing would leave a governed capability an agent cannot touch, contradicting the AI-native mandate. Quarantine (portability) is orthogonal to authorability.

## Consequences

Positive:
- Symmetry restored *and* completeness guaranteed: every DMN construct and every governed engine-native construct is AI-authorable and AI-testable, verified by a coverage harness rather than asserted.
- Portability/exit story untouched — DMN 1.6 XML is still what executes and exports; engine-native artifacts keep their quarantine + export-adapter discipline.
- The highest-value LLM path (authoring and testing rules, DMN *and* escape-hatch) targets crisp, validatable forms instead of raw XML/opaque engine files.

Negative / costs:
- ichiflow builds and maintains the **decision-source → DMN 1.6 XML compiler across the full DMN feature set**, its schema, **and the projection-coverage harness** — real, ongoing engineering; the compile must be deterministic (regenerate-and-diff) and the harness must track DMN-spec evolution.
- Making DRL/rule-units/CEP first-class authoring paths adds schema'd wrappers, compile-check tooling in `verify`, and scenario/simulation plumbing for engine-native artifacts — more surface than "import only."
- Second authoring surfaces for Decisions add `authored-in` bookkeeping and the discipline that the executed artifact (DMN XML, or engine-native text) stays canonical (no source↔XML round-trip; no persistent hand-DMN/source mix for one model).

## References

- Research 01 §3 (Drools/Kogito capability surface: DMN, DRL, rule units, CEP), §5 (standards), §6 (LLM-authorability), §7 (interchange caveats)
- Research 07 §3.3 ("declare, don't code"; LLM-legible authoring surfaces)
- Doc 03 §2.1–§2.2, §2.6 (decision source), §4.3 (AI-authorable escape hatches), §5.3, §8 (CEP); Doc 13 §2.b (projection-coverage harness); Doc 02 §1 (two-layer pattern)
- Related: [0001](0001-canonical-rule-representation-dmn.md), [0004](0004-declarative-flow-dsl-on-temporal.md), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md), [0019](0019-ai-chat-first-authoring.md), [0026](0026-harness-first-construction.md)
