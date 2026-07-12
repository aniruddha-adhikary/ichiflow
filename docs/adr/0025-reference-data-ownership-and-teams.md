# 0025 — Reference data as interdependent, owned, governed assets; Teams as first-class sub-org structure

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: founder requirement (reference data as living, interdependent, owned assets; teams/roles drive access)
- Research: [../research/03-schema-and-types.md](../research/03-schema-and-types.md), [../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md)

## Context

ichiflow already treats reference data as a governed artifact class — the **CodeSet**
([02-schema-foundation.md](../architecture/02-schema-foundation.md) §9): schema'd, semver-versioned,
effective-dated, registry-governed, referenced by `id@version` rather than inlined. But three gaps remained
against the founder requirement that reference data be a set of **living, interdependent, owned** assets,
not flat lookup tables:

1. **Interdependence was unspecified.** Real reference data cross-references itself — a
   `natures-covered` list whose rows point at a `countries` list. Nothing modelled foreign-key-like links
   between CodeSets, nor what happens to dependents when a referenced row is deprecated.
2. **Ownership was implicit.** A DecisionModel carried an `owner` string, but there was no uniform,
   enforceable model of *which Team owns an artifact and who its stewards are* — and no link between that
   ownership and the authz model that decides who may edit or approve it.
3. **Sub-org structure was missing.** One deployment serves one org (§11, ADR-0017), but that org is not
   flat: departments, lines-of-business, and partner organizations share the deployment. There was no
   first-class model of Teams, membership, and role-within-team to drive design-time and runtime access.

The single-org-per-deployment decision (ADR-0017) is not in tension with this: teams/departments/partner
orgs are **sub-structures within the one org**, not tenants. This ADR fills the three gaps together
because they are one story — reference data that is owned by teams, changed under team-routed approval, and
kept referentially whole across versions.

## Decision

**1. CodeSet interdependencies with cross-version referential integrity
([02](../architecture/02-schema-foundation.md) §9.4).** A CodeSet row may carry **`codeRef` columns** —
foreign-key-like fields (the canonical `CodeRef` shape, `{ code, codeSet }`) pinning a row in another
`CodeSet@version`. At **publish** the gate validates every `codeRef` **across versions and effective
dates**: the target `codeSet@version` exists, holds a **live (non-deprecated)** row for the code, and its
`effective` window **covers** the referencing row's window (bitemporal, not "exists today"). ichiflow
maintains a queryable **dependency graph** ("what depends on this code/version?") for humans and via
`ichiflow-mcp`. Deprecating/removing a referenced row triggers **publish-time impact analysis** over the
graph and either **blocks the publish** or **forces a routed review of every dependent** — a referenced
row cannot vanish under a live dependent silently.

**2. Ownership & stewardship, uniform and enforced
([06](../architecture/06-identity-and-access.md) Part 4).** Every governed Workspace artifact — CodeSets
especially, but uniformly Schemas, DecisionModels, Flows, uischemas, policies — has an **owning Team** and
**named stewards**. Ownership is **both** metadata on the artifact (an `owner` block,
[02](../architecture/02-schema-foundation.md) §9.1) **and** an `owned_by`/`steward` **relation in the
authz model**, so ownership is declared *and* enforced.

