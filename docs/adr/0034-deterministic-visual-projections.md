# 0034 — Deterministic visual projections; viewhints as a separate layout overlay

- Status: accepted
- Date: 2026-07-13
- Deciders: ichiflow architecture
- Basis: founder requirement 2026-07 — "the ability to visualize the workflows and how they all connect together as a human so I understand what's up; also AI-friendly; both human and AI friendly; deterministic guidance + freedom" (inspiration: the Superpowers visual companion)
- Research: [../research/07-ai-native-operations.md](../research/07-ai-native-operations.md) (agent-legible artifacts, live-preview loop), [../research/03-schema-and-types.md](../research/03-schema-and-types.md) (independent data/UI-schema model). Current-facts verified July 2026 (WebSearch), cited in [15-visualization.md](../architecture/15-visualization.md) Sources.

## Context

ichiflow's authoring doctrine ([ADR-0019](0019-ai-chat-first-authoring.md)) already makes previews
**read-only projections rendered from canonical artifacts**, and the LLM-only-v1 cut
([ADR-0024](0024-llm-only-internal-surfaces-v1.md)) makes an `ichiflow preview` URL the human's
judgement surface for internal work. What was undecided: **how** ichiflow visualizes a whole
Workspace — the flows, the decisions, and *how they all connect together* — for a human, while
keeping the *same* views directly consumable by AI agents, and doing so **deterministically** (a
BRIEF-level requirement that previews be reproducible). Two sub-questions needed settling: (1) the
**format** of the projection (a picture for humans, a text graph for agents — one representation or
two?); and (2) whether a human's freedom to arrange a view (pin, group, annotate, filter) belongs
*in* the artifact or *beside* it. Left unanswered, the docs risked either a second editable diagram
canvas (the drift ADR-0019 rejects) or layout coordinates leaking into the semantic artifact (the
BPMN-DI trap).

## Decision

Adopt **deterministic visual projections** as the visualization instance of the projection doctrine,
recorded in full in [15-visualization.md](../architecture/15-visualization.md):

1. **Every canonical artifact gets deterministic visual projections** — Flow JSON → flow graph;
   DMN → DRD + decision-table view; Workspace → the **connection map** (the cross-artifact dependency
   graph, derived from artifact refs + the doc 02 §10 catalog); runtime Case → the **journey view**
   (flow graph with the actual path walked, current position, waiting-on state, from the
   DecisionRecord + event history); cohort/bundle → roll-up views. Each is a read path over existing
   artifacts, never a new authoring surface.
2. **One source, two audiences.** A projection is emitted as a **typed JSON graph** (machine-canonical,
   every node/edge carrying its artifact ref, no layout coordinates — the truthfulness anchor) that
   renders deterministically to a **Mermaid** text graph (the shared human- and LLM-legible form) and
   thence to SVG (the human pixels). An agent asking `ichiflow-mcp` (`get_flow_graph`,
   `get_workspace_map`, `get_case_journey`, `get_decision_drd`, `get_set_journey` — Tier-0) gets the
   *same* text projection a human sees rendered. **Determinism is a projector property** (pinned
   layout engine + fixed non-zero seed where used + `deterministicIds` + canonical node ordering +
   pinned versions) and a verified harness property.
3. **Guidance + freedom split via a `viewhints` overlay.** The default projection is always truthful
   and reproducible (guidance). A human's arrangement — pinned positions, groupings, collapse,
   annotations, filters, saved viewpoints — lives in an **optional, governance-light `viewhints`
   overlay artifact** that the renderer composes over the canonical projection. `viewhints` **can
   never alter semantics** (its schema has no field to add/remove/reconnect a node); stale entries
   **degrade gracefully** with a drift-lint (the uischema-scope-lint pattern), never a failed render.
   This is the **uischema ⁄ data-schema** split (BRIEF §6, [ADR-0008](0008-jsonforms-model-ui-overrides.md))
   applied to graphs: meaning in the artifact, presentation in the overlay.
4. **Surfaces (per [ADR-0024](0024-llm-only-internal-surfaces-v1.md)).** v1 = deterministic
   projections in `ichiflow preview` + the Tier-0 MCP text projections; the interactive Workspace
   explorer is a **post-v1 builder surface (doc 12 class D7)** whose seam — the projection MCP tools,
   the JSON-graph schema, the `viewhints` artifact — ships in v1. The permit reference product must
   demonstrate its flow graph + a live Case journey as the acceptance-level demo.
5. **Format choice: Mermaid**, chosen for deepest LLM training presence (MermaidSeqBench, NeurIPS
   2025), MIT license (ichiflow is fully OSS, [ADR-0022](0022-fully-open-source.md)), and existing
   ubiquity in the ichiflow docs; deterministic layout via **dagre** (default, no seed) or **ELK with
   a fixed non-zero seed**. JSON graph is retained as the machine-canonical layer beneath it.

