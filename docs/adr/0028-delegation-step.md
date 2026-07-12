# 0028 — Canonical `external-task` (delegation) step: submit → await correlated response → resume

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) (human-in-the-loop / await-signal + SLA), [../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md) Part A (EIP Request-Reply, Correlation Identifier, reliability)
- Basis: founder requirement 2026-07 — "part of a workflow can be *offloaded* to another external system that responds back later; transport-adaptable by design (HTTP callback/polling, message queues, and *designable* over SFTP file transfer)."

## Context

ichiflow already has two ways a Flow ([04](../architecture/04-flow-and-case-layer.md)) can pause for
work it does not compute inline: **`human-task`** (§5.2 — create a work item, await a resolve signal
raced by a pausable SLA timer, escalate on expiry) and **`signal/event-wait`** (§2.3 — block on an
external signal/canonical event). What it lacks is a first-class primitive for the **machine** version of
`human-task`: **offloading a unit of work to an external system that responds later on its own schedule.**

This shape is pervasive in casework and regulated finance — an external screening/vetting service, a
partner valuation or lab result, an accreditation body's credential check, a settlement/clearing
round-trip. The interaction is always the same: **submit a request, then durably await a *correlated*
response**, which may arrive seconds or weeks later over a variety of transports (an HTTP callback, an
HTTP polling handle, a message-queue reply, or — in many regulated integrations — a **file dropped over
SFTP** answered by a **response file**). Modelling each of these ad hoc scatters the semantics that make
a delegation correct: **correlation** (matching the reply to the waiting instance), **timeout/SLA +
escalation**, **at-least-once submission + idempotent/dedup'd receipt**, and **audit** (a reconstructable
submitted → responded chain in the DecisionRecord).

## Decision

Add a **canonical Flow step type `external-task`** (the "delegation step") to the closed step-type set
([04](../architecture/04-flow-and-case-layer.md) §2.3, §2.8). Its semantics:

1. **submit** a schema'd request through an **outbound Adapter**;
2. durably **await a correlated response** through an **inbound Adapter**;
3. **validate** the response against a canonical response schema;
4. **resume** the flow — or take **timeout / escalation / compensation** paths.

It is the **machine analog of `human-task`**: both are await-with-SLA steps that create a work item, block
on an idempotent correlated resolution, race the **same pausable-clock SLA + escalation** machinery
(§5.7), and record their resolution into the DecisionRecord (§5.8 makes the symmetry explicit).

- **Canonical, not an extension step type (§2.7).** A step is canonical when the interpreter must
  understand its control-flow semantics to **replay them deterministically**; an extension type is
  admissible only when the new kind reduces to a **compute-variant** on the generic code-activity path.
  `external-task` is durable cross-adapter await under a clock — it does **not** reduce to a single
  activity — so it is canonical, exactly as `human-task` is. What is pluggable is the **transport**, and
  its seam already exists: the transport profiles are **Adapter bindings** under the existing
  **Adapter-binding SPI** ([05](../architecture/05-adapters.md) §2), so one canonical step rides many
  transports without forking the step vocabulary (the same shape as `adapter-call`).
- **Correlation is a declarative contract.** Injection (correlation id onto the outbound request) and
  extraction (a JSONata/FEEL rule over the inbound reply, e.g. `response.correlationId`) are declared per
  transport, never code ([05](../architecture/05-adapters.md) §11.1). At-least-once submission assumes an
  **Idempotent Receiver**; replies are deduped on `(correlation-id, response messageId)`; batches carry
  **record-level** correlation.
- **Which external system is itself a Decision** — provider selection mirrors "assignment routing is a
  Decision" (§5.3) for humans.
- **Transport profiles as bindings under one interface** ([05](../architecture/05-adapters.md) §11.2),
  named with the **Request-Reply** EIP vocabulary: (a) HTTP sync (degenerate immediate reply), (b) HTTP
  async callback/webhook, (c) HTTP polling, (d) message-queue request-reply (reply-to Return Address +
  correlation-id headers), (e) **SFTP file round-trip** (submit-file / await-response-file; naming-
  convention/manifest + record-level correlation; response-file schema validation). **(a)–(d) ride v1
  adapter bindings; (e) is a design obligation now, implemented post-v1** — the interface is fixed so a v1
  flow can declare an SFTP-round-trip delegation against a stable contract.
- **Failure taxonomy** — no-response timeout, negative-ack, malformed response → **DLQ + Case surfacing**
  ([04](../architecture/04-flow-and-case-layer.md) §2.8; [05](../architecture/05-adapters.md) §11.3); a
  delegation never simply hangs.
- **Audit** — every delegation emits **submitted / ack'd / responded / timed-out** trace events with
  payloads snapshotted per audit policy into the DecisionRecord
  ([08](../architecture/08-audit-and-observability.md) §1.1). **Zone** placement rides the one-way relay
  ([05](../architecture/05-adapters.md) §8).
