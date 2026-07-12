# 0003 — Temporal as the durable-execution substrate

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md)

## Context

ichiflow Flows are long-running (days–months) enterprise processes that route to manual review, call
the decision layer, must be deeply auditable ("why did this case take this path"), and must be
self-hostable by customers with no downstream license fees. Research 02 splits the market into
**code-first durable execution** (Temporal, Restate, DBOS, Conductor…) and **model-first BPMN/CMMN
engines** (Camunda, Flowable, Kogito/jBPM). The two hardest things to build are *durable execution*
and *human-task/case management*; the strategy is to buy the first and build the second as product
([0005](0005-first-party-case-and-human-task-module.md)).

## Decision

Adopt **Temporal as ichiflow's durable-execution core**. Rationale (research 02 §1, §3):

- **Licensing:** server and SDKs are **MIT** — self-host with zero license fees, Temporal Cloud
  optional. No rug-pull risk of the kind Camunda 8 executed.
- **Replay + full Event History is the audit/explainability mechanism** ichiflow wants — every
  command, timer, signal, and activity result is recorded and re-derivable; advanced Visibility gives
  SQL-like search on custom attributes. This is the strongest explainability story in the set and
  feeds [0011](0011-decisionrecord-and-selective-event-sourcing.md).
- **Versioning/patching** (`patched()`/Worker Versioning) lets months-long flows evolve safely.
- **Multi-language task-queue routing:** Kotlin rule-eval activities on one queue, TS integration
  activities on another, orchestrated from one workflow — matches [0007](0007-kotlin-core-typescript-edges.md).
- Mature time-skipping test framework and replay/determinism tests.

Human tasks / manual review / case management are **not** taken from Temporal; they are a first-party
ichiflow module built on Temporal's signal + timer primitives ([0005](0005-first-party-case-and-human-task-module.md)).

## Alternatives considered

- **Camunda 8 / Zeebe.** Technically strong, scalable, built-in Tasklist. **Rejected on licensing:**
  since v8.6 (Oct 2024) production self-managed requires a **paid Camunda Enterprise license**; Zeebe/
  Operate/Tasklist are under Camunda License v1 (non-production free only). Embedding it would make
  ichiflow's *customers* liable for Camunda's fee — unacceptable for a self-hostable framework
  (research 02 §3, §6, §7). Also dropped CMMN. See [0016](0016-license-hygiene-policy.md).
- **Flowable — the hedge/fallback.** Apache-2.0, real BPMN + **CMMN case management** + DMN, turnkey
  human tasks — the cleanest "own it forever" open-source BPMN engine, and the *recommended fallback*
  if buyers demand standards-based BPMN interchange and a turnkey task UI on day one over code-first/AI
  ergonomics (research 02 §3, §1). Not chosen because ichiflow wants a declarative DSL surface it
  controls ([0004](0004-declarative-flow-dsl-on-temporal.md)) and code-first/AI-authoring ergonomics;
  JVM-centric with no first-class TS authoring and DB-bound horizontal scale. Kept as the documented
  hedge.
- **Kogito / jBPM (Apache KIE).** Most *cohesive* single-stack option since the rules layer is already
  Drools/KIE. Rejected as orchestrator: mid-donation to Apache Incubator (namespace churn, "interfaces
  constantly changing"), and a lighter human-task story needing companion services (research 02 §3).
  Incubation flux on a *foundational* dependency is higher risk than for the rules engine alone.
- **Restate (BUSL-1.1).** Attractive, lighter than Temporal, but **BUSL is source-available, not
  OSI-open** — the same category of restriction that makes ichiflow wary of Camunda 8 — plus a younger
  ecosystem and no built-in human tasks (research 02 §3, §7). Watch, don't bet.
- **DBOS (durable execution as a Postgres library).** Lowest-ops (your Postgres is the store), a strong
  *simplicity hedge* if operating a Temporal cluster proves too costly early; weaker for very-long-
  running human-task-heavy flows and cross-language (no Kotlin) (research 02 §3). Revisit if Temporal
  ops cost bites; noted in the tier ladder ([0013](0013-modular-monolith-split-later.md)).
- **Netflix Conductor / Orkes (Apache-2.0, JSON-declarative).** The strongest pure-OSS "JSON DSL over
  durable engine" alternative — you get a declarative surface for free (research 02 §3, §5). Credible
  #2 substrate. Rejected because building the DSL on Temporal gives more control over the ichiflow flow
  model, stronger replay/versioning, and better mindshare/SDK maturity; Conductor's human-task/case UI
  is still build-your-own anyway.
- **AWS Step Functions.** Proprietary, AWS-locked — wrong for a self-hostable, cloud-neutral framework;
  fine only as an optional deployment target (research 02 §3).

## Consequences

Positive:
- MIT self-host with zero downstream fees; clean fit for air-gapped enterprise ([0013](0013-modular-monolith-split-later.md)).
- Deterministic replay is both the durability mechanism and the audit substrate ([0011](0011-decisionrecord-and-selective-event-sourcing.md)) and what makes AI-agent debugging real ([0015](0015-first-party-mcp-server-and-agent-kit.md)).

Negative / costs:
- **Human tasks, escalation, and case management are not built in** — ichiflow builds them ([0005](0005-first-party-case-and-human-task-module.md)). Deliberate (it is the product moat), but real work.
- **Kotlin is not a first-class Temporal SDK** (served via the Java SDK's `temporal-kotlin` extension). Mitigation: confine Kotlin to *activity workers* (no determinism constraints); see [0007](0007-kotlin-core-typescript-edges.md) — note this constrains the brief's "Kotlin flow workers" phrasing.
- Self-hosting a production Temporal cluster (Cassandra/PostgreSQL backing store) is real ops (~$2.5–4.5k/mo + labor, research 02 §3); the DBOS simplicity hedge exists for small tiers.
- Determinism-in-workflow-code is a discipline (no wall-clock/RNG/uncontrolled I/O in workflow code).

## References

- Research 02 §1 (recommendation), §3 (per-option profiles), §6 (human-task gap), §7 (licensing risk)
- Temporal — https://temporal.io/ · Event history — https://docs.temporal.io/encyclopedia/event-history/event-history-go
- Related: [0004](0004-declarative-flow-dsl-on-temporal.md), [0005](0005-first-party-case-and-human-task-module.md), [0007](0007-kotlin-core-typescript-edges.md), [0016](0016-license-hygiene-policy.md)
