# 0026 — Harness-first construction: deterministic verification loops for every subsystem

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture; founder directive 2026-07 (harness loops for deterministic done-ness)
- Basis: founder ask 2026-07 — "harness loops for building the different parts of the system so the LLM can judge deterministically whether/what/how much has been done and correctness"
- Research: [../research/07-ai-native-operations.md](../research/07-ai-native-operations.md), [../research/03-schema-and-types.md](../research/03-schema-and-types.md), [../research/06-migration-and-onboarding.md](../research/06-migration-and-onboarding.md)

## Context

ichiflow is built by AI coding agents and later used by AI coding agents to build applications
([BRIEF §12](../architecture/BRIEF.md)). An agent can *claim* a unit of work is complete in fluent
prose and be wrong, and a human reviewer cannot cheaply refute the claim at the volume agents produce.
"Looks done" is the dominant failure mode when the author is a machine. The architecture already
specifies many verification mechanisms — regenerate-and-diff CI ([02](../architecture/02-schema-foundation.md)
§4.3), scenario specs + golden datasets + coverage ([03](../architecture/03-decision-layer.md) §6),
replay/time-skip/scenario tests ([04](../architecture/04-flow-and-case-layer.md) §8), decision parity
+ reconciliation ([11](../architecture/11-migration-in-and-out.md) §4), drift/a11y/contrast lint +
preview snapshots ([07](../architecture/07-ui-and-portals.md) §12), deterministic replay + seeded
repro ([10](../architecture/10-ai-native-experience.md) §3.2, §4) — but as seven unrelated CI jobs
with seven output formats and no shared model of "how much is done." There was no stated doctrine, no
common verdict contract, and no single entry point an agent could drive uniformly across subsystems.

The question this ADR settles: **how does an agent get a deterministic, machine-readable verdict on
whether / what / how much of any part of ichiflow is done and correct — for both ichiflow's own
construction and app-building on ichiflow?**

## Decision

Adopt **harness-first construction**: every subsystem ships a **harness before its implementation**
(the agent-era analog of TDD). A harness is exactly four parts — **fixtures/golden data + executable
checks + a machine-readable verdict + a progress metric**. Verdicts are **JSON, never prose**
(per-check pass/fail, counts, structured diffs); **"how much has been done" is an enumerable
conformance/coverage count over a suite**, not a narrative claim.

- **One entry point:** `ichiflow verify [--scope <subsystem|artifact>] [--json] [--since <ref>]`, with
  a single verdict envelope every scope emits, a **progress ledger** (suite × pass-count) that is
  dashboardable and agent-queryable via a Tier-0 MCP tool `get_verify_status`.
- **A harness per subsystem** (schema pipeline round-trip/drift/oasdiff/cross-language vectors;
  Decision-SPI **DMN TCK conformance suite any engine must pass** + per-model scenarios/coverage +
  trace-shape; Flow interpreter vectors + determinism + compute contracts; adapter contract
  tests/mapping goldens/idempotency-DLQ vectors; UI scope-lint/snapshots/a11y/PDP-state; AuthZ policy
  vectors run design-time **and** runtime; DecisionRecord orphan-event completeness; migration
  parity + reconciliation; ichiflow-mcp tool-contracts + **tier-enforcement negative tests**), with
  the two **v1 acceptance exercises as the outermost harnesses** run in CI.
- **Harness definitions are schema'd Workspace artifacts** (a governed `Harness` class), so apps add
  their own checks and the verification machinery **ships as a product feature** (the same
  scenario/parity/verify engine app-builders use).
- **Hooks run scoped verify on artifact writes; CI runs full verify.** **Flake policy is
  retry-forbidden**: harnesses are deterministic by construction (seeded time/data, event-history
  replay, Temporal time-skipping); a non-deterministic check is a harness defect, fixed, never retried
  around.
- **Build-order:** construct ichiflow harness-first in dependency order (verify spine → schema
  pipeline → decision SPI conformance → flow interpreter vectors → adapters/authz → DecisionRecord →
  UI/mcp → migration → reference-product + migration-exercise acceptance), **each phase's exit = its
  harness green in CI**.