- **Harness** — `external-task` ships conformance vectors first (submit / response / timeout /
  dup-response / malformed) against a **mock external system**
  ([13](../architecture/13-agent-harness-loops.md) §2.c).

## Alternatives considered

- **Model it as a plain `adapter-call` + a separate `signal/event-wait` step (compose from existing
  primitives). Rejected.** It *looks* sufficient — send, then wait — but it **fragments exactly the
  semantics a delegation must keep together**: the correlation contract binding the reply to the waiting
  instance has no home, the timeout/SLA and the submission are two unrelated steps with no shared
  escalation/compensation, idempotency/dedup on the response is unspecified, and the audit chain shows two
  disconnected events instead of one submitted→responded round-trip. Flow authors would re-derive this
  glue per delegation, inconsistently — the classic case for a first-class step over a fragile idiom.
  (This is the same reasoning that makes `human-task` first-class rather than "createTask activity + a
  bare await.")
- **A raw `compute` step that does the whole round-trip in code. Rejected.** A `compute` activity is
  **pure and runs to completion** ([04](../architecture/04-flow-and-case-layer.md) §2.6); it cannot
  express a durable suspend-for-a-correlated-signal-on-another-adapter under a pausable clock, and burying
  I/O + a multi-day wait in an activity abandons the declarative graph, the correlation contract, the SLA
  machinery, and the audit spine. Purity + determinism forbid it.
- **Misuse `human-task` for machine delegation (a "task" a system resolves). Rejected.** It would ride
  the task-store/assignment/inbox machinery that exists for *human* work — polluting reviewer queues,
  assignment Decisions, and the Portal inbox with non-human items — and still leaves transport,
  correlation, and response-schema validation unmodelled. The right move is a **sibling** canonical step
  that *shares* the await-with-SLA machinery, not an overload of the human one (§5.8).
- **An `x-<org>/delegate` extension step type (§2.7). Rejected.** Delegation is **core, universal
  semantics** (the request-reply EIP), not an org-specific primitive, and it cannot reduce to a
  compute-variant (above). The pluggability the founder asked for is **transport**, which already has its
  own SPI seam beneath the step ([05](../architecture/05-adapters.md) §2) — so the step is canonical and
  the *transport* is the extension point.

## Consequences

Positive:
- One primitive carries correlation + timeout/SLA + idempotency + audit for **every** offload, over
  **any** transport, with the transport as a swappable Adapter binding — HTTP/queue in v1, SFTP file
  round-trip designable now and buildable later without touching the step or any flow that uses it.
- Clean symmetry with `human-task` (§5.8) — one mental model (await-with-SLA, routing-as-a-Decision,
  escalation-as-authored-steps) covers human and machine work items; the DecisionRecord stitches both.
- The request-reply EIP vocabulary ([05](../architecture/05-adapters.md) §4, §11) gives architects and AI
  agents a shared, standard name for the pattern; the "Request-reply over MQ" adapter open question is
  resolved into profile (d).

Negative / costs:
- The interpreter gains another await-shaped step to keep **deterministic under replay** — correlation
  matching and clock/escalation must be replay-safe (mitigated: it reuses the `human-task`/`signal-wait`
  machinery already proven for this, and ships conformance + determinism vectors first, doc 13 §2.c).
- **Transport sprawl is real**: five profiles under one interface means five bindings to build and harden;
  v1 constrains this to HTTP + queue (existing bindings), and SFTP round-trip is **design-only/post-v1** —
  the interface is committed, the implementation is deferred, and that split is stated so it is a
  contract, not a surprise.
- Multi-response (`streamed` / `batch`) completion semantics are only partially settled — the completion
  predicate and partial-batch surfacing are tracked as a doc 04 open question.
- As with all ichiflow-native step kinds, `external-task` does not guarantee round-trip to other CNCF-SWF
  runtimes; its export-degradation contract is the same open question as the other native step types
  (doc 04 open questions).

## References

- [04-flow-and-case-layer.md](../architecture/04-flow-and-case-layer.md) §2.3 (step-type table), §2.8
  (the `external-task` step), §5.8 (machine analog of the human Task), §5.2/§5.3/§5.7 (await-signal, SLA,
  routing-as-a-Decision it mirrors)
- [05-adapters.md](../architecture/05-adapters.md) §4 (EIP vocabulary), §11 (request-reply & the five
  transport profiles), §2 (Adapter-binding SPI), §5 (reliability), §8 (zones)
- [08-audit-and-observability.md](../architecture/08-audit-and-observability.md) §1.1 (adapter I/O streams
  in the DecisionRecord)
- [13-agent-harness-loops.md](../architecture/13-agent-harness-loops.md) §2.c (delegation conformance
  vectors + mock external system)
- Related: [0004](0004-declarative-flow-dsl-on-temporal.md) (the closed canonical step set + `compute`
  hatch + extension step types this decision extends), [0005](0005-first-party-case-and-human-task-module.md)
  (the human `Task` whose await-signal + SLA + routing-as-a-Decision machinery `external-task` reuses)
