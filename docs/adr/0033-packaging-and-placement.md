# 0033 — Packaging & placement doctrine: core vs component vs SPI vs external delegation

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md) (what the audit spine must own), [../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) (delegation paths, IdP/authz), [../research/01-rule-engines.md](../research/01-rule-engines.md) (SPI-plus-default pattern)
- Basis: founder requirement 2026-07 — generalize ADR-0029's three placement profiles for document issuance into a **doctrine** that decides, for *every* capability, whether it is core, a first-party optional component, an SPI-plus-default, or a designed external-delegation path — with a classification table applying it across the system.

## Context

ADR-0029 (document issuance) decomposed one capability into **three placement profiles**: audit-spine
semantics hard-shipped as core, rendering as an optional swappable SPI component, and a designed
external-delegation path for an enterprise document platform. Several other ADRs make the *same* kind of
call independently — reporting embeds OSS BI (ADR-0021), observability is OTel-native BYO-backend
(ADR-0011), the rule engine is an SPI with a Drools default (ADR-0002), identity is a broker (ADR-0009),
authz is a PDP with a post-v1 second engine (ADR-0010). What was missing is the **general rule** these
all instantiate, and a place that classifies every capability against it so the boundary is a doctrine,
not a per-ADR intuition. This ADR records the doctrine; [12](../architecture/12-system-map-and-v1-surfaces.md)
§6 hosts the classification table as the living map.

## Decision

Adopt a **placement decision tree**. For each capability (or each **semantic** within a capability), ask
in order:

- **(i) Does the audit spine depend on its semantics?** → **CORE**, hard-shipped. If the DecisionRecord,
  replay, `case_id` correlation, number/ledger allocation, or lifecycle/verification integrity depend on
  it, it cannot leave ichiflow. (e.g. Document numbering + lifecycle + verification; `QuotaLedger`
  invariants; the DecisionRecord itself; the Flow interpreter.)
- **(ii) Is it an ichiflow-differentiating capability?** → **FIRST-PARTY OPTIONAL COMPONENT**, shipped by
  ichiflow but installable/optional, not baked into the kernel. The differentiators ichiflow **builds**
  (BRIEF §17): decision governance, Copilots, the Design Kit — and the *default* implementations of core
  SPIs where ichiflow's version is a selling point.
- **(iii) Is it a commodity with mature OSS?** → **SPI + THIN DEFAULT + integration guidance**. Ship a
  small, licensing-vetted default behind an SPI and document integrating the proven OSS (BRIEF §17). (e.g.
  document rendering → Typst default; search → Postgres FTS default; BI → embed Metabase/Superset.)
- **(iv) Does the enterprise already own one?** → **DESIGNED EXTERNAL-DELEGATION PATH** (adapter /
  `external-task`). Provide a designed seam so an enterprise's existing platform can own the concern while
  ichiflow keeps the audit anchor. (e.g. an enterprise CCM owning issuance; an existing IdP federated in;
  an external finance system reached by `external-task`.)

**These classify a *semantic*, not a product area monolithically.** Most real capabilities are **hybrid**
across the tree — issuance is (i) numbering/lifecycle/verification **core** + (ii)/(iii) rendering
**component/SPI** + (iv) **delegated** full issuance; the audit-spine core is invariant across placements,
and only *who does the non-core part* moves. The doctrine's job is to keep the **core minimal** (only what
the audit spine depends on) and give everything else a **declared seam with a delegation path** — the
"closed core, declared extension points" rule (BRIEF §21b) applied to packaging.

### Classification table

Each row lists the capability's placement **per semantic** (the primary quadrant in **bold**), the v1
default, and the delegation path. The full table with v1-phasing notes lives in
[12](../architecture/12-system-map-and-v1-surfaces.md) §6.

