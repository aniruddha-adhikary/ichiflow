import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The canonical ichiflow **Flow DSL** (build plan 3.1–3.2; doc 04 §2, ADR-0004). A Flow is a
 * declarative, schema-validated document — *not* Temporal workflow code — that a single generic
 * **interpreter workflow** walks deterministically, pushing all non-determinism into activities
 * (doc 04 §2.2). The step set is **closed by design** so the deterministic interpreter understands
 * every step it must replay; genuinely new kinds are additive at a declared seam, never a fork to the
 * raw SDK.
 *
 * The interpreter carries a named-variable **blackboard** (`input.vars`); each step reads declared
 * `in` vars and writes its `out` var, so a flow is a deterministic fold over that blackboard. Phase 3.2
 * ships the core catalogue the interpreter executes deterministically:
 *   - `compute` — a typed **code activity** referenced by a versioned `ref` with a schema'd I/O boundary
 *     (doc 04 §2.6); the unified code-activity contract also reused by decision feature-functions and
 *     adapter transforms.
 *   - `decision-eval` — evaluate a **DecisionModel** and annotate the blackboard with its typed Outcome
 *     (doc 04 §2.3; the real engine is the Kotlin rule-eval activity behind the SPI).
 *   - `human-task` — raise a Task and block on **await-signal raced by an SLA timer** (doc 04 §5.2):
 *     resolve on signal, else escalate when the SLA fires.
 *   - `timer` — a durable SLA wait; a Temporal timer, fast-forwarded under time-skip.
 *   - `issue-document` — allocate once, deterministically render through the rendering SPI, issue,
 *     deliver, and optionally await offer acceptance under the pausable clock (doc 04 §2.9).
 * The remaining catalogue (`adapter-call`, `parallel`, `sub-flow`, …; doc 04 §2.3) lands additively.
 */
@jsonSchema
namespace Ichiflow.Flow;

/** The pinned DSL schema version a Flow declares; the interpreter validates against the version it declares (doc 04 §2.2, two-version-axes). */
union FlowSchemaVersion {
  v1: "flow/v1",
}

/**
 * The base of every Flow step. Steps carry a stable `id` (used for durable-side-effect memoization and
 * as the trace key) and a `type` discriminator so the deterministic interpreter dispatches without
 * ambiguity (doc 04 §2.3).
 */
@discriminator("type")
model FlowStep {
  /** Stable, flow-unique step identifier — the ordering/trace/idempotency/signal-correlation key. */
  id: string;

  type: string;
}

/**
 * A `compute` step — a typed **code activity** for computation neither a Decision nor an Adapter owns
 * (doc 04 §2.6). Referenced by a versioned, language-parameterised `ref` (`<lang>://<module>/<Name>@<semver>`)
 * over a schema'd I/O boundary; runs as an activity (the non-determinism boundary) and emits a trace.
 */
model ComputeStep extends FlowStep {
  type: "compute";

  /** The versioned code-activity reference: `<lang>://<module>/<Name>@<major>.<minor>.<patch>` (doc 04 §2.6). */
  @pattern("^(kt|ts|py)://[A-Za-z0-9._-]+/[A-Za-z0-9._-]+@[0-9]+[.][0-9]+[.][0-9]+$")
  ref: string;

  /** Blackboard variables passed, in order, as the code activity's inputs. */
  @minItems(1)
  `in`: string[];

  /** Blackboard variable the code activity's result is written to. */
  out: string;
}

/**
 * A `decision-eval` step — evaluate a DMN **DecisionModel** and annotate the blackboard with its typed
 * Outcome (doc 04 §2.3). The value facet of the Outcome is written to `out`; the outcome type is
 * recorded on the trace. In production this is an activity on the Kotlin rule-eval queue behind the SPI.
 */
model DecisionEvalStep extends FlowStep {
  type: "decision-eval";

  /** The DecisionModel identifier to evaluate. */
  decision: string;

  /** Blackboard variables passed, in order, as the decision's inputs. */
  @minItems(1)
  `in`: string[];

  /** Blackboard variable the decision's value facet is written to. */
  out: string;
}

/**
 * A `human-task` step — the first-party Case/Task module's manual-review primitive (doc 04 §5.2): a
 * `createTask` activity, then an **await-signal raced by a pausable SLA timer**. Phase 3.3 adds the Case
 * layer around it:
 *   - **assignment-as-Decision** (§5.3): when `assignmentDecision` is set, the assignee/queue is *routed*
 *     by evaluating that DecisionModel over `assignIn` (governed like any Decision) rather than a static
 *     `assignee` label.
 *   - **pausable SLA** (§5.7): a `pause` signal (task enters `awaiting-applicant`) stops the SLA clock and
 *     a `resume` signal restarts it; the paused interval is excluded from SLA accounting and recorded as
 *     distinct clock-stop events. Time-skip makes a month-long budget verify in milliseconds.
 *   - **escalation** (§5.2): if the budget is exhausted before resolution, the task **escalates** to
 *     `escalationQueue` (supervisor) and `onTimeout` is written to `out` as the auto-decide fallback.
 */
