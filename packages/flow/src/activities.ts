/**
 * The activity boundary of the flow layer (doc 04 §2.2): all non-determinism lives here so the
 * interpreter workflow stays deterministic. Phase 3.2 wires the two dispatch registries the core step
 * types resolve against — the unified **code-activity** contract (`compute`, doc 04 §2.6) and the
 * **decision** engine (`decision-eval`, doc 04 §2.3, standing in for the Kotlin rule-eval SPI worker) —
 * plus `createTask` for `human-task` and the issuance service activities for `issue-document`.
 */

import { IssuanceService, type DocumentDelivery, type Doctemplate } from "@ichiflow/issuance";

/** A registered code activity: a total, pure numeric transform addressed by a versioned `ref`. */
export type CodeActivity = (args: number[]) => number;

/** A registered decision: a pure evaluation returning a typed Outcome (doc 03 §2). */
export type Decision = (args: number[]) => { outcomeType: string; value: number };

/**
 * The code-activity registry, keyed by the versioned `ref` (`<lang>://<module>/<Name>@<semver>`,
 * doc 04 §2.6). These are the schema'd-boundary transforms a `compute` step dispatches to; the same
 * unified contract is reused by decision feature-functions and adapter code-transforms.
 */
export const CODE_ACTIVITIES: Record<string, CodeActivity> = {
  "ts://flow-kit/Double@1.0.0": (a) => a[0]! * 2,
  "ts://flow-kit/Increment@1.0.0": (a) => a[0]! + 1,
  "ts://flow-kit/Identity@1.0.0": (a) => a[0]!,
  "ts://flow-kit/Sum@1.0.0": (xs) => xs.reduce((a, b) => a + b, 0),
  "ts://flow-kit/Negate@1.0.0": (a) => -a[0]!,
};

/**
 * The decision registry, keyed by DecisionModel id — the pure stand-in for the SPI rule-eval worker.
 * `assignment-*` DecisionModels implement "assignment routing is itself a Decision" (doc 04 §5.3):
 * their `outcomeType` is the routed assignee/queue that a `human-task` step's `assignmentDecision` binds.
 */
export const DECISIONS: Record<string, Decision> = {
  "threshold-approval": (a) =>
    a[0]! >= 50 ? { outcomeType: "APPROVE", value: 1 } : { outcomeType: "DECLINE", value: 0 },
  // Routes by workload/amount to a tier queue — the assignee is the Decision's outcome (§5.3).
  "assignment-by-amount": (a) =>
    a[0]! >= 1000
      ? { outcomeType: "underwriting-tier2", value: 2 }
      : { outcomeType: "underwriting-tier1", value: 1 },
};

/** Guard the code-activity boundary: unknown refs and non-finite I/O are rejected (schema'd-boundary + purity, doc 04 §2.6). */
export function runCodeActivity(ref: string, args: number[]): number {
  const fn = CODE_ACTIVITIES[ref];
  if (!fn) throw new Error(`unknown code-activity ref: ${ref}`);
  if (!args.every((a) => Number.isFinite(a))) {
    throw new Error(`code-activity ${ref}: non-finite input ${JSON.stringify(args)}`);
  }
  const out = fn(args);
  if (!Number.isFinite(out)) throw new Error(`code-activity ${ref}: non-finite output ${out}`);
  return out;
}

export function runDecision(
  decision: string,
  args: number[],
): { outcomeType: string; value: number } {
  const fn = DECISIONS[decision];
  if (!fn) throw new Error(`unknown decision: ${decision}`);
  return fn(args);
}

/** `compute` activity — dispatch to a versioned code activity over its schema'd numeric boundary. */
export async function compute(input: { ref: string; args: number[] }): Promise<{ result: number }> {
  return { result: runCodeActivity(input.ref, input.args) };
}

/** `decision-eval` activity — evaluate a DecisionModel behind the SPI and return its typed Outcome. */
export async function decisionEval(input: {
  decision: string;
  args: number[];
}): Promise<{ outcomeType: string; value: number }> {
  return runDecision(input.decision, input.args);
}

/** `createTask` activity — raise a human Task (the non-deterministic side effect); resolution arrives by signal. */
export async function createTask(input: {
  stepId: string;
  assignee?: string;
}): Promise<{ taskId: string; assignee: string }> {
  return { taskId: `task:${input.stepId}`, assignee: input.assignee ?? "unassigned" };
}

const issuance = new IssuanceService();

function templateFor(ref: string, snapshot: Record<string, unknown>): Doctemplate {
  const at = ref.lastIndexOf("@");
  if (at < 1) throw new Error(`invalid doctemplate ref: ${ref}`);
  const id = ref.slice(0, at);
  const version = ref.slice(at + 1);
  const fields = Object.keys(snapshot).sort();
  return {
    kind: "doctemplate",
    schemaVersion: "doctemplate/v1",
    metadata: { id, version, governanceState: "released", ownerTeam: "flow-runtime" },
    engine: "typst",
    dataSchema: `schema://flow/${id}/1`,
    binds: Object.fromEntries(fields.map((field) => [field, `\${snapshot.${field}}`])),
    content: fields.map((field) => `${field}: \${${field}}`).join("\n"),
    accessibility: { pdfua: true, textContrast: 7, uiContrast: 4.5 },
  };
}

function allocationFor(ref: string): {
  id: string;
  version: string;
  semantics: "gapped";
  prefix: string;
  width: number;
  startsAt: number;
} {
  const label = ref.split("/").filter(Boolean).at(-1) ?? "document";
  return {
    id: ref,
    version: "1.0.0",
    semantics: "gapped",
    prefix: `${label.toUpperCase().replaceAll(/[^A-Z0-9]/g, "-")}-`,
    width: 6,
    startsAt: 1,
  };
}

/** Allocate → render → issue → deliver. The service memo is keyed by `(caseId, stepId)`. */
export async function issueDocument(input: {
  caseId: string;
  stepId: string;
  template: string;
  snapshot: Record<string, unknown>;
  numberAllocation: string;
  acceptance: "none" | "offer";
  delivery: DocumentDelivery[];
  issuedAt: string;
}): Promise<{
  referenceNumber: string;
  verificationHash: string;
  status: "issued";
  events: string[];
}> {
  const before = issuance.events().length;
  const result = issuance.issue({
    caseId: input.caseId,
    stepId: input.stepId,
    documentType: input.template.slice(0, input.template.lastIndexOf("@")),
    issuedAt: input.issuedAt,
    template: templateFor(input.template, input.snapshot),
    snapshot: input.snapshot,
    allocation: allocationFor(input.numberAllocation),
    acceptance: input.acceptance,
    delivery: input.delivery,
  });
  return {
    referenceNumber: result.document.referenceNumber,
    verificationHash: result.document.verificationHash,
    status: "issued",
    events: issuance
      .events()
      .slice(before)
      .map((event) => event.type),
  };
}

export async function acceptDocument(input: {
  referenceNumber: string;
}): Promise<{ status: "accepted" }> {
  issuance.accept(input.referenceNumber);
  return { status: "accepted" };
}

export const activities = {
  compute,
  decisionEval,
  createTask,
  issueDocument,
  acceptDocument,
};