| Capability | Placement (per semantic) | v1 default | External-delegation path |
|---|---|---|---|
| **Document rendering** | render **(iii)** SPI; numbering/lifecycle/verification **(i)** core | Typst behind rendering SPI | delegated rendering / full issuance → enterprise CCM (ADR-0029) |
| **Notifications** | delivery **(iii)** SPI; issuance-of-record **(i)** core when it *is* a Document | notification adapters (doc 05 §4.2) | enterprise notification/CCM platform via outbound Adapter |
| **BI / reporting** | **(iii)** embed OSS BI over **(i)** governed read models | Metabase/Superset-class over read-model projections (ADR-0021) | enterprise BI tool over the same governed read models |
| **Observability backend** | **(iii)/(iv)** OTel-native, BYO backend; no proprietary store | minimal local viewer (Dev); OTLP export (ADR-0011) | any OTLP backend (CloudWatch/GCO/Grafana/Datadog) |
| **Identity broker** | **(iv)** broker per audience; propagation **(i)**-adjacent | Keycloak (ADR-0009) | federate the enterprise/agency corporate IdP upstream |
| **AuthZ engine(s)** | **(i)** one PDP contract; engines **(iii)** behind it | OpenFGA only (ADR-0010) | Cedar/OPA ABAC as a post-v1 add-on behind the same PDP |
| **Rule engine** | **(i)** DMN semantics + governance core; engine **(iii)** SPI | Apache KIE/Drools (ADR-0002) | any DMN-TCK-conformant engine via the Decision SPI |
| **Workflow substrate** | **(i)** interpreter + DecisionRecord core; execution **(iii)** on a substrate | Temporal (ADR-0003) | substrate is embedded, not delegated; Flows export CNCF-SWF |
| **Entity storage** | **(i)** contracts + query/CRUD; store **(iii)** SPI | PostgreSQL-first (ADR-0018/0012) | OpenSearch-class search binding; DB behind Repository SPI |
| **Object storage** (Document binaries) | binary **(iii)** SPI; snapshot/hash **(i)** core | PG large-object / local FS (Dev/Team), S3-compatible (Ent) | any S3-compatible object store behind the SPI (doc 02 §11) |
| **Migration tooling** | **(ii)** differentiator (map-first, parity) built | Ring 0/1/2 + parity harness (ADR-0014) | Atlas/pgroll/Debezium integrated beneath the Copilot seam |
| **MCP surface** | **(i)** why/case/flow query APIs + tier enforcement core; **(ii)** the server | first-party `ichiflow-mcp`, 3 guardrail tiers (ADR-0015/0024) | MCP tool-extension SPI for org-specific tools |

## Alternatives considered

- **Leave placement to each ADR's intuition (status quo). Rejected.** The same reasoning recurs across
  ADR-0002/0009/0010/0011/0021/0029; without a named doctrine and a table, the boundary drifts and new
  capabilities re-argue it from scratch.
- **Classify each product area monolithically (issuance is "a component," reporting is "OSS"). Rejected.**
  It hides the hybrid: issuance's numbering/verification is core even though its rendering is a component.
  The tree classifies **semantics**, which is what keeps the core minimal and correct.
- **Maximize core ("ship everything first-party"). Rejected.** Violates BRIEF §17 (integrate proven OSS
  for non-differentiators) and forfeits the enterprise-reuse and licensing-hygiene wins; bloats the kernel.
- **Minimize core ("SPI everything, delegate everything"). Rejected.** The audit spine's integrity
  (numbering, ledger invariants, DecisionRecord, verification) **cannot** be delegated without losing the
  guarantees ichiflow exists to provide. (i) is a hard floor.

## Consequences

Positive:
- One **doctrine** decides placement for every capability; new capabilities are classified against the
  tree, not re-argued. The classification table in doc 12 §6 is the living map.
- Keeps the **core minimal** (only audit-spine semantics) and gives everything else a **declared seam with
  a delegation path** — laptop runs the thin defaults, an enterprise reuses its CCM/IdP/BI, and the audit
  spine is invariant across placements.
- Makes ADR-0029's three profiles a **special case** of a general rule, and aligns ADR-0002/0009/0010/
  0011/0021 under one frame.

Negative / costs:
- The doctrine is a **classification discipline**, not a mechanism — it must be *applied* consistently; the
  table needs maintenance as capabilities are added (owned in doc 12 §6).
- The **(ii) vs (iii)** line (differentiator vs commodity) is a judgement call that will occasionally be
  contested (e.g. is a given default "a selling point" or "just a commodity default"); the table records
  the current call and its rationale rather than pretending the line is crisp.
- Some hybrids have **several** delegation depths (issuance: delegated rendering vs delegated full
  issuance); the table lists the primary path and defers depth detail to the owning ADR.

## References

- [12-system-map-and-v1-surfaces.md](../architecture/12-system-map-and-v1-surfaces.md) §6 (the living
  classification table + placement tree in context), §1 (the surface-classification rule this complements)
- Generalizes [0029](0029-document-issuance.md) (three placement profiles for issuance)
- Cross-refs: [0022](0022-fully-open-source.md) (fully OSS — placement is technical, never a paywall),
  [0024](0024-llm-only-internal-surfaces-v1.md) (LLM-only internal surfaces — a phasing, not a placement),
  [0002](0002-pluggable-decision-engine-spi-drools-default.md), [0009](0009-identity-broker-per-audience.md),
  [0010](0010-hybrid-authorization-openfga-plus-policy.md), [0011](0011-decisionrecord-and-selective-event-sourcing.md),
  [0021](0021-reporting-via-oss-bi.md) (the placements this doctrine unifies)