model HumanTaskStep extends FlowStep {
  type: "human-task";

  /** Static assignee/queue label; the fallback when no `assignmentDecision` routes the Task (§5.3). */
  assignee?: string;

  /** DecisionModel that routes the assignee/queue — "assignment routing is itself a Decision" (§5.3). */
  assignmentDecision?: string;

  /** Blackboard variables passed, in order, to the assignment Decision. */
  assignIn?: string[];

  /** Pausable SLA budget in milliseconds (§5.7); paused intervals are excluded from this accounting. */
  @minValue(0)
  slaMs: int64;

  /** Blackboard variable the resolution (or escalation `onTimeout`) value is written to. */
  out: string;

  /** Auto-decide fallback value written to `out` when the SLA budget is exhausted (the escalation path, §5.2). */
  onTimeout: float64;

  /** Supervisor queue the Task escalates to on SLA expiry; defaults to `supervisor` (§5.2 escalation chain). */
  escalationQueue?: string;
}

/** A `timer` / SLA step — a durable wait. A Temporal timer; deterministic in the interpreter, fast-forwarded under time-skip (doc 04 §2.3). */
model TimerStep extends FlowStep {
  type: "timer";

  /** Wait duration in milliseconds. Integer so the DSL stays parse-free (thus deterministic). */
  @minValue(0)
  durationMs: int64;
}

union DocumentAcceptanceMode {
  none: "none",
  offer: "offer",
}

model IssueDocumentLifecycle {
  acceptance: DocumentAcceptanceMode;

  /** Offer-acceptance SLA budget in milliseconds; required by offer vectors. */
  @minValue(0)
  slaMs?: int64;
}

model IssueDocumentVerification {
  endpoint: "public";
  hash: "sha256";
}

model PortalDelivery {
  portal: string;
}

model NotificationDelivery {
  notify: string;
}

/**
 * Canonical issuance step (ADR-0029): interpreter-owned, exactly-once-memoized allocation and
 * lifecycle, with pure rendering dispatched beneath it through the rendering SPI.
 */
model IssueDocumentStep extends FlowStep {
  type: "issue-document";

  @pattern("^[A-Za-z0-9._-]+@[0-9]+[.][0-9]+[.][0-9]+$")
  template: string;

  /** Snapshot field → numeric blackboard-variable name. */
  binding: Record<string>;

  @pattern("^allocation://[A-Za-z0-9._/-]+$")
  numberAllocation: string;

  lifecycle: IssueDocumentLifecycle;
  verification: IssueDocumentVerification;

  @minItems(1)
  delivery: (PortalDelivery | NotificationDelivery)[];
}

/** The initial data a Flow is started with — a named-variable blackboard the steps read and write. */
model FlowInput {
  /** The initial blackboard: variable name → numeric value. */
  vars: Record<float64>;
}

/** The action a scripted signal performs against a `human-task` step (doc 04 §5.2, §5.7). */
union SignalAction {
  /** Resolve the Task with `value` (the reviewer's outcome). */
  resolve: "resolve",

  /** Enter `awaiting-applicant` — pause (clock-stop) the SLA (§5.7). */
  pause: "pause",

  /** Leave `awaiting-applicant` — resume the SLA clock (§5.7). */
  resume: "resume",

  /** Accept an offer-type issued Document. */
  accept: "accept",

  /** Decline an offer-type issued Document. */
  decline: "decline",
}

/**
 * A canonical Flow document (doc 04 §2). Ordered `steps` are walked in sequence by the generic
 * interpreter; the closed step set is what makes deterministic replay tractable.
 */
model Flow {
  /** Flow definition identifier. */
  id: string;

  schemaVersion: FlowSchemaVersion;

  input: FlowInput;

  @minItems(1)
  steps: (ComputeStep | DecisionEvalStep | HumanTaskStep | TimerStep | IssueDocumentStep)[];
}

/** A scripted signal a conformance vector delivers to a `human-task` step (correlated by `stepId`, doc 04 §5.2/§5.7). */
model FlowSignal {
  /** Test-clock offset (ms from flow start) at which the signal is delivered. */
  @minValue(0)
  afterMs: int64;

  /** The `human-task` step id this signal targets. */
  stepId: string;

  /** What the signal does: `resolve` (default), or `pause`/`resume` the pausable SLA clock (§5.7). */
  action?: SignalAction;

  /** The resolution value written to the step's `out` variable (required for `resolve`; ignored for pause/resume). */
  value?: float64;
}

