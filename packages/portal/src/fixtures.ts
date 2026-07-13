import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthzModel } from "./pdp/engine.js";
import type { CaseRecord, RelationTuple, Task } from "./types.js";

/**
 * Fixture loaders. Paths resolve relative to this module so they work identically from `src/` (tests)
 * and `dist/` (the `portal:preview` producer) — both are one directory under `packages/portal`.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const fixturesDir = join(here, "..", "fixtures");
export const repoRoot = join(here, "..", "..", "..");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export interface Principal {
  id: string;
  label: string;
  crossTeam: boolean;
  expectedInbox: string[];
}

export interface FieldScenario {
  principal: string;
  caseId: string;
  note: string;
  expected: Record<string, string>;
}

export interface FlowResultLike {
  flowId: string;
  caseId: string;
  steps: number;
  vars: Record<string, number>;
  slaMs: number;
  trace: {
    stepId: string;
    type: string;
    out?: string;
    value?: number;
    ref?: string;
    decision?: string;
    outcomeType?: string;
    resolution?: "resolved" | "escalated";
    assignee?: string;
    durationMs?: number;
  }[];
  events: { seq: number; type: string; stepId?: string; assignee?: string }[];
}

/** The committed OpenFGA relation model — the SAME artifact the `authz` slice governs (doc 13 §2.f). */
export function loadAuthzModel(): AuthzModel {
  return readJson<AuthzModel>(join(repoRoot, "schemas", "authz", "model.json"));
}

export function loadTuples(): RelationTuple[] {
  return readJson<RelationTuple[]>(join(fixturesDir, "tuples.json"));
}

export function loadTasks(): Task[] {
  return readJson<Task[]>(join(fixturesDir, "tasks.json"));
}

export function loadCases(): CaseRecord[] {
  return readJson<CaseRecord[]>(join(fixturesDir, "cases.json"));
}

export function loadPrincipals(): Principal[] {
  return readJson<Principal[]>(join(fixturesDir, "principals.json"));
}

export function loadFieldScenarios(): FieldScenario[] {
  return readJson<FieldScenario[]>(join(fixturesDir, "field-scenarios.json"));
}

export function loadActionDataSchema(): Record<string, unknown> {
  return readJson<Record<string, unknown>>(join(fixturesDir, "action.dataschema.json"));
}

export function loadActionUiSchema(): Record<string, unknown> {
  return readJson<Record<string, unknown>>(join(fixturesDir, "action.uischema.json"));
}

export function loadCaseFlowResults(): Record<string, FlowResultLike> {
  return readJson<Record<string, FlowResultLike>>(join(fixturesDir, "case-flow-results.json"));
}
