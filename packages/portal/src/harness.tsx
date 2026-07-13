import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { assembleDecisionRecord } from "@ichiflow/flow/dist/decisionrecord.js";
import type { DecisionRecord } from "@ichiflow/flow/dist/decisionrecord.js";
import type { FlowResult } from "@ichiflow/flow/dist/interpreter.js";
import { ensureDom } from "./dom.js";
import { Pdp } from "./pdp/engine.js";
import { fieldEntitlements } from "./entitlements.js";
import { Inbox, inboxRows } from "./inbox/inbox.js";
import { CaseView } from "./case/case-view.js";
import type { FlowSignalPayload } from "./case/action-form.js";
import {
  loadActionDataSchema,
  loadActionUiSchema,
  loadAuthzModel,
  loadCaseFlowResults,
  loadCases,
  loadFieldScenarios,
  loadPrincipals,
  loadTasks,
  loadTuples,
} from "./fixtures.js";

/**
 * The deterministic Portal preview harness (doc 13 §2.e). It renders the inbox + case/review view as
 * real React under jsdom, drives the seeded PDP/flows, and emits the signal — then reads the rendered
 * DOM back into a machine-readable results artifact the `portal` verify scope enumerates. No
 * wall-clock, no RNG, no network: every input is a committed fixture; SLA is a seeded integer.
 */

export const PORTAL_SEED = "portal-4.4";

/** The primary Case the review view renders, and the principal who signals it (holds can_modify). */
const REVIEW_CASE_ID = "case:c-100";
const SIGNAL_PRINCIPAL = "user:eve";

export interface InboxResult {
  principal: string;
  crossTeam: boolean;
  expected: string[];
  visible: string[];
  dueOrder: number[];
  orderingOk: boolean;
}

export interface FieldResult {
  principal: string;
  caseId: string;
  states: Record<string, string>;
}

export interface PortalResults {
  seed: string;
  producer: string;
  inbox: InboxResult[];
  crossTeam: {
    principal: string;
    baselinePrincipal: string;
    visibleCount: number;
    baselineCount: number;
    fewer: boolean;
  };
  signal: {
    emitted: boolean;
    principal: string;
    caseId: string;
    payload: FlowSignalPayload | null;
  };
  trace: {
    caseId: string;
    chainComplete: boolean;
    nodeIds: string[];
    record: DecisionRecord;
  };
  fields: FieldResult[];
  uischema: {
    controls: number;
    resolvedControls: number;
    unresolved: string[];
  };
}

function renderSync(node: React.ReactElement): { root: Root; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(node));
  return { root, container };
}

function readInboxDom(container: HTMLElement): { ids: string[]; due: number[] } {
  const items = Array.from(container.querySelectorAll("[data-testid='inbox-rows'] > li"));
  return {
    ids: items.map((li) => li.getAttribute("data-task-id") ?? ""),
    due: items.map((li) => Number(li.getAttribute("data-due-at-ms") ?? "NaN")),
  };
}

function readFieldStates(container: HTMLElement): Record<string, string> {
  const states: Record<string, string> = {};
  for (const el of Array.from(container.querySelectorAll("[data-field]"))) {
    const field = el.getAttribute("data-field");
    const state = el.getAttribute("data-field-state");
    if (field && state) states[field] = state;
  }
  return states;
}

/** Which Control scopes in the interim uischema resolve against the action data schema (drift-lite). */
function checkUiSchemaResolution(
  uischema: Record<string, unknown>,
  dataSchema: Record<string, unknown>,
): { controls: number; resolvedControls: number; unresolved: string[] } {
  const props = (dataSchema.properties ?? {}) as Record<string, unknown>;
  const elements = Array.isArray(uischema.elements) ? uischema.elements : [];
  const controls = elements.filter((e) => (e as { type?: string }).type === "Control") as {
    scope?: string;
  }[];
  const unresolved: string[] = [];
  for (const c of controls) {
    const field = (c.scope ?? "").split("/").pop() ?? "";
    if (!(field in props)) unresolved.push(c.scope ?? "");
  }
  return {
    controls: controls.length,
    resolvedControls: controls.length - unresolved.length,
    unresolved,
  };
}

