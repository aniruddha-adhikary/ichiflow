/**
 * The activity boundary of the flow layer (doc 04 §2.2): all non-determinism lives here so the
 * interpreter workflow stays deterministic. Phase 3.2 wires the two dispatch registries the core step
 * types resolve against — the unified **code-activity** contract (`compute`, doc 04 §2.6) and the
 * **decision** engine (`decision-eval`, doc 04 §2.3, standing in for the Kotlin rule-eval SPI worker) —
 * plus `createTask` for `human-task`. Phase 5.2 adds `submitExternalTask` for the `external-task`
 * (delegation) step, which rides the adapter runtime's canonical↔wire Message-Translator (5.1).
 */

import { translate } from "@ichiflow/adapters/dist/mapping.js";
import type { CanonicalEnvelope, Mapping } from "@ichiflow/adapters/dist/types.js";

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

/**
 * The outbound Message-Translator for an `external-task` submit (doc 05 §2/§11.1) — copies the numeric
 * request args verbatim and, crucially, injects the interpreter's correlation id via `correlationFrom`
 * so the mock external system's reply can be correlated back. Reused from the adapter runtime (5.1) so
 * the delegation submit rides the *same* canonical↔wire boundary rather than a bespoke encoder.
 */
const EXTERNAL_SUBMIT_MAPPING: Mapping = {
  id: "flow/external-task-submit",
  schemaVersion: "adapter/v1",
  version: "1.0.0",
  direction: "outbound",
  kind: "Command",
  canonicalType: "flow.external-task.submit",
  messageIdFrom: "/messageId",
  correlationFrom: "/correlationId",
  caseIdFrom: "/caseId",
  rules: [
    { operation: "copy", from: "/requestRef", to: "request.ref" },
    { operation: "copy", from: "/provider", to: "request.provider" },
    { operation: "copy", from: "/args", to: "request.args" },
  ],
};

/**
 * `submitExternalTask` activity — submit a delegation request through the (mock) outbound Adapter (§2.8).
 * Deterministic and side-effect-free against the mock: it encodes the request into a `CanonicalEnvelope`
 * with the injected correlation id (doc 05 §11.1) and returns it; no live broker/HTTP is contacted.
 */
export async function submitExternalTask(input: {
  stepId: string;
  requestRef: string;
  correlationId: string;
  provider: string;
  args: number[];
}): Promise<{ envelope: CanonicalEnvelope }> {
  const envelope = translate(EXTERNAL_SUBMIT_MAPPING, {
    messageId: `submit:${input.correlationId}`,
    correlationId: input.correlationId,
    caseId: input.correlationId.split("/")[0]!,
    requestRef: input.requestRef,
    provider: input.provider,
    args: input.args,
  });
  return { envelope };
}

export const activities = { compute, decisionEval, createTask, submitExternalTask };
