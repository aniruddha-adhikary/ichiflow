import { Contract } from "./contract.js";
import { EntityNotFoundError, EntityStore, type StoredEntity } from "./store.js";

/**
 * The generated **BFF** (build plan 4.2) over the entity store. Routing is driven by the *emitted
 * OpenAPI* — every incoming request is matched to a declared operation, its body validated against the
 * operation's declared request schema at the boundary (runtime JSON-Schema validation, doc 02 §5), and
 * the store mutation mapped back to the declared response shape. A boundary rejection surfaces as
 * `422 validation-failed`; a missing/soft-deleted record as `404 entity-not-found`.
 */

const ENTITY_TYPE = "LoanApplication";

export interface HttpRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface HttpResponse {
  status: number;
  body?: unknown;
}

interface RecordView {
  data: Record<string, unknown>;
  meta: {
    id: string;
    caseId?: string;
    entityType: string;
    version: number;
    createdSeq: number;
    updatedSeq: number;
    deleted: boolean;
  };
}

function toRecord(row: StoredEntity): RecordView {
  const meta: RecordView["meta"] = {
    id: row.id,
    entityType: row.entityType,
    version: row.version,
    createdSeq: row.createdSeq,
    updatedSeq: row.updatedSeq,
    deleted: row.deleted,
  };
  if (row.caseId !== undefined) meta.caseId = row.caseId;
  return { data: row.data, meta };
}

function notFound(id: string): HttpResponse {
  return {
    status: 404,
    body: { code: "entity-not-found", message: `no live ${ENTITY_TYPE} with id '${id}'` },
  };
}

function validationError(errors: string[]): HttpResponse {
  return {
    status: 422,
    body: { code: "validation-failed", message: "request body failed boundary validation", errors },
  };
}

export class Bff {
  constructor(
    private readonly store: EntityStore,
    private readonly contract: Contract,
  ) {}

  handle(req: HttpRequest): HttpResponse {
    const matched = this.contract.match(req.method, req.path);
    if (!matched)
      return {
        status: 404,
        body: { code: "entity-not-found", message: `no route for ${req.method} ${req.path}` },
      };
    const { operationId, operation, params } = matched;

    switch (operationId) {
      case "LoanApplications_create": {
        const check = this.contract.validateRequestBody(operation, req.body);
        if (!check.valid) return validationError(check.errors);
        const id = String((req.body as Record<string, unknown>)?.["id"] ?? this.nextId());
        const created = this.store.create(ENTITY_TYPE, id, undefined, req.body ?? {});
        return { status: 201, body: toRecord(created) };
      }
      case "LoanApplications_list":
        return { status: 200, body: this.list(req.query ?? {}) };
      case "LoanApplications_read": {
        const row = this.store.get(ENTITY_TYPE, params["id"]!);
        return row ? { status: 200, body: toRecord(row) } : notFound(params["id"]!);
      }
      case "LoanApplications_update": {
        const check = this.contract.validateRequestBody(operation, req.body);
        if (!check.valid) return validationError(check.errors);
        try {
          const updated = this.store.update(ENTITY_TYPE, params["id"]!, req.body ?? {});
          return { status: 200, body: toRecord(updated) };
        } catch (err) {
          if (err instanceof EntityNotFoundError) return notFound(params["id"]!);
          throw err;
        }
      }
      case "LoanApplications_remove": {
        try {
          this.store.delete(ENTITY_TYPE, params["id"]!);
          return { status: 204 };
        } catch (err) {
          if (err instanceof EntityNotFoundError) return notFound(params["id"]!);
          throw err;
        }
      }
      default:
        return {
          status: 404,
          body: { code: "entity-not-found", message: `unsupported operation ${operationId}` },
        };
    }
  }

  private idCounter = 0;

  private nextId(): string {
    return `${ENTITY_TYPE}-${this.idCounter++}`;
  }

  private list(query: Record<string, string>): unknown {
    const filter: Record<string, string> = {};
    if (query["status"] !== undefined) filter["status"] = query["status"];
    if (query["productCode"] !== undefined) filter["productCode"] = query["productCode"];
    const page = query["page"] !== undefined ? Number(query["page"]) : 0;
    const size = query["size"] !== undefined ? Number(query["size"]) : 50;
    const result = this.store.query({
      entityType: ENTITY_TYPE,
      filter,
      search: query["search"],
      sort: query["sort"],
      page,
      size,
    });
    return {
      total: result.total,
      page: result.page,
      size: result.size,
      items: result.items.map(toRecord),
    };
  }
}
