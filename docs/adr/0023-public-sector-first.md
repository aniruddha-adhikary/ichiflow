# 0023 — Design-target first adopter is government / public sector; finance is the adjacent second

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: founder interview 2026-07 (eight decisions)
- Research: [../research/06-migration-and-onboarding.md](../research/06-migration-and-onboarding.md)

## Context

ichiflow modularizes the enterprise-app skeleton (back-office + customer UI + decisions + flows +
manual review + audit) that is common to loan origination, claims, KYC, benefits, permitting, and
inspections ([00](../architecture/00-vision-and-principles.md) §1). The docs illustrated this
predominantly with **regulated financial services** examples. A product-strategy question remained:
*which adopter should the framework be designed toward first?* — because the first design target
shapes the onboarding templates, the canonical walkthrough, and which non-functional properties are
treated as load-bearing.

## Decision

**The design-target first adopter is government / public-sector casework; regulated financial services
is the adjacent second target.**

- **Primary design target — public-sector casework:** permitting, licensing, registrations, benefits,
  inspections. [00](../architecture/00-vision-and-principles.md) §1 names this as the primary target.
- **Adjacent second — regulated financial services** (loan origination, claims, KYC). **Every existing
  finance example stays valid**; this is a reprioritization, not a removal.
- **Onboarding / domain templates prioritize permit/licensing/benefits-style templates**
  (`event-permit`, `business-license`, `benefit-application`, `inspection-case`) ahead of the
  finance set ([09](../architecture/09-deployment-and-topology.md) §4).
- **The permit walkthrough
  ([../examples/creating-a-permit-product.md](../examples/creating-a-permit-product.md)) is the
  canonical reference product**, not merely an example — and it is the (a)-clause of the v1 acceptance
  test ([0017](0017-v1-kernel-and-governance-dial.md) amendment).
- **Procurement realities already fit:** self-host, air-gap, and data residency are existing locked
  properties ([0013](0013-modular-monolith-split-later.md),
  [09](../architecture/09-deployment-and-topology.md)), and full exportability
  ([0014](0014-map-first-migrate-last.md)) plus fully-open-source ([0022](0022-fully-open-source.md))
  are exactly what public-sector procurement demands.
- **HARD RULE (unchanged): no real government systems are named** anywhere in the docs; all
  illustrations are generic.

## Alternatives considered

- **Finance-first (keep the original center of gravity).** Rejected as the *primary* design target: the
  founder's strategy centers public sector first. Finance is retained as the strong adjacent second, so
  no finance work is wasted — the skeleton is shared.
- **Generic breadth (target no vertical; stay maximally general).** Rejected: "designed for everyone" in
  practice tunes the on-ramps, templates, and reference product for no one. A concrete primary target
  makes the templates, walkthrough, and acceptance test crisp; the shared skeleton keeps breadth
  available.
- **Name a specific real government program to anchor the reference product.** Rejected and forbidden:
  the hard rule bars naming real government systems; the reference product is a **generic** outdoor-event
  permit.

## Consequences

Positive:
- Crisp first-adopter focus: templates, the canonical reference product, and the v1 acceptance test all
  point at public-sector casework.
- The framework's procurement-hard properties (self-host, air-gap, residency, exportability, fully OSS)
  are validated against the adopter that needs them most.
- Finance remains first-class as the adjacent second, so the addressable shape stays broad.

Negative / costs:
- **Public-sector sales/procurement cycles are long and compliance-heavy** — a go-to-market cost the
  product strategy accepts in exchange for fit.
- **Template and example maintenance now spans two vertical sets** (public-sector-first, finance-second),
  a documentation/scaffolding upkeep cost.
- The "no real systems named" rule requires ongoing vigilance in examples and templates.

## References

- Founder interview 2026-07 (decision 6: public-sector-first design target; finance adjacent second;
  permit walkthrough is canonical; procurement realities fit; no real systems named).
- Related: [0017](0017-v1-kernel-and-governance-dial.md) (v1 acceptance test),
  [0013](0013-modular-monolith-split-later.md)/[09](../architecture/09-deployment-and-topology.md)
  (self-host/air-gap/zones), [0014](0014-map-first-migrate-last.md) (exit story),
  [0022](0022-fully-open-source.md) (fully OSS — procurement fit).
