# 0020 — Production-access posture is a configurable dial, not a forced default

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Basis: founder interview 2026-07 (eight decisions)
- Research: [../research/07-ai-native-operations.md](../research/07-ai-native-operations.md), [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md)

## Context

ichiflow makes *inspecting and changing production* legible: the *why* API is the read path
([0011](0011-decisionrecord-and-selective-event-sourcing.md)), the `ichiflow-mcp` guardrail tiers are
the mediated agent path ([0015](0015-first-party-mcp-server-and-agent-kit.md)), a human ops console is
the mediated human path ([07](../architecture/07-ui-and-portals.md) §7.2), env promotion is the
artifact write path, and agents ride NHI/JIT rails ([0009](0009-identity-broker-per-audience.md),
[0010](0010-hybrid-authorization-openfga-plus-policy.md)). The open question was **how strict** this
should be *by default*. A single forced posture (e.g. "zero direct production access for everyone")
is right for a zero-trust ministry and wrong for a team that wants conventional audited ops — and
vice-versa. Forcing either alienates the other.

## Decision

**ichiflow ships the mediation layers and makes the production-access *posture* a per-deployment,
per-org configurable dial** — it does not hard-code one stance.

**The mediation layers ichiflow always ships:**
- the **why API** as the read path (inspect via structured lineage, not shell access);
- the **human support/ops console** ([07](../architecture/07-ui-and-portals.md) §7.2) as the mediated
  human write path (human PEP over the same Tier-2 actuators an agent uses);
- the **`ichiflow-mcp` guardrail tiers** (read-only / sandbox / prod-with-JIT+approval) as the
  mediated agent path;
- **environment promotion as the artifact write path** — change reaches prod by promoting a reviewed,
  versioned artifact, not by editing prod in place;
- **break-glass that is loud and logged** — a direct-access escape hatch always exists, but every use
  is conspicuous, time-boxed, and written to the audit ledger.

**The dial levels an org selects among** (documented in
[09](../architecture/09-deployment-and-topology.md) §6.3):

- **`zero-direct-access`** — no human or agent holds standing prod credentials; all change flows
  through env promotion + the mediated consoles/tools; break-glass is the only direct path. Strictest;
  for the most regulated adopters.
- **`agents-mediated-humans-conventional`** — agents are confined to the guardrail tiers and NHI/JIT
  rails; humans keep conventional (audited) operational access. A pragmatic middle.
- **`custom`** — the org composes its own matrix of who (human / NHI) may use which path per
  environment.

The framework's job is to make the **mediated path the easy, well-lit default** and direct access the
deliberate exception; the *strictness* is the operator's dial.

## Alternatives considered

- **Force `zero-direct-access` as the only posture.** Rejected: correct for zero-trust regulated
  adopters, but it makes ichiflow unusable for teams that reasonably want conventional audited ops, and
  would harden a stance many orgs cannot yet operate. The layers should *enable* it, not *mandate* it.
- **Ship no posture concept (leave it entirely to each org's infra).** Rejected: the mediation layers
  (why API, console, MCP tiers, promotion, break-glass) are ichiflow's, so ichiflow must define how
  they compose into a coherent, auditable posture — otherwise every adopter reinvents it inconsistently
  and the audit story frays.
- **A binary strict/loose flag.** Rejected as too coarse: the realistic middle
  (agents-mediated, humans-conventional) and org-specific matrices need first-class expression, hence a
  dial with a `custom` level rather than a boolean.

## Consequences

Positive:
- One framework fits both a zero-trust ministry and a conventional-ops team without forking.
- The mediation layers are always present and always audited, so even the loosest posture keeps a
  legible trail; break-glass is uniformly loud/logged regardless of level.
- Agent access ([0015](0015-first-party-mcp-server-and-agent-kit.md)) and human access share one
  posture model, so "who may touch prod, how" has a single answer per deployment.

Negative / costs:
- **A configurable posture is a governance surface that must be set deliberately** — a mis-set `custom`
  matrix can be too loose; the secure default and documentation must steer strongly toward mediation.
- **More to test:** the mediated paths must be verified under each posture level (esp. that
  `zero-direct-access` truly leaves only break-glass as a direct path).
- The dial must stay consistent with the NHI/PDP model ([06](../architecture/06-identity-and-access.md)
  Part 4) so a posture level cannot be contradicted by an entitlement.

## References

- Founder interview 2026-07 (decision 1: production access is a configurable dial; ship the mediation
  layers; levels zero-direct-access / agents-mediated-humans-conventional / custom).
- Related: [0011](0011-decisionrecord-and-selective-event-sourcing.md) (why API read path),
  [0015](0015-first-party-mcp-server-and-agent-kit.md) (MCP guardrail tiers — the agent path),
  [0009](0009-identity-broker-per-audience.md)/[0010](0010-hybrid-authorization-openfga-plus-policy.md)
  (NHI, PDP), [09](../architecture/09-deployment-and-topology.md) §6.3 (the dial in the topology doc).
