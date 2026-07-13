import { immutableCopy, sha256, stableJson } from "./canonical.js";
import { NumberAllocator } from "./numbering.js";
import { defaultRendererRegistry, type RendererRegistry } from "./rendering.js";
import type {
  DocumentAuditEvent,
  DocumentStatus,
  IssueInput,
  IssueResult,
  IssuedDocument,
  VerificationResponse,
} from "./types.js";

function splitTemplateRef(ref: string): { id: string; version: string } {
  const at = ref.lastIndexOf("@");
  if (at < 1) throw new Error(`invalid template ref: ${ref}`);
  return { id: ref.slice(0, at), version: ref.slice(at + 1) };
}

function replaceStatus(document: IssuedDocument, status: DocumentStatus): IssuedDocument {
  return immutableCopy({ ...document, status });
}

export class IssuanceService {
  private readonly byReference = new Map<string, IssuedDocument>();
  private readonly bytes = new Map<string, Uint8Array>();
  private readonly memo = new Map<string, string>();
  private readonly audit: DocumentAuditEvent[] = [];

  constructor(
    readonly allocator = new NumberAllocator(),
    private readonly renderers: RendererRegistry = defaultRendererRegistry(),
  ) {}

  issue(input: IssueInput): IssueResult {
    const key = `${input.caseId}\u0000${input.stepId}`;
    const priorReference = this.memo.get(key);
    if (priorReference) {
      return {
        document: this.byReference.get(priorReference)!,
        bytes: this.bytes.get(priorReference)!,
        replayed: true,
      };
    }

    const allocation = this.allocator.allocate(input.caseId, input.stepId, input.allocation);
    const template = splitTemplateRef(
      `${input.template.metadata.id}@${input.template.metadata.version}`,
    );
    const snapshot = immutableCopy({
      ...input.snapshot,
      issue: {
        ...((input.snapshot.issue as Record<string, unknown> | undefined) ?? {}),
        referenceNumber: allocation.referenceNumber,
      },
    });
    const rendered = this.renderers.render({ template: input.template, snapshot });
    const snapshotRef = sha256(stableJson(snapshot));
    const verificationHash = sha256(stableJson({ snapshot, template }));
    const document = immutableCopy<IssuedDocument>({
      schemaVersion: "document/v1",
      id: `document:${input.caseId}:${input.stepId}`,
      caseId: input.caseId,
      stepId: input.stepId,
      documentType: input.documentType,
      version: input.documentVersion ?? "1.0.0",
      snapshot,
      snapshotRef,
      template,
      referenceNumber: allocation.referenceNumber,
      numberAllocation: input.allocation.id,
      status: "issued",
      issuedAt: input.issuedAt,
      verificationHash,
      renderHash: sha256(rendered),
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      deliveries: input.delivery,
    });
    this.byReference.set(document.referenceNumber, document);
    this.bytes.set(document.referenceNumber, rendered);
    this.memo.set(key, document.referenceNumber);
    this.emit("document.allocated", document);
    this.emit("document.issued", document);
    this.emit("document.delivered", document);
    return { document, bytes: rendered, replayed: false };
  }

  supersede(referenceNumber: string, replacement: IssueInput): IssueResult {
    const prior = this.requireDocument(referenceNumber);
    this.requireIssued(prior);
    const result = this.issue({ ...replacement, supersedes: referenceNumber });
    this.byReference.set(referenceNumber, replaceStatus(prior, "superseded"));
    this.emit("document.superseded", this.byReference.get(referenceNumber)!);
    return result;
  }

  revoke(referenceNumber: string): IssuedDocument {
    return this.transition(referenceNumber, "revoked", "document.revoked");
  }

  accept(referenceNumber: string): IssuedDocument {
    return this.transition(referenceNumber, "accepted", "document.accepted");
  }

  verify(referenceNumber: string, presentedHash?: string): VerificationResponse {
    const document = this.byReference.get(referenceNumber);
    if (!document) {
      return { authentic: false, hashMatch: false, rejected: true };
    }
    const hashMatch = presentedHash === undefined || presentedHash === document.verificationHash;
    return {
      authentic: hashMatch,
      hashMatch,
      rejected: !hashMatch,
      status: document.status,
      issuedAt: document.issuedAt,
    };
  }

  documents(): IssuedDocument[] {
    return [...this.byReference.values()];
  }

  events(): DocumentAuditEvent[] {
    return [...this.audit];
  }

  private transition(
    referenceNumber: string,
    status: DocumentStatus,
    event: DocumentAuditEvent["type"],
  ): IssuedDocument {
    const current = this.requireDocument(referenceNumber);
    this.requireIssued(current);
    const document = replaceStatus(current, status);
    this.byReference.set(referenceNumber, document);
    this.emit(event, document);
    return document;
  }

  private requireDocument(referenceNumber: string): IssuedDocument {
    const document = this.byReference.get(referenceNumber);
    if (!document) throw new Error(`unknown document: ${referenceNumber}`);
    return document;
  }

  private requireIssued(document: IssuedDocument): void {
    if (document.status !== "issued") {
      throw new Error(
        `invalid document lifecycle transition: ${document.referenceNumber} is ${document.status}`,
      );
    }
  }

  private emit(type: DocumentAuditEvent["type"], document: IssuedDocument): void {
    this.audit.push({
      seq: this.audit.length,
      type,
      caseId: document.caseId,
      stepId: document.stepId,
      referenceNumber: document.referenceNumber,
      template: `${document.template.id}@${document.template.version}`,
      snapshotRef: document.snapshotRef,
      verificationHash: document.verificationHash,
    });
  }
}
