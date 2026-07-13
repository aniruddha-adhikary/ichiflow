export type DocumentStatus = "issued" | "superseded" | "revoked" | "accepted";
export type AcceptanceMode = "none" | "offer";
export type AllocationSemantics = "gapped" | "gap-free";

export interface Doctemplate {
  kind: "doctemplate";
  schemaVersion: "doctemplate/v1";
  metadata: {
    id: string;
    version: string;
    governanceState: "released";
    ownerTeam: string;
  };
  engine: "typst";
  dataSchema: string;
  binds: Record<string, string>;
  content: string;
  accessibility: {
    pdfua: boolean;
    textContrast: number;
    uiContrast: number;
  };
}

export interface NumberAllocationContract {
  id: string;
  version: string;
  semantics: AllocationSemantics;
  prefix: string;
  width: number;
  startsAt: number;
}

export interface DocumentDelivery {
  portal?: string;
  notify?: string;
}

export interface IssuedDocument {
  schemaVersion: "document/v1";
  id: string;
  caseId: string;
  stepId: string;
  documentType: string;
  version: string;
  snapshot: Record<string, unknown>;
  snapshotRef: string;
  template: { id: string; version: string };
  referenceNumber: string;
  numberAllocation: string;
  status: DocumentStatus;
  issuedAt: string;
  verificationHash: string;
  renderHash: string;
  supersedes?: string;
  deliveries: DocumentDelivery[];
}

export interface DocumentAuditEvent {
  seq: number;
  type:
    | "document.allocated"
    | "document.issued"
    | "document.delivered"
    | "document.superseded"
    | "document.revoked"
    | "document.accepted";
  caseId: string;
  stepId: string;
  referenceNumber: string;
  template: string;
  snapshotRef: string;
  verificationHash: string;
}

export interface IssueInput {
  caseId: string;
  stepId: string;
  documentType: string;
  documentVersion?: string;
  issuedAt: string;
  template: Doctemplate;
  snapshot: Record<string, unknown>;
  allocation: NumberAllocationContract;
  acceptance: AcceptanceMode;
  delivery: DocumentDelivery[];
  supersedes?: string;
}

export interface IssueResult {
  document: IssuedDocument;
  bytes: Uint8Array;
  replayed: boolean;
}

export interface VerificationResponse {
  authentic: boolean;
  hashMatch: boolean;
  rejected: boolean;
  status?: DocumentStatus;
  issuedAt?: string;
}

export interface IssuanceVector {
  name: string;
  scenario: "issue" | "replay" | "supersede" | "revoke" | "accept";
  caseId: string;
  stepId: string;
  documentType: string;
  issuedAt: string;
  template: string;
  snapshot: Record<string, unknown>;
  allocation: NumberAllocationContract;
  acceptance: AcceptanceMode;
  delivery: DocumentDelivery[];
  expect: {
    documents: number;
    allocations: number;
    issuedEvents: number;
    deliveredEvents: number;
    status: DocumentStatus;
    replayIdempotent?: boolean;
  };
}

export interface VerificationVector {
  name: string;
  scenario: "genuine" | "tampered" | "unknown";
  reference: string;
  presentedHash?: string;
  expect: {
    authentic: boolean;
    hashMatch: boolean;
    status?: DocumentStatus;
    rejected: boolean;
    dataMinimal: boolean;
  };
}
