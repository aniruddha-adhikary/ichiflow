import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import { Pdp } from "../src/pdp/engine.js";
import { fieldEntitlements } from "../src/entitlements.js";
import { Inbox, inboxRows } from "../src/inbox/inbox.js";
import { CaseView } from "../src/case/case-view.js";
import { buildSignal } from "../src/case/action-form.js";
import {
  loadAuthzModel,
  loadCaseFlowResults,
  loadCases,
  loadTasks,
  loadTuples,
  loadActionDataSchema,
  loadActionUiSchema,
} from "../src/fixtures.js";
import { assembleDecisionRecord } from "@ichiflow/flow/dist/decisionrecord.js";
import type { FlowResult } from "@ichiflow/flow/dist/interpreter.js";

afterEach(() => cleanup());

const pdp = () => new Pdp(loadAuthzModel(), loadTuples());

describe("Pdp relation engine", () => {
  it("reuses the authz relation vocabulary: editor ⇒ can_view/can_modify, viewer ⇒ can_view only", () => {
    const p = pdp();
    expect(p.check("user:eve", "can_view", "case:c-100")).toBe(true);
    expect(p.check("user:eve", "can_modify", "case:c-100")).toBe(true);
    expect(p.check("user:vic", "can_view", "case:c-100")).toBe(true);
    expect(p.check("user:vic", "can_modify", "case:c-100")).toBe(false);
  });

  it("filters cross-team: a partner-only principal cannot see a trade case", () => {
    const p = pdp();
    expect(p.check("user:pat", "can_view", "case:c-101")).toBe(true);
    expect(p.check("user:pat", "can_view", "case:c-100")).toBe(false);
  });

  it("resolves association readers across the invgroup", () => {
    const p = pdp();
    expect(p.check("user:iris", "can_view", "case:c-100")).toBe(true);
    expect(p.check("user:iris", "can_view", "case:c-101")).toBe(true);
    expect(p.check("user:iris", "can_modify", "case:c-100")).toBe(false);
  });
});

describe("inbox — PDP filtering + SLA ordering", () => {
  it("shows only permitted rows, soonest-due first", () => {
    const p = pdp();
    const tasks = loadTasks();
    expect(inboxRows(p, "user:eve", tasks).map((t) => t.taskId)).toEqual([
      "t-500",
      "t-1000",
      "t-3000",
    ]);
    expect(inboxRows(p, "user:pat", tasks).map((t) => t.taskId)).toEqual(["t-2000", "t-4000"]);
  });

  it("renders rows in SLA order in the DOM", () => {
    const p = pdp();
    const rows = inboxRows(p, "user:iris", loadTasks());
    const { container } = render(createElement(Inbox, { principal: "user:iris", rows }));
    const ids = Array.from(container.querySelectorAll("[data-testid='inbox-rows'] > li")).map(
      (li) => li.getAttribute("data-task-id"),
    );
    expect(ids).toEqual(["t-1000", "t-2000", "t-3000", "t-4000"]);
  });
});

describe("field entitlements", () => {
  it("gives can_modify principal editable fields", () => {
    const states = Object.fromEntries(
      fieldEntitlements(pdp(), "user:eve", "case:c-100").map((e) => [e.field, e.state]),
    );
    expect(states).toEqual({
      applicantName: "read-only",
      decision: "editable",
      reviewerNote: "editable",
    });
  });

  it("hides the internal note and locks the action for a view-only principal, with a reason", () => {
    const ents = fieldEntitlements(pdp(), "user:iris", "case:c-100");
    const note = ents.find((e) => e.field === "reviewerNote")!;
    expect(note.state).toBe("hidden");
    expect(note.reason).toMatch(/can_modify/);
    expect(ents.find((e) => e.field === "decision")!.state).toBe("read-only");
  });
});

describe("action form", () => {
  it("buildSignal emits a resolve signal targeting the case's active human-task step", () => {
    const cases = loadCases();
    const c = cases.find((x) => x.caseId === "case:c-100")!;
    expect(buildSignal(c, { decision: 1 })).toEqual({
      afterMs: 0,
      stepId: "review",
      action: "resolve",
      value: 1,
    });
  });

  it("renders a hidden field as a why-affordance (no input) for a view-only principal", () => {
    const cases = loadCases();
    const c = cases.find((x) => x.caseId === "case:c-100")!;
    const flow = loadCaseFlowResults()["case:c-100"] as unknown as FlowResult;
    const record = assembleDecisionRecord(flow);
    const { container } = render(
      createElement(CaseView, {
        caseRecord: c,
        record,
        schema: loadActionDataSchema(),
        uischema: loadActionUiSchema(),
        entitlements: fieldEntitlements(pdp(), "user:iris", "case:c-100"),
        initialData: { applicantName: c.applicantName, decision: 1, reviewerNote: "" },
        onSignal: () => {},
      }),
    );
    const hidden = container.querySelector("[data-field='reviewerNote']");
    expect(hidden?.getAttribute("data-field-state")).toBe("hidden");
    expect(container.querySelector("[data-testid='why-reviewerNote']")).not.toBeNull();
    expect(container.querySelector("#field-reviewerNote")).toBeNull();
  });

  it("renders the decision trace nodes for the case", () => {
    const cases = loadCases();
    const c = cases.find((x) => x.caseId === "case:c-100")!;
    const flow = loadCaseFlowResults()["case:c-100"] as unknown as FlowResult;
    const record = assembleDecisionRecord(flow);
    const { container } = render(
      createElement(CaseView, {
        caseRecord: c,
        record,
        schema: loadActionDataSchema(),
        uischema: loadActionUiSchema(),
        entitlements: fieldEntitlements(pdp(), "user:eve", "case:c-100"),
        initialData: { applicantName: c.applicantName, decision: 1, reviewerNote: "" },
        onSignal: () => {},
      }),
    );
    expect(container.querySelector("[data-trace-node='decision:s1']")).not.toBeNull();
    expect(container.querySelector("[data-trace-node='task:review']")).not.toBeNull();
  });
});
