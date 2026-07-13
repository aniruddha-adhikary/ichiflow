import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FlowResult } from "./interpreter.js";

/** A committed DecisionRecord case fixture (build plan 3.4): a `FlowResult` + its pinned assembled-record oracle. */
export interface DecisionRecordCase {
  name: string;
  result: FlowResult;
  expect: {
    chainComplete: boolean;
    orphans: string[];
    decisions: number;
    tasks: number;
  };
}

/** The committed DecisionRecord case fixtures (contract of record; also validated against `DecisionRecordCase.json`). */
export const CASES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "schemas",
  "decisionrecord",
  "cases",
);

export function loadDecisionRecordCases(): DecisionRecordCase[] {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".case.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")) as DecisionRecordCase);
}