**3. Change workflows on reference data
([03](../architecture/03-decision-layer.md) §5.2, §5.6, §5.8).** Approval-as-a-Flow (already the
DecisionModel pattern) **extends to CodeSets and every governed artifact**. The governance level is the
Workspace/tier dial (ADR-0017) with a **per-artifact override** (a CodeSet's `governance` block). Approval
is **routed by role within the owning Team** (or a designated approver team), and that routing is **itself
a Decision** — the same "routing is a Decision" stance as Task assignment. A deprecation of a referenced
code runs the **impact-review Flow** over dependents (point 1).

**4. Teams, membership, and roles as first-class
([06](../architecture/06-identity-and-access.md) Part 4).** **Teams** (departments, lines-of-business,
partner orgs — nesting) are **sub-structures within the single org/tenant, not tenants**. Membership and
**role-as-relation** (`steward`/`approver`/`editor`/`viewer` on a Team) plus artifact/case `owner`
relations are modelled in **OpenFGA** (v1 = OpenFGA only, ADR-0010). **Design-time authz uses the SAME PDP
as runtime**: "may I edit this CodeSet" and "may I view this Case row" are one relation vocabulary, one
decision path, one decision log — design-time is the `artifact` object type, runtime the `case`/entity
types, both rooted under the owning Team and the tenant.

## Alternatives considered

- **Flat, ungoverned lookup tables.** Rejected: it is exactly the state the founder requirement rejects.
  Un-owned, un-versioned lookup tables drift, break silently when a referenced value is retired, and give
  no answer to "who owns this / what depends on it / who approved the change" — the audit and stewardship
  questions ichiflow exists to answer.
- **An external Master Data Management (MDM) system.** Rejected for v1: it splits governance across two
  systems (the CodeSet's version/effective-date/DecisionRecord provenance would live outside ichiflow),
  breaks the "one schema, one registry, one PDP, one audit spine" invariant, and works against the
  self-host/air-gap posture (§3). Reference data is close enough to Decisions and Flows — it is pinned by
  them and audited with them — that owning it inside the Workspace is the coherent choice. An MDM adapter
  remains possible later behind the Adapter layer.
- **Tenant-per-team (model each team/department/partner as its own tenant).** Rejected: it contradicts the
  single-org-per-deployment decision (ADR-0017) and mis-models the domain. Teams share artifacts, cases,
  and reference data *within one org*; making each a tenant would erect isolation boundaries where
  collaboration is required and duplicate the tenant plumbing for what is really an ownership/role
  distinction. Teams are an ownership boundary; the tenant stays the org.

## Consequences

Positive:
- Reference data becomes a living, interdependent, owned asset: cross-CodeSet references are integrity-
  checked bitemporally, a dependency graph answers "what depends on this," and no shared code is retired
  without an audited, owner-routed decision.
- Ownership is uniform and enforceable: one model across all governed artifacts, declared as metadata and
  enforced by the same PDP that guards runtime — no separate "admin authz."
- Sub-org structure is honest: partner orgs and departments share one deployment with correct isolation,
  without abusing the tenant boundary, and the multi-tenant seams (ADR-0017) stay intact for later.

**Amendment (2026-07-12) — per-Team env-pin activation.** Ownership is per-Team, but a released version's
**activation** — the env-pin that promotes it — was a single deployment-wide checked-in file
(`environments/prod.pins.yaml`, [09](../architecture/09-deployment-and-topology.md) §6.3, BRIEF §21a). On a
multi-agency deployment (the multi-agency-licensing case study, its G3) N Teams promoting on independent
schedules all commit to one pin file — a coordination bottleneck and a shared blast radius. The env-pin may
therefore be **partitioned by owning Team** (`environments/prod/<team>.pins.yaml`), so a Team promotes its
own bundle versions independently while the deployment **composes** the partitions into the effective pin
set. This **preserves "version control is the write path"** (BRIEF §21a) — every pin is still a git commit —
and scopes *activation* to the same ownership boundary that already governs *edit/approve*, without crossing
the tenancy line (a Team is still not a tenant; it shares the deployment's tenancy root, PDP graph, and audit
spine). See [03](../architecture/03-decision-layer.md) §5.7 and [09](../architecture/09-deployment-and-topology.md)
§6.3.

Negative / costs:
- **Added publish-time complexity.** The CodeSet publish gate now walks the dependency graph and runs
  cross-version, effective-dated referential-integrity + impact analysis — more to build, and a slower,
  heavier publish for interdependent CodeSets than a flat-table write.
- A CodeSet deprecation can **block on other teams**: retiring a shared code may require multi-owner
  approval, which is correct but adds coordination latency.
- More OpenFGA relations and tuple-sync surface (teams, membership, roles, artifact/case ownership) to
  keep write-through-consistent (§2.1); a stale ownership tuple is a wrong design-time decision, so the
  same tuple-freshness discipline now covers the Workspace, not only runtime data.

## References

- Founder requirement: reference data as living, interdependent, owned assets; teams/roles drive
  view/modify/approve at design time and run time.
- Related: [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md),
  [0010](0010-hybrid-authorization-openfga-plus-policy.md),
  [0017](0017-v1-kernel-and-governance-dial.md),
  [0018](0018-domain-entity-store.md).
- Docs: [02](../architecture/02-schema-foundation.md) §9, [03](../architecture/03-decision-layer.md) §5,
  [06](../architecture/06-identity-and-access.md) Part 4.
