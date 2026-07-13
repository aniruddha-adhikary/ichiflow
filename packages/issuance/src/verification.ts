import type { IssuanceService } from "./issuance.js";
import type { VerificationResponse } from "./types.js";

export interface VerificationRequest {
  referenceNumber: string;
  presentedHash?: string;
}

export interface VerificationEndpointResponse {
  status: 200 | 404 | 409;
  body: VerificationResponse;
}

/** Data-minimal public endpoint seam: no Case snapshot, applicant, or outcome fields are returned. */
export class DocumentVerificationEndpoint {
  constructor(private readonly issuance: IssuanceService) {}

  handle(request: VerificationRequest): VerificationEndpointResponse {
    const body = this.issuance.verify(request.referenceNumber, request.presentedHash);
    return {
      status: body.authentic ? 200 : body.status === undefined ? 404 : 409,
      body,
    };
  }
}
