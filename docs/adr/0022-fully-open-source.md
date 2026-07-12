# 0022 — ichiflow is fully open source (Apache-2.0/MIT), all of it; monetize services not features

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: founder interview 2026-07 (eight decisions)
- Research: [../research/06-migration-and-onboarding.md](../research/06-migration-and-onboarding.md)

## Context

ichiflow is a **framework meant to be self-hosted by its customers**, including air-gapped and
public-sector adopters, with an explicit anti-lock-in mission ("migration OUT is as supported as
migration IN"). [0016](0016-license-hygiene-policy.md) already forbids *embedding* lock-in — a
dependency whose license would push production fees or source-available restrictions onto ichiflow's
customers. But the docs still described some capabilities ("enterprise features," a "compliance pack,"
an "Enterprise-tier add-on") in language that read as **commercial editions** — implying an open-core
or paywalled split. The founder settled the question: ichiflow does not merely avoid embedding
lock-in, it **refuses to be** lock-in.

## Decision

**ichiflow is fully open source — Apache-2.0/MIT, all of it, with no gated features.**

- **Every capability ships in one open build**, including everything the docs call "enterprise" or
  "compliance." There is **no open-core split, no source-available tier, no paywalled capability.**
- **The Dev / Team / Enterprise tiers are technical capability profiles** (deployment-complexity
  ladders selected by config), **not commercial editions.** The same open code runs at every tier
  (mirrors [0013](0013-modular-monolith-split-later.md), [0017](0017-v1-kernel-and-governance-dial.md)).
- **What the docs called an "Enterprise pack" / "compliance pack" is now a "compliance profile /
  add-on": an open-source, optional install** (OpenLineage/BCBS-239 lineage, wide-event store,
  trigger-based bitemporal history — [08](../architecture/08-audit-and-observability.md) §4.5, §3).
  "Optional" means *not installed by default*, never *not free*.
- **Monetization, if ever, is support / hosting / services** — never gated features. A future managed
  offering could be a convenience over the same open build, never a feature paywall
  ([00](../architecture/00-vision-and-principles.md) §non-goals, Open questions).

This is the natural extension of the licensing-hygiene stance from "don't embed lock-in" to "don't
*be* lock-in," and it reinforces the exit story: a framework that is itself fully open, with fully
exportable artifacts, is maximally trustworthy to a procurement-sensitive (esp. public-sector)
adopter.

## Alternatives considered

- **Open-core (open core + paid enterprise features).** The common commercial-OSS model. Rejected: it
  directly contradicts the anti-lock-in mission and would put the very capabilities regulated adopters
  most need (compliance, audit retention, SSO breadth) behind a paywall — the same downstream-cost
  disqualifier [0016](0016-license-hygiene-policy.md) rejects in *dependencies*, applied to ichiflow
  itself.
- **Source-available (BUSL/FSL-style) for the whole project or for "enterprise" modules.** Rejected:
  source-available is not OSI-open, breaks air-gapped/self-host trust, and is exactly the license class
  [0016](0016-license-hygiene-policy.md) quarantines. Being the thing we tell customers to avoid is
  incoherent.
- **Fully open but with a proprietary hosted control plane as the only practical path.** Rejected as a
  *requirement*; permitted only as an optional convenience (services monetization), never the sole path
  ([00](../architecture/00-vision-and-principles.md) non-goal "not a hosted-only SaaS").

## Consequences

Positive:
- Maximum trust for self-hosting, air-gapped, and public-sector adopters; nothing to audit for hidden
  gates, nothing that expires or paywalls at scale.
- Removes an entire class of doc inconsistency: "tiers" and "profiles" are unambiguously technical, not
  commercial, everywhere.
- Reinforces the exit story ([0014](0014-map-first-migrate-last.md)) — an open framework with portable
  artifacts is the strongest possible anti-lock-in posture.

Negative / costs:
- **No feature-gating revenue lever.** Sustainability rests entirely on support / hosting / services,
  which is a harder commercial path than open-core; this is a deliberate, accepted tradeoff.
- **"Optional install" discipline must be maintained** so that not-installed-by-default is never
  confused (in docs or packaging) with not-free.
- Contributors and forks can stand up competing services with no license friction — an accepted
  consequence of genuine openness.

## References

- Founder interview 2026-07 (decision 5: fully open source; tiers are capability profiles; compliance
  profile is an OSS optional install; monetize services not features).
- Related: [0016](0016-license-hygiene-policy.md) (licensing hygiene — the consistent sibling),
  [0013](0013-modular-monolith-split-later.md) and [0017](0017-v1-kernel-and-governance-dial.md)
  (tiers as config, not editions), [0014](0014-map-first-migrate-last.md) (exit story),
  [0021](0021-reporting-via-oss-bi.md) (prefer-proven-OSS sibling).
