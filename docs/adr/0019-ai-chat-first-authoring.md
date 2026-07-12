# 0019 — AI-chat-first authoring; live preview to judge; no visual-builder canvases

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: design review 2026-07 (designer-experience and declarative-boundary critiques)
- Research: [../research/03-schema-and-types.md](../research/03-schema-and-types.md), [../research/07-ai-native-operations.md](../research/07-ai-native-operations.md)

## Context

ichiflow generates artifacts (Schemas, Decisions, Flows, uischema/pageschema, Adapters) that a
business user, a designer, and a developer must all be able to shape. The open question across the
docs was *how* a non-developer authors: hand-edit JSON? a drag-and-drop / visual-builder canvas? an
AI-assisted surface? Left unanswered, the docs drifted toward implying visual editors (a uischema
canvas, a DMN table-editor, a flow diagram builder) — each of which creates a **second editable
representation** of an artifact whose canonical form is already the governed JSON/DMN, with the
round-trip-sync burden that has sunk comparable tools.

## Decision

Adopt a single cross-cutting **authoring doctrine** for **all** personas:

- **AI authors the artifact via chat.** The human describes intent in conversation; the AI proposes
  the canonical artifact (Flow JSON, DMN, uischema/pageschema, Adapter).
- **The human steers in conversation and judges via live preview.** Previews — flow diagrams,
  decision-table views, rendered screens, simulation/what-if results — are **read-only projections
  rendered *from* the canonical artifacts**, never a second editable representation.
- **The approval surface is the diff + preview/simulation pair.** The AI explains the diff in plain
  language; the human approves the change against the preview and, where applicable, a simulation.
- **Direct artifact editing remains available to developers.** The canonical artifact is text under
  version control; a developer may edit it directly (and, for Flows, use the typed one-way builder,
  [0004](0004-declarative-flow-dsl-on-temporal.md)).

This is the interaction model behind every persona surface: business-user rule authoring is chat +
live simulation over a read-only decision-table view ([03](../architecture/03-decision-layer.md)
§5.3), flow authoring is typed-code | YAML | AI-chat with the diagram as a projection
([04](../architecture/04-flow-and-case-layer.md) §2.5), and the designer playground is chat-driven
with live rendered screens where uischema is a compile target, not a canvas
([07](../architecture/07-ui-and-portals.md) §11). It is the same "AI proposes; deterministic tools +
humans dispose" contract the Copilots ([10](../architecture/10-ai-native-experience.md) §7) are built
on, stated as the v1 interaction pattern.

## Alternatives considered

- **Drag-and-drop / visual-builder canvases** (a visual flow builder, a uischema layout canvas, an
  editable DMN table canvas). Rejected: each is a **second editable representation** of an artifact
  whose canonical form is the governed JSON/DMN, carrying a **round-trip sync burden**, inevitable
  **representation drift**, and **heavy bespoke tooling** — and it is precisely the surface an AI can
  replace by authoring the canonical artifact directly while the human judges a projection.
- **Hand-edited JSON as the non-developer surface.** Rejected for business users and designers: JSON
  Pointers, tester priorities, and DMN/FEEL internals are engineer concepts; making them the authoring
  surface re-creates the developer dependency the personas exist to escape. (Direct editing stays for
  developers.)
- **A read-only preview that is also lightly editable "for convenience."** Rejected: any editable
  projection is a second representation and reintroduces drift. Previews are strictly read-only.

## Consequences

Positive:
- One coherent interaction model across personas; no round-trip-sync engine to build or debug.
- The canonical artifact is always the single source of truth; previews cannot drift from it because
  they are projections of it.
- Aligns the human and agent authoring paths — both propose canonical artifacts and judge via
  diff + preview — so the agent kit and the human UX share machinery.

Negative / costs:
- Requires excellent **projection renderers** (flow diagram, decision-table view, rendered screen,
  simulation) since they are the *only* way a non-developer judges a change — their fidelity is
  load-bearing.
- Users accustomed to visual builders must adapt to a chat-and-judge loop; the AI's diff explanations
  and preview fidelity must carry the comprehension that a manipulable canvas otherwise would.

## References

- Design review 2026-07 (designer-experience critique: "uischema is a compile target, the playground
  is the authoring surface"; declarative-boundary critique: canonical artifact is the audit spine).
- Related: [0004](0004-declarative-flow-dsl-on-temporal.md),
  [0008](0008-jsonforms-model-ui-overrides.md), [0017](0017-v1-kernel-and-governance-dial.md).
