import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The canonical ichiflow **Flow DSL** (build plan 3.1; doc 04 §2, ADR-0004). A Flow is a declarative,
 * schema-validated document — *not* Temporal workflow code — that a single generic **interpreter
 * workflow** walks deterministically, pushing all non-determinism into activities (doc 04 §2.2). The
 * step set is **closed by design** so the deterministic interpreter understands every step it must
 * replay; genuinely new kinds are additive at a declared seam, never a fork to the raw SDK.
 *
 * Phase 3.1 is the walking skeleton: the envelope + the two step kinds the interpreter already
 * executes deterministically — `compute` (a pure code-activity) and `timer` (an SLA/durable wait).
 * The remaining catalogue (`decision-eval`, `human-task`, …; doc 04 §2.3) lands in Phase 3.2+ as
 * additive members of the discriminated union, each shipping its conformance vectors first.
 */
@jsonSchema
namespace Ichiflow.Flow;

/** The pinned DSL schema version a Flow declares; the interpreter validates against the version it declares (doc 04 §2.2, two-version-axes). */
union FlowSchemaVersion {
  v1: "flow/v1",
}

/** The closed set of pure `compute` transforms the skeleton interpreter's code-activity supports (doc 04 §2.6). */
union ComputeOp {
  double: "double",
  increment: "inc",
  identity: "identity",
}

/**
 * The base of every Flow step. Steps carry a stable `id` (used for durable-side-effect memoization and
 * as the trace key) and a `type` discriminator so the deterministic interpreter dispatches without
 * ambiguity (doc 04 §2.3).
 */
@discriminator("type")
model FlowStep {
  /** Stable, flow-unique step identifier — the ordering/trace/idempotency key. */
  id: string;

  type: string;
}

/**
 * A `compute` step — a pure code-activity that reshapes inter-step data (doc 04 §2.6). Runs as an
 * activity (the non-determinism boundary), so the interpreter body stays deterministic.
 */
model ComputeStep extends FlowStep {
  type: "compute";

  `op`: ComputeOp;
}

/** A `timer` / SLA step — a durable wait. A Temporal timer; deterministic in the interpreter, fast-forwarded under time-skip (doc 04 §2.3). */
model TimerStep extends FlowStep {
  type: "timer";

  /** Wait duration in milliseconds. Integer so the DSL stays parse-free (thus deterministic). */
  @minValue(0)
  durationMs: int64;
}

/** The initial data a Flow is started with. Skeleton flows carry a single numeric accumulator the compute steps fold over. */
model FlowInput {
  value: float64;
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
  steps: (ComputeStep | TimerStep)[];
}

/**
 * One skeleton **conformance vector** (build plan 3.1 exit criterion). Pairs a DSL-valid Flow with the
 * result the generic interpreter must produce for it — an independently-pinned oracle, so the harness
 * proves the interpreter walks/orders/dispatches correctly, not merely that it is self-consistent.
 */
model FlowConformanceVector {
  /** Human-readable vector name; doubles as intent documentation. */
  name: string;

  flow: Flow;

  expect: FlowExpectation;
}

/** The pinned expected observations of interpreting a conformance vector's Flow. */
model FlowExpectation {
  /** The final accumulator value the interpreter must return. */
  result: float64;

  /** The number of steps the flow declares (guards vector/flow drift). */
  steps: int32;

  /** Total scheduled SLA/timer duration in milliseconds across the flow. */
  slaMs: int64;
}
