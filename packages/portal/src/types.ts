/**
 * Portal domain types (Phase 4.4, doc 07 §5/§7). The Portal is a back-office audience-scoped surface
 * over the Case/Task module (packages/flow) whose inbox rows and case fields are PDP-filtered using the
 * SAME OpenFGA relation model as the `authz` slice (schemas/authz/model.json) — design-time = runtime,
 * one relation vocabulary (doc 13 §2.f). No wall-clock / RNG anywhere: SLA is a seeded integer.
 */

/** A back-office Task inbox row (doc 07 §5/§7). `dueAtMs` is a seeded deadline — never a live clock. */
export interface Task {
  taskId: string;
  caseId: string;
  /** The `human-task` step id this Task realises (doc 04 §5) — the signal-correlation key. */
  stepId: string;
  title: string;
  /** Seeded SLA deadline (ms). Inbox rows are ordered soonest-due first. */
  dueAtMs: number;
}

/** A Case condition / obligation checklist item (doc 07 §7.1). */
export interface Obligation {
  code: string;
  kind: "blocking" | "post-approval";
  state: "pending" | "fulfilled" | "waived" | "breached";
  deadlineMs: number;
}

/** A Case as the Portal review view consumes it. */
export interface CaseRecord {
  caseId: string;
  title: string;
  applicantName: string;
  /** The active `human-task` step the action form signals (doc 04 §5.2). */
  activeStep: string;
  obligations: Obligation[];
}

/** Field-level entitlement (doc 07 §6/§11): the PDP maps a field to one of these render states. */
export type FieldState = "editable" | "read-only" | "hidden";

/** Per-field verdict the renderer maps to editable / read-only / hidden, carrying the PDP reason. */
export interface FieldEntitlement {
  field: string;
  state: FieldState;
  /** The "why is this hidden/read-only" affordance text — the PDP decision-log reason (doc 07 §6). */
  reason: string;
}

/** An OpenFGA-style relation tuple `(object, relation, user)` — instance data over the relation model. */
export interface RelationTuple {
  object: string;
  relation: string;
  user: string;
}