The harness lands as [13-agent-harness-loops.md](../architecture/13-agent-harness-loops.md) §2.o
(determinism vectors, truthfulness bijection — no orphans/no omissions, journey-view correctness,
viewhints degradation).

## Alternatives considered

- **An interactive diagram editor as the source of truth** (a visual flow/DMN builder canvas).
  Rejected per [ADR-0019](0019-ai-chat-first-authoring.md): a second editable representation of an
  artifact whose canonical form is governed JSON/DMN carries a round-trip-sync burden and inevitable
  drift, and sits off the audited write path (BRIEF §21). Projections are strictly read-only; the
  interactive *explorer* (post-v1 D7) is a read-only client of the same projections, not an editor.
- **BPMN DI-style embedded layout** (coordinates inside the semantic artifact). Rejected: it makes
  layout load-bearing in the executed/audited artifact, produces merge conflicts against logic
  changes, and drifts. Layout is kept in a **separate, discardable `viewhints` overlay** so the
  semantic artifact never carries a coordinate and the picture is always reconstructable without one.
- **Screenshot / pixel-only rendering** (ship the human a PNG/SVG, nothing text). Rejected: not
  AI-readable — an agent cannot reason over pixels, and it breaks the one-source-two-audiences
  property. The text JSON-graph + Mermaid *is* the projection; the raster is a derived cache.
- **D2 (with TALA) or bpmn-js/dmn-js as the projection engine.** Rejected on licensing +
  LLM-legibility: D2's best layout (TALA) is proprietary/paid, and bpmn-js/dmn-js ship under the
  bpmn.io license with a mandatory non-removable watermark — both incompatible with a fully-OSS
  projector; Mermaid also has far more LLM training presence. (dmn-js remains fine as a read-only
  *decision-table display* widget, doc 03 §5.3; React Flow (MIT) is a candidate *renderer* for the
  post-v1 explorer since it does no layout itself.)
- **JSON-graph only (no rendered picture).** Rejected as the human form: a human needs a diagram, not
  an adjacency list. JSON graph is kept as the machine layer *and* Mermaid is derived from it.

## Consequences

Positive:
- The founder's "how it all connects" ask is answered by the **connection map**, derivable from refs
  ichiflow already validates — no new metadata.
- Humans and agents share **one** projection viewed twice; the LLM path and the human path cannot
  diverge, and the agent kit + human preview share machinery (as ADR-0019/0024 intend).
- Determinism is enforced, not hoped for — the §2.o harness fails a projector that drifts, so
  previews are reproducible as the BRIEF requires.
- Freedom (arrangement) never threatens truth: `viewhints` cannot change meaning and degrades
  gracefully, so a human can organize a view without forking the artifact.

Negative / honest costs:
- **Projection-renderer fidelity is load-bearing** (as ADR-0019/0024 already flag) — the picture is
  the only way a non-developer judges structure, so its quality is a v1 risk to manage (doc 15 open-q1).
- **Determinism is a discipline, not a default** — Mermaid's clock-based IDs and force-directed
  layouts are nondeterministic unless explicitly pinned; the projector must hold every pin, and the
  pinned versions become part of the reproducibility contract.
- **Large-Workspace legibility is unproven** for Mermaid+dagre; very large connection maps may force
  a post-v1 renderer swap (doc 15 open-q1) — mitigated because the truthfulness contract is
  engine-independent.

## References

- [15-visualization.md](../architecture/15-visualization.md) — the full design (projection catalog,
  connection map, journey view, `viewhints`, format argument, surfaces, sources).
- Related ADRs: [0019](0019-ai-chat-first-authoring.md) (read-only projections to judge — the doctrine
  this extends to all visualization), [0024](0024-llm-only-internal-surfaces-v1.md) (v1 surface
  phasing — `ichiflow preview` + MCP; explorer post-v1), [0008](0008-jsonforms-model-ui-overrides.md)
  (independent data/UI-schema model — the analog for the semantic-graph/viewhints split),
  [0004](0004-declarative-flow-dsl-on-temporal.md) (Flow JSON — the flow-graph source),
  [0027](0027-dmn-authoring-projection.md) (decision source / DMN — the DRD source),
  [0025](0025-reference-data-ownership-and-teams.md) (CodeSet dependency graph — connection-map input),
  [0026](0026-harness-first-construction.md) (harness-first — §2.o).
- Superpowers visual companion (inspiration, borrowed honestly): render-for-the-human + live-refresh
  loop taken; edit-through-the-view mechanism rejected (previews stay read-only). Sources in doc 15.
