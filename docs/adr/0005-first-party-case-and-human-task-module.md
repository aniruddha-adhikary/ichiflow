# 0005 — First-party Case & Human-Task module (assignment routing is a Decision)

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md)

## Context

A **Case** is ichiflow's unit of business work; a **Task** is a human work item within a Case
(assignment, SLA, escalation). Manual review / case management is the sharpest requirement and, per
research 02 §6, the sharpest differentiator between options. [0003](0003-temporal-durable-execution-substrate.md)
chose Temporal, which provides the durable *mechanics* (signals, timers, escalation branches,
idempotent handlers) but **no task store, assignment engine, or reviewer UI** — human-in-the-loop on
Temporal is a documented, battle-tested *pattern*, not a product feature. BPMN engines ship these
turnkey, but ichiflow declined them for licensing/opacity reasons.

## Decision

Build **Case management and Human Tasks as a first-party ichiflow module** layered on Temporal
(research 02 §6). Components:

- **Task store** — `Task = {workflowId, type, payload, assignee, queue, SLA, state}`, fed by Flows
  that emit "task created" and block on a signal.
- **Assignment/routing engine** — round-robin, skill/role-based, load-based. **Assignment routing is
  itself a Decision**: it is authored as DMN and evaluated through the Decision Engine SPI
  ([0002](0002-pluggable-decision-engine-spi-drools-default.md)) — the platform already runs rules, so
  routing is a rule flow, and routing choices land in the DecisionRecord like any other decision
  ([0011](0011-decisionrecord-and-selective-event-sourcing.md)).
- **Escalation** — Temporal SLA timers reassign/notify/auto-decide on expiry.
- **Reviewer UI + API** — resolves a task by sending the signal back; UI generated via
  [0008](0008-jsonforms-model-ui-overrides.md), authorized field/row-level by the shared PDP
  ([0010](0010-hybrid-authorization-openfga-plus-policy.md)).
- **Case aggregate** — groups related Tasks/Flows under the global `case_id` with its own audit trail.

## Alternatives considered

- **Adopt a BPMN engine's built-in human tasks (Camunda 8 Tasklist / Flowable / jBPM).** These ship
  task lists, assignment, forms, escalation, and (Flowable) CMMN for genuine unstructured case work —
  turnkey today (research 02 §6). Rejected for the same reasons as [0003](0003-temporal-durable-execution-substrate.md):
  Camunda 8 imposes a production license on customers; Flowable/jBPM are JVM-centric with weak
  code/AI-authoring and DB-bound scale. Bending a generic BPMN task list to enterprise-specific,
  rule-driven routing is *less* flexible than owning the module. Research 02 §6 concludes: accept the
  build; it is the same work required on *any* code-first engine and it is ichiflow's product surface.
- **Camunda 8 specifically for CMMN case management.** Rejected twice over: Camunda 8 **dropped CMMN
  entirely** (must be faked in BPMN ad-hoc sub-processes, research 02 §3/§6), so it does not even solve
  the unstructured-case problem; Flowable would, but at the JVM-authoring cost above.
- **Treat human tasks as ad-hoc per-Flow code.** Rejected: no shared task store, no consistent
  assignment/escalation, no auditable routing decisions — reinvented per project.

## Consequences

Positive:
- Assignment logic is expressed in the same governed, explainable DMN as business decisions — routing
  is auditable and A/B-simulatable, not hidden in code.
- Case/Task model is purpose-built for ichiflow's enterprise routing needs and far more flexible than a
  bent BPMN task list.
- One `case_id`-keyed audit trail unifies flow history, decisions, tasks, and human review
  ([0011](0011-decisionrecord-and-selective-event-sourcing.md)).

Negative / costs:
- **This is a substantial build** — task store, assignment engine, escalation, reviewer UI, case
  aggregate — the deliberate cost of not adopting a BPMN engine (research 02 §1, §6). It is the single
  largest orchestration-side product investment.
- No CMMN standard interchange for cases: ichiflow's case model is its own; unstructured "adaptive"
  case work (Flowable's CMMN strength) must be modeled in ichiflow's primitives, and there is no
  standard case-model export the way DMN/CNCF-SWF give for decisions/flows.
- Reviewer UI, assignment, and escalation are correctness- and compliance-sensitive surfaces ichiflow
  now owns end to end (adverse-action, human-reviewer identity capture per GDPR Art. 22 — research 05).

## References

- Research 02 §6 (human-task/case-management gap analysis), §1 (accepted risks)
- Related: [0002](0002-pluggable-decision-engine-spi-drools-default.md), [0003](0003-temporal-durable-execution-substrate.md), [0008](0008-jsonforms-model-ui-overrides.md), [0010](0010-hybrid-authorization-openfga-plus-policy.md), [0011](0011-decisionrecord-and-selective-event-sourcing.md)
