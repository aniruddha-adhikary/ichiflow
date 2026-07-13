import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * Canonical document-issuance contracts (build plan 5.3; ADR-0029; docs 04 §2.9, 07 §15,
 * 08 §1.6, 13 §2.k). The binary is derived from an immutable data snapshot + pinned doctemplate
 * version; numbering, lifecycle, verification, and their audit events remain core semantics.
 */
@jsonSchema
namespace Ichiflow.Document;

union DocumentSchemaVersion {
  v1: "document/v1",
}

union DoctemplateSchemaVersion {
  v1: "doctemplate/v1",
}

union RenderingEngine {
  typst: "typst",
}

union DocumentLifecycleStatus {
  issued: "issued",
  superseded: "superseded",
  revoked: "revoked",
  accepted: "accepted",
}

union DocumentDecisionRecordEventType {
  allocated: "document.allocated",
  issued: "document.issued",
  delivered: "document.delivered",
  superseded: "document.superseded",
  revoked: "document.revoked",
  accepted: "document.accepted",
}

union AcceptanceMode {
  none: "none",
  offer: "offer",
}

union AllocationSemantics {
  gapped: "gapped",
  gapFree: "gap-free",
}

union IssuanceScenario {
  issue: "issue",
  replay: "replay",
  supersede: "supersede",
  revoke: "revoke",
  accept: "accept",
}

union VerificationScenario {
  genuine: "genuine",
  tampered: "tampered",
  unknownReference: "unknown",
}

@pattern("^[0-9]+[.][0-9]+[.][0-9]+$")
scalar SemanticVersion extends string;

@pattern("^[$][{][A-Za-z0-9_.-]+[}]$")
scalar TemplateBinding extends string;

@pattern("^[a-f0-9]{64}$")
scalar Sha256Hash extends string;

model DoctemplateMetadata {
  id: string;
  version: SemanticVersion;
  governanceState: "released";
  ownerTeam: string;
}

model DocumentAccessibility {
  pdfua: boolean;

  @minValue(4.5)
  textContrast: float64;

  @minValue(3)
  uiContrast: float64;
}

/** Immutable, versioned designer artifact binding schema-scoped snapshot fields to a print layout. */
model Doctemplate {
  kind: "doctemplate";
  schemaVersion: DoctemplateSchemaVersion;
  metadata: DoctemplateMetadata;
  engine: RenderingEngine;
  dataSchema: string;
  binds: Record<TemplateBinding>;
  content: string;
  accessibility: DocumentAccessibility;
}

model DocumentTemplatePin {
  id: string;
  version: SemanticVersion;
}

model NumberAllocationContract {
  id: string;
  version: SemanticVersion;
  semantics: AllocationSemantics;
  prefix: string;

  @minValue(1)
  width: int32;

  @minValue(1)
  startsAt: int64;
}

model DocumentDelivery {
  portal?: string;
  notify?: string;
}

/** Audited lifecycle fact appended to the Case DecisionRecord. */
model DocumentDecisionRecordEvent {
  seq: int32;
  type: DocumentDecisionRecordEventType;
  caseId: string;
  stepId: string;
  referenceNumber: string;
  template: string;
  snapshotRef: Sha256Hash;
  verificationHash: Sha256Hash;
}

/**
 * Immutable, versioned issued instrument. Lifecycle transitions replace registry metadata and append
 * audit events; the pinned snapshot/template identity and rendered hash never mutate.
 */
model Document {
  schemaVersion: DocumentSchemaVersion;
  id: string;
  caseId: string;
  stepId: string;
  documentType: string;
  version: SemanticVersion;
  snapshot: Record<unknown>;
  snapshotRef: Sha256Hash;
  template: DocumentTemplatePin;
  referenceNumber: string;
  numberAllocation: string;
  status: DocumentLifecycleStatus;
  issuedAt: utcDateTime;
  verificationHash: Sha256Hash;
  renderHash: Sha256Hash;
  supersedes?: string;
  deliveries: DocumentDelivery[];
}

model IssuanceExpectation {
  @minValue(1)
  documents: int32;

  @minValue(1)
  allocations: int32;

  @minValue(1)
  issuedEvents: int32;

  @minValue(1)
  deliveredEvents: int32;

  status: DocumentLifecycleStatus;
  replayIdempotent?: boolean;
}

/** Lifecycle/replay harness vector; the implementation drives the named scenario to this oracle. */
model IssuanceVector {
  name: string;
  scenario: IssuanceScenario;
  caseId: string;
  stepId: string;
  documentType: string;
  issuedAt: utcDateTime;
  template: string;
  snapshot: Record<unknown>;
  allocation: NumberAllocationContract;
  acceptance: AcceptanceMode;
  delivery: DocumentDelivery[];
  expect: IssuanceExpectation;
}

model VerificationExpectation {
  authentic: boolean;
  hashMatch: boolean;
  status?: DocumentLifecycleStatus;
  rejected: boolean;
  dataMinimal: boolean;
}

/** Public verification vector: genuine, tampered, and unknown references, with no Case-data response. */
model DocumentVerificationVector {
  name: string;
  scenario: VerificationScenario;
  reference: string;
  presentedHash?: Sha256Hash;
  expect: VerificationExpectation;
}
