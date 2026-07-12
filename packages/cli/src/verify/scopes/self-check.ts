import { assert, deriveSeed, pass } from "../check.js";
import { buildEnvelope, envelopeValidator, validateEnvelope } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

/**
 * self-check — the meta-harness: the harness that judges harnesses (build plan chunk 0.2).
 * It proves the verify machinery itself is sound before any subsystem harness is trusted:
 * the envelope contract loads, a good envelope validates, a bad envelope is rejected, and the
 * determinism discipline (seeded, retry-forbidden) holds.
 */
function run(ctx: ScopeContext): CheckResult[] {
  const checks: CheckResult[] = [];

  // 1. The verdict-envelope contract (TypeSpec-authored, generated JSON Schema) loads & compiles.
  let validatorOk = true;
  try {
    envelopeValidator();
  } catch (err) {
    validatorOk = false;
    checks.push({
      id: "self-check.envelope-schema-loads",
      status: "fail",
      diff: err instanceof Error ? err.message : String(err),
    });
  }
  if (validatorOk) checks.push(pass("self-check.envelope-schema-loads"));

  // 2. A well-formed envelope validates against its own contract.
  const good = buildEnvelope({
    scope: "self-check",
    seed: ctx.seed,
    ranAt: "2026-07-12T00:00:00.000Z",
    checks: [pass("sample.ok")],
  });
  const goodResult = validateEnvelope(good);
  checks.push(
    assert("self-check.good-envelope-validates", goodResult.valid, {
      expected: { valid: true },
      actual: { valid: false },
      diff: goodResult.errors.join("; "),
    }),
  );

  // 3. A malformed envelope is rejected — proves the validator actually validates (negative test).
  const bad = { ...good, verdict: "maybe", flaky: "no" };
  const badResult = validateEnvelope(bad);
  checks.push(
    assert("self-check.bad-envelope-rejected", !badResult.valid, {
      expected: { valid: false },
      actual: { valid: true },
      diff: "a malformed envelope validated when it should have been rejected",
    }),
  );

  // 4. Determinism (§3.6): the seed derivation is a pure function of its inputs.
  const s1 = deriveSeed("a", "b");
  const s2 = deriveSeed("a", "b");
  checks.push(
    assert("self-check.seed-deterministic", s1 === s2, {
      expected: s1,
      actual: s2,
      diff: "seed derivation is not deterministic",
    }),
  );

  // 5. Flake invariant: envelopes carry flaky:false by construction (§3.6).
  checks.push(
    assert("self-check.flaky-invariant", good.flaky === false, {
      expected: { flaky: false },
      actual: { flaky: good.flaky },
      diff: "envelope flaky invariant violated",
    }),
  );

  return checks;
}

export const selfCheckScope: Scope = {
  id: "self-check",
  description: "The meta-harness: proves the verify machinery and its verdict contract are sound.",
  run,
};
