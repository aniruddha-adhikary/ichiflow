import { createHash } from "node:crypto";
import type { CheckResult } from "./types.js";

/** A passing check. */
export function pass(id: string, extra?: Partial<CheckResult>): CheckResult {
  return { id, status: "pass", ...extra };
}

/** A failing check carrying a structured diff (never prose in the verdict of record). */
export function fail(
  id: string,
  detail: Pick<
    CheckResult,
    "expected" | "actual" | "diff" | "artifact" | "metric" | "value" | "threshold"
  >,
): CheckResult {
  return { id, status: "fail", ...detail };
}

/** A boolean assertion collapsed into a check result. */
export function assert(
  id: string,
  condition: boolean,
  onFail: Parameters<typeof fail>[1],
): CheckResult {
  return condition ? pass(id) : fail(id, onFail);
}

/** Deterministic seed for a run: sha256 over stable inputs, never wall-clock or RNG (§3.6). */
export function deriveSeed(...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `sha256:${hash}`;
}
