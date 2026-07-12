import { buildEnvelope, validateEnvelope } from "./envelope.js";
import { deriveSeed } from "./check.js";
import { writeLedger } from "./ledger.js";
import { allScopes, scopeById } from "./registry.js";
import type { CheckResult, Scope, VerdictEnvelope } from "./types.js";

export interface RunOptions {
  repoRoot: string;
  /** A specific scope id; when omitted, every registered scope runs (CI's full loop). */
  scope?: string;
  /** When true, the ledger is written to disk. */
  writeLedger?: boolean;
  /** Injectable clock for determinism in tests; defaults to now. */
  now?: () => Date;
}

export interface RunResult {
  envelopes: VerdictEnvelope[];
  /** True when every envelope's verdict is `pass`. */
  ok: boolean;
}

/** Run one scope into a validated verdict envelope. */
export async function runScope(scope: Scope, opts: RunOptions): Promise<VerdictEnvelope> {
  const now = opts.now ?? (() => new Date());
  const seed = deriveSeed("ichiflow-verify", scope.id);
  let checks: CheckResult[];
  try {
    checks = await scope.run({ repoRoot: opts.repoRoot, seed });
  } catch (err) {
    checks = [
      {
        id: `${scope.id}.harness-error`,
        status: "fail",
        diff: err instanceof Error ? err.message : String(err),
      },
    ];
  }
  const envelope = buildEnvelope({
    scope: scope.id,
    seed,
    ranAt: now().toISOString(),
    checks,
  });

  // Self-referential guard: the meta-harness's own output must satisfy its own contract.
  const validation = validateEnvelope(envelope);
  if (!validation.valid) {
    envelope.checks.push({
      id: `${scope.id}.envelope-self-invalid`,
      status: "fail",
      diff: validation.errors.join("; "),
    });
    envelope.summary.checks = envelope.checks.length;
    envelope.summary.failed += 1;
    envelope.verdict = "fail";
  }

  if (opts.writeLedger) writeLedger(opts.repoRoot, envelope);
  return envelope;
}

/** Resolve requested scopes, run them, and roll up an ok/fail result. */
export async function runVerify(opts: RunOptions): Promise<RunResult> {
  let scopes: Scope[];
  if (opts.scope) {
    const scope = scopeById(opts.scope);
    if (!scope) {
      const known = allScopes()
        .map((s) => s.id)
        .join(", ");
      throw new Error(`Unknown scope '${opts.scope}'. Known scopes: ${known}`);
    }
    scopes = [scope];
  } else {
    scopes = allScopes();
  }

  const envelopes: VerdictEnvelope[] = [];
  for (const scope of scopes) {
    envelopes.push(await runScope(scope, opts));
  }
  return { envelopes, ok: envelopes.every((e) => e.verdict === "pass") };
}
