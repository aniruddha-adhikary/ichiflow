import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDecisionRecordCases } from "./decisionrecord-cases.js";
import { assembleDecisionRecord } from "./decisionrecord.js";

const here = dirname(fileURLToPath(import.meta.url));

interface CaseOutcome {
  name: string;
  caseId: string;
  chainComplete: boolean;
  expectedChainComplete: boolean;
  orphans: string[];
  expectedOrphans: string[];
  orphansMatch: boolean;
  decisions: number;
  expectedDecisions: number;
  tasks: number;
  expectedTasks: number;
  ok: boolean;
}

function sorted(xs: string[]): string[] {
  return [...xs].sort();
}

/**
 * Producer for the `decisionrecord` scope (build plan 3.4; doc 13 §2.g): assemble the per-Case
 * DecisionRecord from each committed case fixture's `FlowResult` and run the orphan detector, then
 * write the verdict artifact the scope reads as a pure, deterministic pass. Negative fixtures inject a
 * gap so the detector's flagging is proven, not assumed.
 */
function main(): void {
  const cases = loadDecisionRecordCases();
  const outcomes: CaseOutcome[] = cases.map((c) => {
    const record = assembleDecisionRecord(c.result);
    const orphansMatch =
      JSON.stringify(sorted(record.orphans)) === JSON.stringify(sorted(c.expect.orphans));
    const chainMatch = record.chainComplete === c.expect.chainComplete;
    const decisionsMatch = record.decisions.length === c.expect.decisions;
    const tasksMatch = record.tasks.length === c.expect.tasks;
    return {
      name: c.name,
      caseId: record.caseId,
      chainComplete: record.chainComplete,
      expectedChainComplete: c.expect.chainComplete,
      orphans: record.orphans,
      expectedOrphans: c.expect.orphans,
      orphansMatch,
      decisions: record.decisions.length,
      expectedDecisions: c.expect.decisions,
      tasks: record.tasks.length,
      expectedTasks: c.expect.tasks,
      ok: orphansMatch && chainMatch && decisionsMatch && tasksMatch,
    };
  });

  const result = {
    cases: outcomes,
    casesGreen: outcomes.filter((o) => o.ok).length,
    chainsComplete: outcomes.filter((o) => o.chainComplete).length,
  };
  const outPath = join(here, "..", "build", "decisionrecord-results.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `decisionrecord: ${result.casesGreen}/${outcomes.length} cases green, ` +
      `${result.chainsComplete} chains complete → ${outPath}`,
  );
}

main();
