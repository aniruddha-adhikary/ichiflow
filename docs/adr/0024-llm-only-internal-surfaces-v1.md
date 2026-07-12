# 0024 — LLM-only internal surfaces for v1; generated end-user Portals are the only built UI

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture; founder directive 2026-07 (voice note)
- Basis: founder interview 2026-07 (prove-it-fast; "LLM only" for everything internal; LLM-first bet; "wedding in" builders post-v1)
- Research: [../research/07-ai-native-operations.md](../research/07-ai-native-operations.md), [../research/03-schema-and-types.md](../research/03-schema-and-types.md)

## Context

ichiflow's architecture describes many human-facing surfaces. Some are **the product output** — the
generated **customer/partner Portals** and the **back-office manual-review inbox/case view** — where
*generating the surface IS the framework's value* ([BRIEF §6](../architecture/BRIEF.md);
[07-ui-and-portals.md](../architecture/07-ui-and-portals.md)). Others are **internal / operator /
builder / admin** surfaces the docs sketch as human web apps: the **Design Kit playground and
Storybook-class component workbench** (07 §11), the **human support/ops console** (07 §7.2), the
**Decision governance / approval** surface (03 §5), **admin/config** surfaces (06), a standalone
**auditor query** surface (08), and the packaged **Copilots** (10 §7).

At this stage the founder wants v1's **human-built UI surface kept to the absolute minimum** — to
prove the idea fast and cheap — and it is also a deliberate **LLM-first bet** ("they are the future").
Building playground apps, an ops console, a governance web app, and admin UIs in v1 would be
substantial UI engineering that is *not* the differentiator and *not* required to validate the
framework. The authoring doctrine (ADR-0019, "Chat to author, preview to judge") and the AI-native
surface (ADR-0015: agent kit + `ichiflow-mcp` with three server-enforced guardrail tiers) already
provide an LLM path to every one of these internal surfaces. The question this ADR settles: **for v1,
do we build the internal human UIs, or serve them LLM-first?**

## Decision

**v1 builds human UI only for the generated end-user Portals; every internal surface is served
LLM-first.**

1. **Built in v1 (product output):** the generated **customer Portal** (forms + customer-safe status
   model), the **partner Portal**, and the **back-office manual-review** surfaces — the **Task inbox**
   and the **Case/review view** (case detail, decision-trace render, action form that signals the
   Flow, obligation checklist, permitted case operations). These *are* the product and are the
   manual-review half of the v1 acceptance test (ADR-0017), and their users — the public, partners, and
   operational caseworkers — are end users of the product, not builders with agent access.
2. **LLM-only in v1 (internal surfaces):** the support/ops console, Decision governance/approval,
   business-user rule authoring, analyst simulation, the Design Kit playground and component
   workbench, the designer safety-contract review, the standalone auditor query surface, and
   admin/config surfaces are served by **Claude Code + `ichiflow-mcp` + the `ichiflow` CLI + chat**,
   with **live previews as read-only rendered artifacts** — an `ichiflow preview` dev-server URL that
   renders the canonical artifact (flow diagram, decision-table view, rendered screen, simulation
   trace), never an interactive app. The exact LLM path per surface is enumerated in
   [12-system-map-and-v1-surfaces.md](../architecture/12-system-map-and-v1-surfaces.md) §2.B (e.g.
   governance approval = PR review or approval-Flow actioned via `ichiflow-mcp`; support console =
   MCP Tier-2 actuators + why API in Claude Code; playground = `ichiflow preview` URL driven by chat).
3. **Third-party surfaces are unaffected:** embedded OSS BI (Metabase/Superset), OTel-backend
   dashboards, the Temporal Web UI, the Keycloak admin console, and the Apicurio registry UI are
   integrated, not built (locked decision §17); this decision does not touch them.
4. **Seams stay for post-v1 builders.** The **underlying typed APIs and MCP tools ARE the seam**: a
   post-v1 human UI for any internal surface is *just another client* of a contract v1 already ships
   (the why API, the Tier-2 actuator API, the governance-state model + approval Flow, the
   `contracts/ui`/`tokens` + preview build, broker-config-as-artifact). No internal surface's contract,
   SPI, or MCP tool is deferred — **only its human front end is.** This keeps the capability to
   "wed in" builder-style surfaces later an additive build, not a rewrite.

Nothing about the underlying architecture changes: every seam, SPI, contract, and MCP tool the docs
describe remains v1. **Only the v1 phasing of *surfaces* changes.**

