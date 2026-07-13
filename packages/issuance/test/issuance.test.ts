import { describe, expect, it } from "vitest";
import { IssuanceService } from "../src/issuance.js";
import { loadIssuanceVectors, loadTemplates } from "../src/load.js";
import { runIssuance } from "../src/run.js";
import { DocumentVerificationEndpoint } from "../src/verification.js";

describe("Phase 5.3 — Document issuance", () => {
  it("passes deterministic render, lifecycle, replay, verification, and allocation vectors", () => {
    const result = runIssuance();
    expect(result.render.every((item) => item.deterministic && item.bindingScopeClean)).toBe(true);
    expect(result.lifecycleGreen).toBe(result.lifecycle.length);
    expect(result.replayIdempotent && result.replayNoDoubleConsume).toBe(true);
    expect(result.verificationGreen).toBe(result.verification.length);
    expect(result.allocation.gapfreeContiguous && result.allocation.gappedOk).toBe(true);
  });

  it("memoizes issue by case_id + step.id and emits one issued event", () => {
    const vector = loadIssuanceVectors().find((item) => item.scenario === "replay")!;
    const template = loadTemplates()[0]!;
    const service = new IssuanceService();
    const input = {
      caseId: vector.caseId,
      stepId: vector.stepId,
      documentType: vector.documentType,
      issuedAt: vector.issuedAt,
      template,
      snapshot: vector.snapshot,
      allocation: vector.allocation,
      acceptance: vector.acceptance,
      delivery: vector.delivery,
    };
    const first = service.issue(input);
    const replay = service.issue(input);
    expect(replay.replayed).toBe(true);
    expect(replay.document.referenceNumber).toBe(first.document.referenceNumber);
    expect(service.allocator.allocations()).toHaveLength(1);
    expect(service.events().filter((event) => event.type === "document.issued")).toHaveLength(1);
    expect(Object.isFrozen(first.document)).toBe(true);
    expect(Object.isFrozen(first.document.snapshot)).toBe(true);
  });

  it("exposes a data-minimal endpoint and audits lifecycle transitions", () => {
    const vector = loadIssuanceVectors().find((item) => item.scenario === "issue")!;
    const template = loadTemplates()[0]!;
    const service = new IssuanceService();
    const issued = service.issue({
      caseId: vector.caseId,
      stepId: vector.stepId,
      documentType: vector.documentType,
      issuedAt: vector.issuedAt,
      template,
      snapshot: vector.snapshot,
      allocation: vector.allocation,
      acceptance: vector.acceptance,
      delivery: vector.delivery,
    });
    const endpoint = new DocumentVerificationEndpoint(service);
    expect(
      endpoint.handle({
        referenceNumber: issued.document.referenceNumber,
        presentedHash: issued.document.verificationHash,
      }),
    ).toEqual({
      status: 200,
      body: {
        authentic: true,
        hashMatch: true,
        rejected: false,
        status: "issued",
        issuedAt: vector.issuedAt,
      },
    });
    service.revoke(issued.document.referenceNumber);
    expect(service.events().at(-1)?.type).toBe("document.revoked");
    expect(() => service.accept(issued.document.referenceNumber)).toThrow(
      "invalid document lifecycle transition",
    );
  });
});
