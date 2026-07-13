/**
 * TypeScript view of the canonical Flow DSL (build plan 3.1–3.2). The authored source of record is
 * `schemas/flow.tsp` → the emitted `Flow.json` JSON Schema; these types mirror it so the interpreter
 * consumes DSL-validated documents. The interpreter carries a named-variable **blackboard**; each step
 * reads `in` vars and writes its `out` var (doc 04 §2). The step set is closed by design (doc 04 §2.3).
 */
export type Vars = Record<string, number>;

export interface ComputeStep {
  id: string;
  type: "compute";
  /** Versioned code-activity ref `<lang>://<module>/<Name>@<semver>` (doc 04 §2.6). */
  ref: string;
  in: string[];
  out: string;
}

export interface DecisionEvalStep {
  id: string;
  type: "decision-eval";
  decision: string;
  in: string[];
  out: string;
}

export interface HumanTaskStep {
  id: string;
  type: "human-task";
  /** Static assignee/queue; fallback when no `assignmentDecision` routes the Task (doc 04 §5.3). */
  assignee?: string;
  /** DecisionModel routing the assignee/queue — assignment-as-Decision (§5.3). */
  assignmentDecision?: string;
  /** Blackboard vars fed, in order, to the assignment Decision. */
  assignIn?: string[];
  /** Pausable SLA budget (ms); paused intervals are excluded from accounting (§5.7). */
  slaMs: number;
  out: string;
  /** Auto-decide fallback written to `out` when the SLA budget is exhausted (escalation, §5.2). */
  onTimeout: number;
  /** Supervisor queue the Task escalates to on SLA expiry; defaults to `supervisor` (§5.2). */
  escalationQueue?: string;
}

export interface TimerStep {
  id: string;
  type: "timer";
  durationMs: number;
}

export interface IssueDocumentStep {
  id: string;
  type: "issue-document";
  template: string;
  /** Snapshot field → blackboard variable name. */
  binding: Record<string, string>;
  numberAllocation: string;
  lifecycle: { acceptance: "none" | "offer"; slaMs?: number };
  verification: { endpoint: "public"; hash: "sha256" };
  delivery: Array<{ portal: string } | { notify: string }>;
}

/**
 * An `external-task` (delegation) step (doc 04 §2.8, ADR-0028) — the machine analog of `human-task`:
 * submit a schema'd request through an outbound Adapter, durably await a **correlated** inbound reply,
 * validate it, and resume — racing the same pausable SLA + escalation machinery (§5.7/§5.2) and the
 * adapters' Idempotent Receiver / DLQ (doc 05 §11.1). Transport is a pluggable Adapter binding beneath.
 */
export interface ExternalTaskStep {
  id: string;
  type: "external-task";
  /** The outbound submit Adapter / canonical request ref the delegation submits through. */
  requestRef: string;
  /** The canonical response schema id the correlated reply is validated against before resume (§11.1). */
  responseSchema: string;
  in: string[];
  out: string;
  /** The target external system/provider (static in v1). */
  provider?: string;
  /** Pausable SLA budget (ms); paused intervals are excluded, exactly as for `human-task` (§5.7). */
  slaMs: number;
  /** Auto-decide fallback written to `out` when the SLA is exhausted with no correlated reply (§5.2). */
  onTimeout: number;
  /** Supervisor/alternate-provider queue the delegation escalates to on SLA expiry; defaults to `supervisor`. */
  escalationQueue?: string;
}

export type FlowStep =
  | ComputeStep
  | DecisionEvalStep
  | HumanTaskStep
  | TimerStep
  | IssueDocumentStep
  | ExternalTaskStep;

export interface Flow {
  id: string;
  schemaVersion: "flow/v1";
  input: { vars: Vars };
  steps: FlowStep[];
}

/** What a scripted signal does to a `human-task` step (doc 04 §5.2/§5.7). */
export type SignalAction = "resolve" | "pause" | "resume" | "accept" | "decline";

/** A scripted signal delivered to a `human-task` step during interpretation (correlated by `stepId`). */
export interface FlowSignal {
  afterMs: number;
  stepId: string;
  /** `resolve` (default), or `pause`/`resume` the pausable SLA clock (§5.7). */
  action?: SignalAction;
  /** Resolution value (required for `resolve`; ignored for pause/resume). */
  value?: number;
}

/**
 * A scripted **correlated inbound reply** delivered to an `external-task` step (doc 04 §2.8, doc 05 §11.1) —
 * the machine analog of `FlowSignal.resolve`, standing in for the mock external system's response. It
 * correlates only when `correlationId` matches the injected id; `(correlationId, messageId)` is the
 * Idempotent-Receiver dedup key; `malformed` marks a schema-invalid reply → DLQ + Case surfacing.
 */
export interface ExternalReply {
  afterMs: number;
  stepId: string;
  correlationId: string;
  messageId: string;
  value?: number;
  malformed?: boolean;
}

/** The correlation id injected onto one `external-task` submit (doc 05 §11.1) — the key a reply must carry. */
export interface CaseCorrelation {
  stepId: string;
  correlationId: string;
}

/** A conformance vector — a DSL-valid Flow (+ optional signals/replies) paired with the observations it must produce. */
export interface FlowConformanceVector {
  name: string;
  flow: Flow;
  signals?: FlowSignal[];
  /** Correlated inbound replies delivered to `external-task` steps (doc 04 §2.8); omit to exercise the timeout path. */
  replies?: ExternalReply[];
  /** `events` pins the Case/Task event-history type sequence (§5.1/§5.2); `correlations` pins the injected correlation ids (§11.1). */
  expect: {
    vars: Vars;
    steps: number;
    slaMs: number;
    events?: string[];
    correlations?: CaseCorrelation[];
  };
}