Full specification in [13-agent-harness-loops.md](../architecture/13-agent-harness-loops.md).

## Alternatives considered

- **Test-after (write tests once the implementation exists).** Rejected: it lets an agent declare a
  unit done before any verdict exists, which is exactly the "looks done" failure this decision targets;
  and tests written after the code tend to codify the code's behavior rather than the intended
  contract. Harness-first makes the red-before-green sequence the definition of the work.
- **Prose-based agent self-assessment.** Rejected outright: an agent's natural-language "I implemented
  X and it works" is unverifiable, lies by omission, and does not compose into a progress metric. The
  entire doctrine exists to replace the prose claim with a JSON verdict and an enumerable count.
- **Human QA gates as the primary check.** Rejected as the *primary* mechanism: human review does not
  scale to agent-produced volume, is non-deterministic, and cannot be an agent's inner-loop actuator.
  Humans remain in the loop for approval and judgement (the authoring doctrine, ADR-0019), but the
  machine-readable harness is what gates done-ness; humans dispose over a *verdict*, not a vibe.
- **Per-subsystem bespoke CI jobs with ad-hoc outputs (the status quo pre-this-ADR).** Rejected: seven
  formats mean an agent needs seven parsers and there is no shared "how much is done" model; unifying
  the verdict envelope and the `ichiflow verify` entry point is the low-cost, high-leverage move.

## Consequences

Positive:
- Done-ness and correctness are **facts an agent can read**, not claims a human must trust; "how much"
  is a count over a suite.
- One loop (`ichiflow verify` + verdict + ledger) serves both **building ichiflow** and **building on
  ichiflow** — the verification machinery is a product feature, so ichiflow's construction is the first
  dogfood of what it hands app-builders.
- The pluggable Decision Engine SPI gains teeth: "any engine behind the SPI" is verifiable because the
  SPI ships a conformance suite a third-party engine must pass ([03](../architecture/03-decision-layer.md)
  §3; ADR-0002).
- The v1 acceptance bar (ADR-0017) becomes a green CI verdict, not a judgement call.

Negative / costs:
- Writing the harness first is upfront work before any feature is demonstrable — deliberately slower to
  first-pixel, faster to trustworthy-done.
- The retry-forbidden flake policy constrains how Flows/Adapters are written (determinism, seeded I/O)
  and forbids the easy "re-run to clear" — a real discipline cost
  ([10](../architecture/10-ai-native-experience.md) §4).
- The verdict-schema and harness-artifact contracts are new surfaces that must be versioned and kept in
  sync with their consumers (CI, dashboard, MCP, agents) — a maintenance discipline.

## References

- Founder ask 2026-07: deterministic harness loops for whether/what/how-much/correctness.
- The decision-layer harness set is elaborated for the default engine (Drools/Apache KIE) in
  [13](../architecture/13-agent-harness-loops.md) §2.b — DMN-TCK (pinned TCK + KIE version),
  FEEL-semantics vectors, DRL/rule-unit + CEP harnesses, and the green-gated engine-upgrade harness —
  paired with the pinned `resources` manifest ([10](../architecture/10-ai-native-experience.md) §2.5).
- Related: [0002](0002-pluggable-decision-engine-spi-drools-default.md) (engine SPI — now with a
  shipped conformance suite), [0004](0004-declarative-flow-dsl-on-temporal.md) (interpreter
  determinism/replay), [0006](0006-typespec-authoring-openapi-jsonschema-canonical.md)
  (regenerate-and-diff), [0011](0011-decisionrecord-and-selective-event-sourcing.md) (DecisionRecord
  completeness), [0014](0014-map-first-migrate-last.md) (parity + reconciliation),
  [0015](0015-first-party-mcp-server-and-agent-kit.md) (`ichiflow verify` gate, hooks,
  `get_verify_status`), [0017](0017-v1-kernel-and-governance-dial.md) (v1 acceptance = the outermost
  harnesses), [0019](0019-ai-chat-first-authoring.md) (AI proposes, deterministic tools + humans
  dispose).