export function runHarnessSync(): PortalResults {
  const model = loadAuthzModel();
  const tuples = loadTuples();
  const tasks = loadTasks();
  const cases = loadCases();
  const principals = loadPrincipals();
  const scenarios = loadFieldScenarios();
  const dataSchema = loadActionDataSchema();
  const uischema = loadActionUiSchema();
  const flowResults = loadCaseFlowResults();

  const pdp = new Pdp(model, tuples);
  const caseById = new Map(cases.map((c) => [c.caseId, c]));

  // 1. Inbox — render each principal's PDP-filtered, SLA-ordered rows and read the DOM back.
  const inbox: InboxResult[] = principals.map((p) => {
    const rows = inboxRows(pdp, p.id, tasks);
    const { root, container } = renderSync(
      createElement(Inbox, { principal: p.id, rows, selectedTaskId: rows[0]?.taskId }),
    );
    const dom = readInboxDom(container);
    flushSync(() => root.unmount());
    container.remove();
    const orderingOk = dom.due.every((d, i) => i === 0 || dom.due[i - 1]! <= d);
    return {
      principal: p.id,
      crossTeam: p.crossTeam,
      expected: p.expectedInbox,
      visible: dom.ids,
      dueOrder: dom.due,
      orderingOk,
    };
  });

  const baseline = inbox.find((r) => !r.crossTeam)!;
  const cross = inbox.find((r) => r.crossTeam)!;

  // 2. Decision trace — assemble the DecisionRecord for the review case from packages/flow.
  const flowResult = flowResults[REVIEW_CASE_ID] as unknown as FlowResult;
  const record = assembleDecisionRecord(flowResult);
  const nodeIds = [
    ...record.events.map((e) => `event:${e.seq}:${e.type}`),
    ...record.decisions.map((d) => `decision:${d.stepId}`),
    ...record.tasks.map((t) => `task:${t.stepId}`),
  ];

  const reviewCase = caseById.get(REVIEW_CASE_ID)!;

  // 3. Action form — render the review case for the signalling principal and click submit.
  let captured: FlowSignalPayload | null = null;
  const signalEntitlements = fieldEntitlements(pdp, SIGNAL_PRINCIPAL, REVIEW_CASE_ID);
  const { root: caseRoot, container: caseContainer } = renderSync(
    createElement(CaseView, {
      caseRecord: reviewCase,
      record,
      schema: dataSchema,
      uischema,
      entitlements: signalEntitlements,
      initialData: { applicantName: reviewCase.applicantName, decision: 1, reviewerNote: "" },
      onSignal: (s: FlowSignalPayload) => {
        captured = s;
      },
    }),
  );
  const submit = caseContainer.querySelector("[data-testid='action-submit']") as HTMLElement | null;
  flushSync(() => {
    submit?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  flushSync(() => caseRoot.unmount());
  caseContainer.remove();

  // 4. Field entitlements — render each scenario and read the rendered field states.
  const fields: FieldResult[] = scenarios.map((sc) => {
    const caseRecord = caseById.get(sc.caseId)!;
    const ents = fieldEntitlements(pdp, sc.principal, sc.caseId);
    const { root, container } = renderSync(
      createElement(CaseView, {
        caseRecord,
        record,
        schema: dataSchema,
        uischema,
        entitlements: ents,
        initialData: { applicantName: caseRecord.applicantName, decision: 1, reviewerNote: "" },
        onSignal: () => {},
      }),
    );
    const states = readFieldStates(container);
    flushSync(() => root.unmount());
    container.remove();
    return { principal: sc.principal, caseId: sc.caseId, states };
  });

  return {
    seed: PORTAL_SEED,
    producer: "pnpm portal:preview",
    inbox,
    crossTeam: {
      principal: cross.principal,
      baselinePrincipal: baseline.principal,
      visibleCount: cross.visible.length,
      baselineCount: baseline.visible.length,
      fewer: cross.visible.length < baseline.visible.length,
    },
    signal: {
      emitted: captured !== null,
      principal: SIGNAL_PRINCIPAL,
      caseId: REVIEW_CASE_ID,
      payload: captured,
    },
    trace: {
      caseId: record.caseId,
      chainComplete: record.chainComplete,
      nodeIds,
      record,
    },
    fields,
    uischema: checkUiSchemaResolution(uischema, dataSchema),
  };
}

export async function runHarness(): Promise<PortalResults> {
  await ensureDom();
  return runHarnessSync();
}
