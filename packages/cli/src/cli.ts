#!/usr/bin/env node
import { parseArgs } from "node:util";
import { findRepoRoot } from "./repo-root.js";
import { runVerify } from "./verify/runner.js";
import { scopeIds } from "./verify/registry.js";
import type { VerdictEnvelope } from "./verify/types.js";

const USAGE = `ichiflow — AI-native enterprise workflow framework

Usage:
  ichiflow verify [--scope <subsystem|artifact>] [--json] [--since <ref>] [--no-ledger]

  The single verification entry point (doc 13 §3.1). Every scope emits the same JSON verdict
  envelope; done-ness is an enumerable count over a suite of checks, never a prose claim.

Options:
  --scope <id>   Run one scope; omit to run every registered scope (CI's full loop).
  --json         Emit the machine-readable verdict envelope (default for agents/CI).
  --since <ref>  Reserved: scope to artifacts changed since a git ref (hook incremental mode).
  --no-ledger    Do not write the progress ledger.

Registered scopes: ${scopeIds().join(", ")}
`;

async function verifyCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      scope: { type: "string" },
      json: { type: "boolean", default: false },
      since: { type: "string" },
      "no-ledger": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const repoRoot = findRepoRoot(process.cwd());
  const result = await runVerify({
    repoRoot,
    scope: values.scope,
    writeLedger: !values["no-ledger"],
  });

  if (values.json) {
    const payload: VerdictEnvelope | VerdictEnvelope[] = values.scope
      ? (result.envelopes[0] as VerdictEnvelope)
      : result.envelopes;
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    for (const env of result.envelopes) {
      const { passed, failed, skipped, checks } = env.summary;
      process.stdout.write(
        `${env.verdict === "pass" ? "PASS" : "FAIL"}  ${env.scope}  ` +
          `${passed}/${checks} passed` +
          (failed ? `, ${failed} failed` : "") +
          (skipped ? `, ${skipped} skipped` : "") +
          "\n",
      );
      for (const c of env.checks) {
        if (c.status === "fail") {
          process.stdout.write(`      ✗ ${c.id}${c.diff ? ` — ${c.diff}` : ""}\n`);
        }
      }
    }
  }

  return result.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "verify":
      process.exitCode = await verifyCommand(rest);
      return;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(`Unknown command '${command}'.\n\n${USAGE}`);
      process.exitCode = 2;
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