## Alternatives considered

- **Build the playground / ops-console / governance / admin apps in v1 (the docs' original
  implication).** Rejected for v1: substantial UI engineering on *non-differentiating* surfaces,
  directly against the prove-it-fast constraint and the LLM-first bet; it front-loads the exact
  human-UI cost the framework exists to avoid, and delays validating the real differentiators
  (decision governance, DecisionRecord, Flow DSL, the agent surface). It remains the **post-v1**
  target (class D), reachable additively via the seams above.
- **Hybrid — build *some* internal UIs in v1** (e.g. the ops console, since "the agent out-tools the
  human", 07 §7.2). Rejected as the v1 default: every internal surface already has a working LLM path,
  and picking a subset to build re-introduces UI cost and a judgment call per surface without a
  proven need. The hybrid is exactly what the **(D) triggers** (doc 12 §3) convert into a *later,
  evidence-driven* build — so the option is preserved, not taken, in v1.
- **Keep the docs implying built internal UIs and decide later.** Rejected: ambiguity would let v1
  scope creep back into UI engineering. An explicit LLM-only default with named revisit triggers is
  cheaper to hold to.

## Consequences

Positive:
- **Minimal v1 human-UI surface** — v1 builds the generated Portals and essentially no internal web
  apps, the cheapest path to proving the framework.
- **Coherent with the authoring doctrine** (ADR-0019) and the agent surface (ADR-0015): humans and
  agents share the *same* chat-author / preview-judge / PR-approve machinery, so there is one surface
  to build and harden, not two.
- **Seams preserved** — because the API/MCP/PR contract is the seam, post-v1 builder UIs (doc 12 §2.D)
  are additive clients; the LLM-first bet costs nothing structural if it needs walking back.
- **Removes, rather than adds, v1 deployables** — internal web apps drop out of the v1 topology.

Negative / honest UX costs (each with a revisit trigger in [doc 12 §3](../architecture/12-system-map-and-v1-surfaces.md)):
- **The business/domain owner ("permits-manager") tweaking rules has no dedicated portal** — chat +
  read-only decision-table/simulation preview only, so a non-technical owner depends on an
  agent/developer intermediary. *Trigger:* non-technical self-serve rule changes at scale without an
  agent (build D6).
- **The support/ops operator has no console** — they re-drive/retry/reassign through Claude Code +
  `ichiflow-mcp` Tier-2, so "the agent out-tools the human" is temporarily true for non-agent
  operators. *Trigger:* support/incident volume or a non-technical operator population (build D3).
- **The designer judges via a rendered preview, not an interactive playground/workbench app.**
  *Trigger:* designer throughput or stakeholder review exceeds a rendered gallery + chat (build D1).
- **The standalone auditor uses query tools, not a forensic console** (the back-office why *render* is
  built; the dedicated console is not). *Trigger:* an auditor without CLI/agent access is a hard
  regulated-partner requirement.
- **Preview-fidelity is load-bearing for even more personas** — with more surfaces collapsed to
  read-only previews, projection-renderer quality is now a v1 risk to manage (doc 12 Open question 1).
- **The read-only-preview vs. interactive-app boundary must be held** or the Design Kit drifts back
  into building an app (doc 12 Open question 5).

## References

- Founder directive 2026-07 (voice note): minimize v1 human-built UI; LLM-only internal surfaces;
  generated Portals stay; "wed in" builders post-v1; LLM-first bet.
- [12-system-map-and-v1-surfaces.md](../architecture/12-system-map-and-v1-surfaces.md) — the full
  surface inventory (A/B/C/D), the exact LLM path per surface, the tradeoffs + triggers, and the
  system map.
- Related ADRs: [0019](0019-ai-chat-first-authoring.md) (authoring doctrine — the interaction model
  this scopes to v1), [0015](0015-first-party-mcp-server-and-agent-kit.md) (`ichiflow-mcp` + agent kit
  — the LLM path), [0017](0017-v1-kernel-and-governance-dial.md) (v1 kernel; Copilots post-v1),
  [0020](0020-prod-access-posture-dial.md) (mediation layers the ops LLM path rides),
  [0021](0021-reporting-via-oss-bi.md) (embedded OSS BI — class C).
- [BRIEF.md](../architecture/BRIEF.md) locked decision #19 (LLM-only internal surfaces for v1).
