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
 * A `human-task` step — raise a Task and block until resolved (doc 04 §5.2). Modelled as a `createTask`
 * activity plus an **await-signal raced by an SLA timer**: a resolution signal writes its value to `out`;
 * if the SLA fires first the task **escalates** and `onTimeout` is written instead. Time-skip makes a
 * month-long SLA verify in milliseconds.
 */
model HumanTaskStep extends FlowStep {
  type: "human-task";

  /** Optional assignee/queue hint (assignment-as-Decision is Phase 3.3; here it is a passthrough label). */
  assignee?: string;

  /** SLA in milliseconds; when it elapses before a resolution signal, the task escalates. */
  @minValue(0)
  slaMs: int64;

  /** Blackboard variable the resolution (or `onTimeout`) value is written to. */
  out: string;

  /** Value written to `out` when the SLA fires before a resolution signal (the escalation path). */
  onTimeout: float64;
}

/** A `timer` / SLA step — a durable wait. A Temporal timer; deterministic in the interpreter, fast-forwarded under time-skip (doc 04 §2.3). */
model TimerStep extends FlowStep {
  type: "timer";

  /** Wait duration in milliseconds. Integer so the DSL stays parse-free (thus deterministic). */
  @minValue(0)
  durationMs: int64;
}

/** The initial data a Flow is started with — a named-variable blackboard the steps read and write. */
model FlowInput {
  /** The initial blackboard: variable name → numeric value. */
  vars: Record<float64>;
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
  steps: (ComputeStep | DecisionEvalStep | HumanTaskStep | TimerStep)[];
}

/** A scripted resolution signal a conformance vector delivers to a `human-task` step (correlated by `stepId`). */
model FlowSignal {
  /** Test-clock offset (ms from flow start) at which the signal is delivered. */
  @minValue(0)
  afterMs: int64;

  /** The `human-task` step id this signal resolves. */
  stepId: string;

  /** The resolution value written to the step's `out` variable. */
  value: float64;
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
}
