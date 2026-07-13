import { Bff, type HttpResponse } from "./bff.js";
import { Contract } from "./contract.js";
import { EntityStore } from "./store.js";

/** Drive committed API-contract vectors through the generated BFF and score conformance. */

export interface ApiRequestVector {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  expectStatus: number;
  expectBodyId?: string;
  expectVersion?: number;
  expectTotal?: number;
  expectIds?: string[];
  expectErrorCode?: string;
}

export interface ApiContractVector {
  name: string;
  requests: ApiRequestVector[];
}

export interface RequestResult {
  method: string;
  path: string;
  operationId: string;
  status: number;
  expectStatus: number;
  /** The response body validated against the emitted OpenAPI response schema for its status. */
  conforms: boolean;
  /** Status + pinned-value expectations all held. */
  ok: boolean;
  detail: string;
}

export interface VectorResult {
  name: string;
  green: boolean;
  requests: RequestResult[];
}

export interface ContractRunResult {
  vectorsGreen: number;
  total: number;
  operationsCovered: string[];
  operationsDeclared: string[];
  boundaryRejections: number;
  vectors: VectorResult[];
}

function record(body: unknown): { data?: Record<string, unknown>; meta?: Record<string, unknown> } {
  return (body ?? {}) as { data?: Record<string, unknown>; meta?: Record<string, unknown> };
}

function checkExpectations(req: ApiRequestVector, res: HttpResponse): string {
  if (res.status !== req.expectStatus)
    return `status ${res.status} != expected ${req.expectStatus}`;
  const body = record(res.body);
  if (req.expectBodyId !== undefined && body.meta?.["id"] !== req.expectBodyId)
    return `meta.id ${String(body.meta?.["id"])} != expected ${req.expectBodyId}`;
  if (req.expectVersion !== undefined && body.meta?.["version"] !== req.expectVersion)
    return `meta.version ${String(body.meta?.["version"])} != expected ${req.expectVersion}`;
  if (req.expectTotal !== undefined && (res.body as { total?: number })?.total !== req.expectTotal)
    return `total ${String((res.body as { total?: number })?.total)} != expected ${req.expectTotal}`;
  if (req.expectIds !== undefined) {
    const items = (res.body as { items?: { meta?: { id?: string } }[] })?.items ?? [];
    const ids = items.map((it) => it.meta?.id ?? "");
    if (JSON.stringify(ids) !== JSON.stringify(req.expectIds))
      return `ids ${JSON.stringify(ids)} != expected ${JSON.stringify(req.expectIds)}`;
  }
  if (
    req.expectErrorCode !== undefined &&
    (res.body as { code?: string })?.code !== req.expectErrorCode
  )
    return `error code ${String((res.body as { code?: string })?.code)} != expected ${req.expectErrorCode}`;
  return "";
}

export function runVector(vector: ApiContractVector, contract: Contract): VectorResult {
  const bff = new Bff(new EntityStore(), contract);
  const requests: RequestResult[] = [];
  let green = true;
  for (const req of vector.requests) {
    const matched = contract.match(req.method, req.path);
    const res = bff.handle(req);
    const conformance = matched
      ? contract.validateResponse(matched.operation, res.status, res.body)
      : { valid: false, errors: ["no matching operation in the emitted OpenAPI"] };
    const expectationDetail = checkExpectations(req, res);
    const ok = expectationDetail === "" && conformance.valid;
    if (!ok) green = false;
    requests.push({
      method: req.method,
      path: req.path,
      operationId: matched?.operationId ?? "(unmatched)",
      status: res.status,
      expectStatus: req.expectStatus,
      conforms: conformance.valid,
      ok,
      detail:
        expectationDetail ||
        (conformance.valid ? "" : `non-conforming response: ${conformance.errors.join("; ")}`),
    });
  }
  return { name: vector.name, green, requests };
}

export function runVectors(vectors: ApiContractVector[], contract: Contract): ContractRunResult {
  const results = vectors.map((v) => runVector(v, contract));
  const covered = new Set<string>();
  let boundaryRejections = 0;
  for (const vr of results) {
    for (const rr of vr.requests) {
      covered.add(rr.operationId);
      if (rr.status === 422 && rr.ok) boundaryRejections++;
    }
  }
  return {
    vectorsGreen: results.filter((r) => r.green).length,
    total: results.length,
    operationsCovered: [...covered].sort(),
    operationsDeclared: contract.operationIds(),
    boundaryRejections,
    vectors: results,
  };
}
