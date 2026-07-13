import { describe, expect, it } from "vitest";
import { decode } from "../src/bindings.js";
import { translate, MappingError } from "../src/mapping.js";
import { runReliability, poisonAwareReceiver } from "../src/reliability.js";
import { runAdapters } from "../src/run.js";
import type { Mapping } from "../src/types.js";

const mapping: Mapping = {
  id: "t",
  schemaVersion: "adapter/v1",
  version: "1.0.0",
  direction: "inbound",
  kind: "Event",
  canonicalType: "t.received.v1",
  messageIdFrom: "/id",
  correlationFrom: "/corr",
  caseIdFrom: "/case",
  rules: [
    { operation: "copy", from: "/a/b", to: "nested.value" },
    { operation: "copyNumber", from: "/amount", to: "amount" },
    { operation: "constant", to: "source", value: "unit" },
    { operation: "copy", from: "/missing", to: "maybe", optional: true },
  ],
};

const wire = { id: "m1", corr: "c1", case: "case1", a: { b: "hi" }, amount: "42" };

describe("mapping (Message-Translator purity)", () => {
  it("translates wire → canonical deterministically", () => {
    const out = translate(mapping, wire);
    expect(out).toEqual({
      kind: "Event",
      type: "t.received.v1",
      messageId: "m1",
      correlationId: "c1",
      caseId: "case1",
      payload: { nested: { value: "hi" }, amount: 42, source: "unit" },
    });
  });

  it("is pure — repeated calls on the same input match exactly", () => {
    expect(translate(mapping, wire)).toEqual(translate(mapping, wire));
  });

  it("errors on a missing required correlation value", () => {
    expect(() =>
      translate(mapping, { id: "m1", case: "case1", a: { b: "x" }, amount: "1" }),
    ).toThrow(MappingError);
  });

  it("errors on a non-coercible number", () => {
    expect(() => translate(mapping, { ...wire, amount: "not-a-number" })).toThrow(MappingError);
  });
});

describe("bindings (decode ∘ translate round-trip)", () => {
  it("rest / broker / webhook frames decode to the same wire the translator maps", () => {
    expect(decode({ protocol: "rest", body: { x: 1 } })).toEqual({ x: 1 });
    expect(decode({ protocol: "broker", headers: { h: "1" }, body: { x: 1 } })).toEqual({
      x: 1,
      _headers: { h: "1" },
    });
    expect(decode({ protocol: "webhook", query: { q: "1" }, body: { x: 1 } })).toEqual({
      x: 1,
      _query: { q: "1" },
    });
  });
});

describe("reliability (Idempotent Receiver + DLQ)", () => {
  it("dedups a duplicate messageId once", () => {
    const out = runReliability([{ messageId: "a" }, { messageId: "a" }], 3, poisonAwareReceiver());
    expect(out).toMatchObject({ applied: 1, deduped: 1, dlq: 0 });
  });

  it("sends a poison message to the DLQ after bounded attempts", () => {
    const out = runReliability([{ messageId: "p", poison: true }], 3, poisonAwareReceiver());
    expect(out).toMatchObject({ applied: 0, deduped: 0, dlq: 1 });
    expect(out.dispositions[0]?.attempts).toBe(3);
  });
});

describe("runAdapters (committed fixture harness)", () => {
  it("all goldens, binding contracts, and reliability vectors are green", () => {
    const r = runAdapters();
    expect(r.goldensGreen).toBe(r.goldens.length);
    expect(r.bindingContractGreen).toBe(r.bindingContract.length);
    expect(r.reliabilityGreen).toBe(r.reliability.length);
    expect(r.bindingsCovered).toBe(true);
    expect(r.dedupPass && r.dlqPass && r.redeliveryPass).toBe(true);
  });
});
