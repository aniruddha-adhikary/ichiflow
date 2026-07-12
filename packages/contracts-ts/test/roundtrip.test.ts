import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  IchiflowVerifyVerdictEnvelope,
  IchiflowVerifyCheckResult,
} from "../src/gen/types.gen.js";

// The canonical verdict envelope, typed by the *generated* contract. If codegen drifts from the
// authored TypeSpec (e.g. a renamed/removed field), this file stops compiling — that is the
// round-trip guarantee at the type level. The runtime assertion adds serialize→parse fidelity.
const sample: IchiflowVerifyVerdictEnvelope = {
  verifyVersion: "1",
  scope: "self-check",
  ranAt: "2026-07-12T00:00:00Z",
  seed: "sha256:0000",
  verdict: "pass",
  summary: { checks: 1, passed: 1, failed: 0, skipped: 0 },
  progress: { conformance: { green: 1, total: 1 } },
  checks: [{ id: "self-check.example", status: "pass" }],
  flaky: false,
};

describe("generated TS contract types", () => {
  it("round-trips the canonical verdict envelope through the generated type", () => {
    const roundTripped = JSON.parse(JSON.stringify(sample)) as IchiflowVerifyVerdictEnvelope;
    expect(roundTripped).toEqual(sample);
  });

  it("keeps verdict/status as the closed enums authored in TypeSpec", () => {
    expectTypeOf<IchiflowVerifyVerdictEnvelope["verdict"]>().toEqualTypeOf<"pass" | "fail">();
    expectTypeOf<IchiflowVerifyCheckResult["status"]>().toEqualTypeOf<"pass" | "fail" | "skip">();
  });
});
