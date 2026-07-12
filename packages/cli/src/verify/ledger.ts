import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VerdictEnvelope } from "./types.js";

/**
 * The progress ledger (doc 13 §3.3): for every scope, the latest verdict plus an append-only
 * history of `{ranAt, verdict, passed, total}` rows. Dashboardable and agent-queryable
 * (`get_verify_status`). The ledger is derived state, not committed to git.
 */
export function ledgerDir(repoRoot: string): string {
  return join(repoRoot, ".ichiflow", "ledger");
}

export interface LedgerRow {
  ranAt: string;
  verdict: string;
  passed: number;
  total: number;
}

export interface ScopeLedger {
  scope: string;
  latest: VerdictEnvelope;
  history: LedgerRow[];
}

export function writeLedger(repoRoot: string, envelope: VerdictEnvelope): void {
  const dir = ledgerDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${envelope.scope}.json`);
  const previous = readScopeLedger(repoRoot, envelope.scope);
  const history: LedgerRow[] = previous?.history ?? [];
  history.push({
    ranAt: envelope.ranAt,
    verdict: envelope.verdict,
    passed: envelope.summary.passed,
    total: envelope.summary.checks,
  });
  const ledger: ScopeLedger = { scope: envelope.scope, latest: envelope, history };
  writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

export function readScopeLedger(repoRoot: string, scope: string): ScopeLedger | undefined {
  const file = join(ledgerDir(repoRoot), `${scope}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as ScopeLedger;
}
