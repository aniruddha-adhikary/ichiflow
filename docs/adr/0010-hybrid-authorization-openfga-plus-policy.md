# 0010 — Hybrid authorization: OpenFGA ReBAC backbone + Cedar/OPA ABAC, one PDP

- Status: accepted (amended 2026-07-12)
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md)
- Amendment basis: design review 2026-07 (scope critique)

## Context

ichiflow auto-generates APIs and UIs and needs **fine-grained, feature/attribute/field/row-level
entitlements** enforced *consistently* across both. Research 04 §B.2 is explicit: **no single
authorization model wins.** RBAC handles coarse portal/role gating but suffers role explosion; ABAC
fits feature-flag/attribute entitlements and field-level masking; ReBAC (Zanzibar) excels at "list every
resource this user can access" (reverse-index) — exactly what a generated list view/API needs — and
multi-tenant relationships. ichiflow needs all three, and decisions must be **explainable** (adverse
action, GDPR Art. 22 "why is this field hidden").

## Decision

Externalize authorization into a **central PDP with a hybrid model**, and drive the **same PDP** from
both the generated API and the generated UI (research 04 §B.2.2, §B.2.3):

- **OpenFGA (Zanzibar-style ReBAC) — the relationship backbone.** Multi-tenancy, row-level "who can see
  this record", and **list-filtering** for generated UIs/APIs (reverse-index "list objects"). Apache-2.0,
  CNCF.
- **Cedar (or OPA) — the ABAC/feature/field-level layer.** Cedar is safe, deterministic, formally
  analyzable, and returns decision + diagnostics/reasons (explainable by design) for feature/attribute
  entitlements and field masks. **OPA/Rego** is the acceptable single-engine substitute where teams
  prefer one policy language and value its best-in-class decision-log maturity.
- **One thin ichiflow authz gateway (PDP)** both layers call: at the **API** boundary every generated
  endpoint calls `(principal, action, resource, context)` — ReBAC supplies the *filter set* (which rows),
  ABAC supplies *field masks* (which columns/features). At the **UI** layer the same PDP answers "may
  this user see/edit field X / feature Y" so screens render consistently with the API — one decision
  source, no drift.
- **Decision logs are mandatory** (`decision_id`, principal, action, resource, context, allow/deny,
  *reason/rule*) — feeding both compliance audit and the UI explanation surface, and joining the
  DecisionRecord ([0011](0011-decisionrecord-and-selective-event-sourcing.md)).
- Entitlements are **policy-as-code, versioned, AI-generatable** (research 04 §B.3).

## Amendment (2026-07-12) — v1 phasing: OpenFGA only

The hybrid above is the **target end-state**, but running and reconciling two engines (OpenFGA graph +
Cedar/OPA) plus write-through/CDC tuple-sync is disproportionate v1 scope and cannot live in the
single-binary dev tier (OpenFGA is a server; a stale tuple is a wrong decision). Phasing decision:

- **v1 = OpenFGA only.** The ReBAC backbone (relationships, multi-tenancy, reverse-index
  list-filtering) plus **simple attribute conditions** (OpenFGA conditional relationships) cover v1's
  RBAC + row-level + coarse attribute needs.
- **Cedar/OPA ABAC = post-v1 capability-profile add-on (open source, optional install)**, for richer
  attribute/feature/field-level policy and formal analysis, introduced **behind the same PDP
  interface**. "Add-on" is a *technical capability profile*, **not a paid/commercial gate** — like the
  whole framework it is fully open source ([0022](0022-fully-open-source.md)).
- **The PDP contract is unchanged** whether one engine or two sit behind it: the API and UI PEPs still
  call `(principal, action, resource, context)` → `allow | deny + reason`, and decision logs are
  emitted identically. Adding Cedar/OPA later is a `PolicyEngine` SPI binding, not a re-architecture.

Consequence for the dev tier: this resolves the flagged authz exception in
[09](../architecture/09-deployment-and-topology.md) §3.1 — v1 authz is OpenFGA-shaped everywhere, with
ABAC-rich field-masking a Team+/Enterprise capability, not a day-one dual-engine composition.

## Alternatives considered

- **Pure RBAC (roles in the IdP only).** Simple and familiar but coarse; **explodes** into role sprawl
  once entitlements get fine-grained, and cannot answer efficient "what can I see" queries or field-level
  masking (research 04 §B.2.1). Rejected as sole model; RBAC survives only as coarse gating within the
  hybrid.
- **OPA/Rego as the single engine.** Richest decision-log/audit story and one language for infra + app
  policy — the acceptable substitute. Not the default because **Rego is expressive but error-prone**
  (runtime exceptions, non-determinism), whereas Cedar/OpenFGA are safer/deterministic (research 04
  §B.2.2, §B.5). Kept as a sanctioned alternative.
- **Cedar alone (no ReBAC).** Great for ABAC/RBAC and explainable, but ReBAC's reverse-index "list every
  resource this user can access" is what generated list APIs need and is awkward to express as pure ABAC
  (research 04 §B.2.1/§B.2.2). Rejected alone; paired with OpenFGA.
- **Casbin (embedded, in-process).** Good for isolated single-service enforcement, but weak for
  centralized audit/multi-service governance and lacks built-in decision logs (research 04 §B.2.2).
  Rejected as the central PDP.
- **Permit.io / Oso (managed convenience over the OSS engines).** Useful to accelerate authoring, but
  commercial control planes; ichiflow keeps the OSS engines (OpenFGA/Cedar/OPA) to preserve
  self-hostability and anti-lock-in. Noted, not adopted as a dependency.

## Consequences

Positive:
- One PDP, one decision source for API and UI — field/row-level consistency with no drift, and every
  denial is explainable from the decision log.
- ReBAC list-filtering makes generated list views/APIs efficient and correct at multi-tenant scale.
- Policy-as-code is versioned and AI-authorable, matching the "declare, don't code" principle.

Negative / costs:
- **Two engines to run and reconcile** (OpenFGA graph + Cedar/OPA) — more moving parts than a single PDP;
  the gateway must compose their answers coherently.
- **ReBAC data consistency is a hard operational problem**: OpenFGA is a stateful graph that must stay in
  sync with business data (stale tuples = wrong decisions), requiring write-through/CDC discipline plus
  latency budgeting for list queries (research 04 §B.5).
- If OPA/Rego is chosen, **Rego correctness is a footgun** requiring policy tests and CI validation.
- The classic mistake — **conflating AuthN and AuthZ** — must be actively avoided; entitlements live in
  policy-as-code, not IdP roles alone (research 04 §B.5).

## References

- Research 04 §B.2 (models + engines), §B.2.3 (row/field-level on generated UIs/APIs), §B.3 (declared artifacts), §B.5 (risks)
- OpenFGA — https://openfga.dev · Cedar — https://www.cedarpolicy.com · OPA decision logs — https://www.openpolicyagent.org/docs/management-decision-logs
- Related: [0009](0009-identity-broker-per-audience.md), [0011](0011-decisionrecord-and-selective-event-sourcing.md), [0008](0008-jsonforms-model-ui-overrides.md)
