# 0013 — Modular monolith by default, async-first boundaries, split later; zone separation from day one

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md), [../research/06-migration-and-onboarding.md](../research/06-migration-and-onboarding.md)

## Context

ichiflow must satisfy two audiences with one codebase: a newcomer wanting a working rules app in under
10 minutes, and an enterprise needing HA, zones, SSO, and compliance (research 06 §B.0). It must also be
independently scalable where scale demands. Research 05 §3.1 finds the winning shape for a *framework
product* in 2026 is a **modular monolith adopters can split later** — not microservices-by-default;
~42% of orgs that adopted microservices are consolidating back. The framework's job is to make module
boundaries explicit and async-first so a single deployable can be carved into services only when scale
truly demands. Banks also segment networks (internet → DMZ → intranet → core), so the portal/core split
must be supported from day one (research 05 §5).

## Decision

- **Modular monolith is the default shape.** One deployable, in-process events across **enforced** module
  boundaries (Spring Modulith 2.0 + ArchUnit fitness functions + jMolecules; boundary violations fail the
  build) (research 05 §3.3). Per-module schema ownership so a module carries its tables when it leaves.
- **Async-first module boundaries.** Modules communicate via domain events, not direct calls — so the
  seam is already a message boundary. When a module is split out, the in-process event becomes a network
  message with minimal code change (research 05 §3.3).
- **Tier ladder as config, not code rewrites** (research 06 §B.2): **Dev** (single binary, embedded
  SQLite, boots in seconds, no Docker for hello-world — the Temporal dev-server model) → **Team**
  (modular monolith on one Postgres, [0012](0012-postgresql-first-storage-spis.md)) → **Enterprise**
  (split modules / HA / DMZ-intranet zones / SSO / the compliance profile — an OSS optional install,
  [0022](0022-fully-open-source.md)). The **same app code** runs across tiers; tiers are technical
  capability profiles, not commercial editions — enterprise capability is additive config/profiles +
  SPIs, never a forked programming model or a paid gate.
- **Zone separation supported from day one.** The Portal module and case/rules core module are deployable
  to different zones with only **async event/message contracts** between them (no synchronous RPC assuming
  a return path). This is the same seam that later enables a service split — zone separation and
  independent deployability reinforce each other (research 05 §5.2). Support one-way async relay /
  file-drop / data-diode topologies.
- Enterprise on-prem: **Helm + Kubernetes Operator**, **air-gap capable** (private registry mirroring/
  Harbor, Zarf-style packaging) (research 05 §3.5).

## Alternatives considered

- **Microservices by default.** Rejected — going straight to microservices is the documented anti-pattern
  (100s of deployables, network complexity) and the industry is consolidating back; it is an escape
  hatch, not a starting point (research 05 §3.1/§3.2).
- **Plain (non-modular) monolith.** Rejected — without enforced boundaries and async seams, "split later"
  becomes a rewrite; Spring Modulith's enforced boundaries + Event Publication Registry are what make the
  seam real (research 05 §3.3).
- **Self-contained systems (SCS) as the starting point.** SCS is the right *intermediate* split target
  ("break a monolith into SCS first, then evolve pieces into microservices"), not the day-one shape
  (research 05 §3.2). Adopted as the natural split destination, not the default.
- **Docker-compose as the default dev on-ramp.** Rejected as *default*: it adds overhead/indirection and
  costs the sub-10-minute first success (Supabase's slow-first-run friction); the single binary with
  embedded SQLite is the default, compose optional for full-stack fidelity (research 06 §B.1, §B.4).
- **The Backstage model (powerful platform, heavy onboarding).** Explicit counter-example — months to
  usable, ~10% adoption; enterprise features must stay strictly additive so newcomers don't pay the
  complexity tax up front (research 06 §B.0, §B.4).

## Consequences

Positive:
- One programming model from laptop to zoned HA cluster — the solo-built loan app deploys to enterprise
  with only config/infra changes, zero app-code edits (research 06 §B.3.3).
- Async-first seams give independent scalability *and* zone separation from the same design.
- Enforced boundaries keep the monolith from rotting into a big ball of mud.

Negative / costs:
- **Async-first everywhere is a discipline tax**: in-process domain events are more ceremony than direct
  calls, and eventual consistency at module seams must be reasoned about even before any split.
- **Config sprawl risk**: many profiles/flags become their own complexity — governed with preset profiles
  (dev / prod-single / enterprise) rather than exposing every knob (research 06 §B.4).
- Operator + air-gap packaging + Helm is real enterprise-delivery engineering.
- The two-audience tension is permanent: defaults must be both newcomer-simple and enterprise-safe,
  managed via the explicit dev-vs-prod mode split (research 06 §B.4).

## References

- Research 05 §3 (deployability), §3.3 (enforced boundaries / async-first), §3.4 (single binary), §3.5 (on-prem), §5 (zone separation)
- Research 06 §B.0–B.4 (progressive DX, tier ladder, batteries-included-but-swappable)
- Related: [0012](0012-postgresql-first-storage-spis.md), [0014](0014-map-first-migrate-last.md), [0009](0009-identity-broker-per-audience.md)
