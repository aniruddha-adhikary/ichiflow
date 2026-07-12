# 0018 — The domain entity store (schema-defined entities, PostgreSQL-first, generated repositories)

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: design review 2026-07 (scope critique)
- Research: [../research/03-schema-and-types.md](../research/03-schema-and-types.md), [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md)

## Context

A design review found the single biggest gap in the architecture: the ordinary business **entity** —
the `LoanApplication` *record itself*, queryable / editable / listable / searchable — had no home. The
docs modelled Schemas (shapes), the Case store (case state + `case_id` registry), the DecisionRecord,
and unspecified "read models", but **no module owned domain entities**. Meanwhile the UI layer already
generates List / Detail / Form / CRUD screens "from data schema + viewschema + entitlements" and
applies ReBAC row filters — which *presupposes* a queryable entity store and a list/query API that
nothing specified. A framework whose thesis is "collapse the back-office CRUD skeleton" cannot leave
the business data model unlocated.

## Decision

Add a first-class **domain entity store** as a **v1-kernel** module
([0017](0017-v1-kernel-and-governance-dial.md)):

- **Schema-defined entities.** Domain entities are declared in the canonical schema
  ([0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)); their persisted tables are
  **generated** from that schema.
- **PostgreSQL-first** ([0012](0012-postgresql-first-storage-spis.md)), via **generated repositories /
  CRUD services** exposing a generated **query / pagination / search contract** (emitted alongside the
  OpenAPI surface) that the generated UI ([07](../architecture/07-ui-and-portals.md)) and Flows
  ([04](../architecture/04-flow-and-case-layer.md)) consume. Search default is Postgres FTS, with an
  OpenSearch-class binding behind the search SPI.
- **CRUD + audit-log + outbox — not event-sourced.** Business entities are ordinary tables with an
  audit log and a transactional outbox, consistent with the "event-source the decision/flow core
  only" stance ([0011](0011-decisionrecord-and-selective-event-sourcing.md)). Event sourcing is *not*
  extended to entity data.
- **Entity ↔ Case relationship.** An entity is referenced by `case_id`; entity lifecycle and Case
  lifecycle are distinct (an entity can outlive or precede a Case).
- **Behind a Repository SPI**, so the persistence binding is swappable without touching generated
  callers.

**Explicitly open:** the ORM / data-layer choice — **jOOQ vs Exposed vs plain SQL** — is left as an
Open question in [02](../architecture/02-schema-foundation.md); this ADR fixes the *presence, shape,
and contracts* of the entity store, not the data-access library.

## Alternatives considered

- **Event-source domain entities like the decision/flow core.** Rejected: the core's own guidance is
  that non-core domains are CRUD + outbox; event-sourcing every business entity imposes projection and
  replay cost with no audit benefit the DecisionRecord does not already provide.
- **Leave entity persistence to the application developer.** Rejected: it would break the generated
  CRUD/list screens and the ReBAC row-filter story, which both presuppose a framework-owned queryable
  store — and it re-opens exactly the back-office CRUD skeleton ichiflow exists to collapse.
- **Pick the ORM now (jOOQ / Exposed / plain SQL).** Deferred deliberately: the choice trades typed
  query ergonomics against codegen fit and licensing, and does not change the module's contracts, so
  it is tracked as an Open question rather than blocking the decision.

## Consequences

Positive:
- The generated CRUD / list / detail / search screens and their ReBAC row filters now stand on a
  specified store and a real query/pagination/search contract.
- Business entities get a consistent, swappable, PostgreSQL-first home with audit-log + outbox, with
  no drift from the "core-only event sourcing" rule.

Negative / costs:
- A new generated surface (entity tables, repositories, query contract) to build and version.
- The deferred ORM choice leaves a real design decision open; generated repository code must be
  structured so the eventual jOOQ/Exposed/plain-SQL pick is contained behind the Repository SPI.

## References

- Design review 2026-07 (scope critique): "no home for ordinary business entity data" (biggest gap).
- Related: [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md),
  [0011](0011-decisionrecord-and-selective-event-sourcing.md),
  [0012](0012-postgresql-first-storage-spis.md), [0017](0017-v1-kernel-and-governance-dial.md).