/**
 * One **conformance vector** (build plan 3.1–3.2 exit criterion). Pairs a DSL-valid Flow — plus any
 * scripted resolution `signals` — with the final blackboard the generic interpreter must produce, an
 * independently-pinned oracle proving the interpreter walks/orders/dispatches/awaits correctly rather
 * than merely being self-consistent.
 */
model FlowConformanceVector {
  /** Human-readable vector name; doubles as intent documentation. */
  name: string;

  flow: Flow;

  /** Resolution signals delivered to `human-task` steps during interpretation; omit to exercise the SLA-escalation path. */
  signals?: FlowSignal[];

  expect: FlowExpectation;
}

/** The pinned expected observations of interpreting a conformance vector's Flow. */
model FlowExpectation {
  /** The final blackboard the interpreter must return: variable name → value. */
  vars: Record<float64>;

  /** The number of steps the flow declares (guards vector/flow drift). */
  steps: int32;

  /** Total scheduled SLA/timer duration in milliseconds across the flow (timer steps + escalated human-tasks). */
  slaMs: int64;

  /** Optional pinned Case/Task **event-history** type sequence (doc 04 §5.1/§5.2), e.g. `["case.created", "task.created", …]`. */
  events?: string[];
}

/**
 * One ordered **Case/Task event** (doc 04 §5.1/§5.2) — the flow event history the DecisionRecord
 * stitches by `case_id`: `case.created`, `task.created`/`task.assigned`, `sla.paused`/`sla.resumed`,
 * `task.resolved`/`task.escalated`, `case.resolved`.
 */
model CaseEvent {
  /** Monotonic in-Case sequence number (ordering key). */
  @minValue(0)
  seq: int32;

  /** The event type, e.g. `task.assigned`. */
  type: string;

  /** The `human-task` step this event belongs to (Task-scoped events only). */
  stepId?: string;

  /** The routed assignee/queue (on `task.assigned`) or escalation queue (on `task.escalated`). */
  assignee?: string;

  /** Allocated Document reference for issuance lifecycle events. */
  referenceNumber?: string;

  /** Current Document status on issuance lifecycle events. */
  documentStatus?: string;

  /** Document verification identity on issuance lifecycle events. */
  verificationHash?: string;
}

/**
 * One typed **trace entry** per executed step (doc 04 §2.6) — the audit-spine material the
 * DecisionRecord stitches: `decision-eval` entries carry the fired `decision` + `outcomeType`,
 * `human-task` entries carry the `resolution` + routed `assignee`.
 */
model FlowTraceEntry {
  /** The step id this entry records (correlation key into the flow + event history). */
  stepId: string;

  /** The step type: `compute` | `decision-eval` | `human-task` | `timer`. */
  type: string;

  /** Blackboard variable written (compute/decision-eval/human-task). */
  out?: string;

  /** The numeric value written to `out`. */
  value?: float64;

  /** The versioned code-activity ref (compute steps). */
  ref?: string;

  /** The evaluated DecisionModel id (decision-eval steps). */
  decision?: string;

  /** The Decision's typed Outcome type (decision-eval steps). */
  outcomeType?: string;

  /** How a `human-task` settled — `resolved` by signal or `escalated` on SLA exhaustion. */
  resolution?: TaskResolution;

  /** The durable wait duration (timer steps). */
  durationMs?: int64;

  /** The routed assignee/queue (human-task steps). */
  assignee?: string;

  /** The allocated issued-Document reference (`issue-document`). */
  referenceNumber?: string;

  /** Current issued-Document lifecycle state (`issue-document`). */
  documentStatus?: string;

  /** SHA-256 verification identity (`issue-document`). */
  verificationHash?: string;
}

/** How a `human-task` Task settled (doc 04 §5.2) — resolved by signal, or escalated on SLA exhaustion. */
union TaskResolution {
  resolved: "resolved",
  escalated: "escalated",
}

/**
 * The interpreter's output contract (doc 04 §2/§5) — the deterministic result of walking a Flow: the
 * final blackboard, the scheduled SLA total, the per-step `trace`, and the ordered Case/Task `events`,
 * all keyed by the Case's global `caseId`. This is the source material the DecisionRecord assembles.
 */
model FlowResult {
  flowId: string;

  /** The Case's global `case_id` (doc 04 §5.1). */
  caseId: string;

  @minValue(0)
  steps: int32;

  /** The final blackboard: variable name → value. */
  vars: Record<float64>;

  /** Total scheduled SLA/timer duration in milliseconds. */
  slaMs: int64;

  trace: FlowTraceEntry[];

  events: CaseEvent[];
}
