# 0008 — JSON Forms model: independent uischema + tester/priority renderer registry

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/03-schema-and-types.md](../research/03-schema-and-types.md)

## Context

ichiflow auto-generates UI from schemas (forms, tables, detail views) but must let a UX designer
override the generated UI safely, and — critically — **designer customizations must survive frequent
schema regeneration**. Research 03 §5.1 establishes the only way this is possible: UI customization
must live in a **separate, versioned document keyed to the data schema by reference** — never inline in
generated artifacts, never in forked copies of generated components.

## Decision

Adopt the **JSON Forms model** (and JSON Forms itself for the React reference implementation),
hardened per research 03 §5.3:

- **Two independent, versioned documents**: the data schema (generated from
  [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)) and a **uischema** (layouts + Controls
  with JSON-Pointer `scope`). Data-schema regeneration *cannot* touch the uischema.
- **Generated baseline uischema, once** (`--if-absent`) — a starting point, never overwritten;
  scaffold never clobbers designer work.
- **Designer overrides as versioned uischema/viewschema documents** in `contracts/ui/`, each recording
  the `$id` + version of the data schema it targets.
- **Renderer registry with tester-priority functions**: `(uischema, dataSchema) → priority`; higher
  priority wins. Customization = *add a registration*, never fork generated code. This registry is also
  where the design system plugs in.
- **Design tokens** as the theming spine, so brand changes touch zero uischema documents.
- **CI scope-drift lint**: validate every uischema JSON-Pointer scope against the current data schema;
  renamed/removed fields fail the build with a fix-it hint (closing the one hole in the JSON Forms
  model — the residual risk that renamed fields orphan scopes).
- **Tables/detail views**: a "viewschema" document (column sets, ordering, cell renderers by tester)
  built on TanStack Table with the identical registry/tester architecture (JSON Forms ships no table).

The same PDP ([0010](0010-hybrid-authorization-openfga-plus-policy.md)) drives field/row visibility so
generated screens stay consistent with the generated API.

## Alternatives considered

- **react-jsonschema-form (rjsf).** Strong second and a good source of ideas (templates/slots), but its
  `uiSchema` is path-keyed with **no tester fallback**, so field renames go silently stale, and it is
  React-only (research 03 §5.2). Rejected in favor of JSON Forms' tester-priority model.
- **AutoForm (shadcn / @autoform).** `fieldConfig` lives **inline with the schema** — overrides sit *in*
  the generated artifact, so regeneration clobbers them. Direct anti-pattern for the survive-regeneration
  requirement (research 03 §5.2). Rejected.
- **Scaffold-then-eject frameworks (refine.dev, react-admin).** Good frameworks, wrong model: generated
  code is *ejected and edited*, so **regeneration replaces rather than merges** — designer work does not
  survive (research 03 §5.2). Rejected.
- **App builders (Retool, Appsmith, Budibase, ToolJet).** Platform-managed app JSON with no semantic
  data-schema/uischema separation; re-scaffold on change; not embeddable as a framework substrate
  (research 03 §5.2). Rejected.
- **Headless build (TanStack Form/Table + RHF).** Not an alternative but the *implementation* substrate —
  this is how ichiflow builds its renderer sets and the viewschema tables under the JSON Forms model
  (research 03 §5.2, "complementary").

## Consequences

Positive:
- **Architecturally guaranteed**: regenerate contracts freely; the designer layer is data, not code, and
  cannot be clobbered (research 03 §5.3).
- One override architecture spans forms *and* tables/detail views via one registry/tester pattern.
- Design-token theming decouples brand changes from per-screen work.

Negative / costs:
- **The residual JSON Forms gap is real**: renamed/removed schema fields orphan uischema scopes. The CI
  scope-drift lint is mandatory, not optional; without it the "survives regeneration" guarantee leaks.
- ichiflow must **build the viewschema/table layer itself** — JSON Forms does not ship tables, so the
  registry/tester architecture is re-implemented on TanStack Table.
- JSON Forms' renderer sets (Material/Vanilla/Vuetify) may not match a customer design system out of the
  box; the design-token + custom-renderer investment is up front.
- Two documents per entity (data schema + uischema, + viewschema) is more artifacts to version and keep
  referentially consistent.

## References

- Research 03 §5 (schema-driven UI and the override model), §5.3 (recommended override architecture)
- JSON Forms — https://jsonforms.io
- Related: [0005](0005-first-party-case-and-human-task-module.md), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md), [0010](0010-hybrid-authorization-openfga-plus-policy.md)
