import {
  accessibilityConforms,
  DeterministicTypstRenderer,
  lintBindingScope,
} from "./rendering.js";
import { NumberAllocator } from "./numbering.js";
import { IssuanceService } from "./issuance.js";
import { DocumentVerificationEndpoint } from "./verification.js";
import { loadIssuanceVectors, loadTemplates, loadVerificationVectors } from "./load.js";
import type { Doctemplate, IssueInput, IssuanceVector, NumberAllocationContract } from "./types.js";

export interface IssuanceResult {
  render: Array<{
    binding: string;
    deterministic: boolean;
    bindingScopeClean: boolean;
    accessible: boolean;
  }>;
  lifecycle: Array<{ name: string; pass: boolean }>;
  lifecycleGreen: number;
  replayIdempotent: boolean;
  replayNoDoubleConsume: boolean;
  verification: Array<{ name: string; pass: boolean }>;
  verificationGreen: number;
  allocation: { gapfreeContiguous: boolean; gappedOk: boolean };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function issueInput(vector: IssuanceVector, template: Doctemplate): IssueInput {
  return {
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
}

function eventCount(service: IssuanceService, type: string): number {
  return service.events().filter((event) => event.type === type).length;
}

function runLifecycle(
  vector: IssuanceVector,
  template: Doctemplate,
): {
  pass: boolean;
  replayIdempotent: boolean;
  replayNoDoubleConsume: boolean;
} {
  const service = new IssuanceService();
  const input = issueInput(vector, template);
  const first = service.issue(input);
  let observedStatus = first.document.status;
  let replayIdempotent = true;
  let replayNoDoubleConsume = true;

  if (vector.scenario === "replay") {
    const replay = service.issue(input);
    replayIdempotent =
      replay.replayed &&
      replay.document.referenceNumber === first.document.referenceNumber &&
      eventCount(service, "document.issued") === 1;
    replayNoDoubleConsume = service.allocator.allocations().length === 1;
  } else if (vector.scenario === "supersede") {
    service.supersede(first.document.referenceNumber, {
      ...input,
      stepId: `${input.stepId}-v2`,
      documentVersion: "2.0.0",
    });
    observedStatus =
      service
        .documents()
        .find((document) => document.referenceNumber === first.document.referenceNumber)?.status ??
      "issued";
  } else if (vector.scenario === "revoke") {
    observedStatus = service.revoke(first.document.referenceNumber).status;
  } else if (vector.scenario === "accept") {
    observedStatus = service.accept(first.document.referenceNumber).status;
  }

  const pass =
    service.documents().length === vector.expect.documents &&
    service.allocator.allocations().length === vector.expect.allocations &&
    eventCount(service, "document.issued") === vector.expect.issuedEvents &&
    eventCount(service, "document.delivered") === vector.expect.deliveredEvents &&
    observedStatus === vector.expect.status &&
    (vector.expect.replayIdempotent !== true || (replayIdempotent && replayNoDoubleConsume));
  return { pass, replayIdempotent, replayNoDoubleConsume };
}

function allocationContract(
  id: string,
  semantics: NumberAllocationContract["semantics"],
): NumberAllocationContract {
  return { id, version: "1.0.0", semantics, prefix: "N-", width: 3, startsAt: 1 };
}

export function runIssuance(): IssuanceResult {
  const templates = loadTemplates();
  const template = templates[0]!;
  const renderSnapshot = loadIssuanceVectors()[0]!.snapshot;
  const renderer = new DeterministicTypstRenderer();
  const render = templates.map((candidate) => {
    const first = renderer.render({ template: candidate, snapshot: renderSnapshot });
    const second = renderer.render({ template: candidate, snapshot: renderSnapshot });
    return {
      binding: candidate.engine,
      deterministic: sameBytes(first, second),
      bindingScopeClean: lintBindingScope(candidate, renderSnapshot).length === 0,
      accessible: accessibilityConforms(candidate, first),
    };
  });

  const replayOutcomes: boolean[] = [];
  const replayConsumeOutcomes: boolean[] = [];
  const lifecycle = loadIssuanceVectors().map((vector) => {
    const outcome = runLifecycle(vector, template);
    if (vector.scenario === "replay") {
      replayOutcomes.push(outcome.replayIdempotent);
      replayConsumeOutcomes.push(outcome.replayNoDoubleConsume);
    }
    return { name: vector.name, pass: outcome.pass };
  });

  const verificationService = new IssuanceService();
  const verificationIssue = verificationService.issue(
    issueInput(loadIssuanceVectors()[0]!, template),
  );
  const verificationEndpoint = new DocumentVerificationEndpoint(verificationService);
  const allowedResponseKeys = new Set(["authentic", "hashMatch", "rejected", "status", "issuedAt"]);
  const verification = loadVerificationVectors().map((vector) => {
    const reference =
      vector.reference === "$issued"
        ? verificationIssue.document.referenceNumber
        : vector.reference;
    const presentedHash =
      vector.scenario === "genuine"
        ? verificationIssue.document.verificationHash
        : vector.presentedHash;
    const endpointResponse = verificationEndpoint.handle({
      referenceNumber: reference,
      presentedHash,
    });
    const response = endpointResponse.body;
    const expectedHttpStatus =
      vector.scenario === "genuine" ? 200 : vector.scenario === "unknown" ? 404 : 409;
    const dataMinimal = Object.keys(response).every((key) => allowedResponseKeys.has(key));
    const pass =
      endpointResponse.status === expectedHttpStatus &&
      response.authentic === vector.expect.authentic &&
      response.hashMatch === vector.expect.hashMatch &&
      response.rejected === vector.expect.rejected &&
      response.status === vector.expect.status &&
      dataMinimal === vector.expect.dataMinimal;
    return { name: vector.name, pass };
  });

  const allocator = new NumberAllocator();
  const gapfree = allocationContract("allocation://test/gapfree", "gap-free");
  const gapfreeRefs = [
    allocator.allocate("g1", "s", gapfree).referenceNumber,
    allocator.allocate("g2", "s", gapfree).referenceNumber,
  ];
  const gapped = allocationContract("allocation://test/gapped", "gapped");
  const gappedFirst = allocator.allocate("p1", "s", gapped);
  allocator.voidNext(gapped, "aborted-before-issue");
  const gappedThird = allocator.allocate("p2", "s", gapped);

  return {
    render,
    lifecycle,
    lifecycleGreen: lifecycle.filter((outcome) => outcome.pass).length,
    replayIdempotent: replayOutcomes.length > 0 && replayOutcomes.every(Boolean),
    replayNoDoubleConsume: replayConsumeOutcomes.length > 0 && replayConsumeOutcomes.every(Boolean),
    verification,
    verificationGreen: verification.filter((outcome) => outcome.pass).length,
    allocation: {
      gapfreeContiguous: gapfreeRefs.join(",") === "N-001,N-002",
      gappedOk:
        gappedFirst.referenceNumber === "N-001" &&
        gappedThird.referenceNumber === "N-003" &&
        allocator.voidLedger().length === 1,
    },
  };
}
