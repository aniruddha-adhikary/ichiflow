import "@typespec/http";
import "@typespec/openapi";
import "@typespec/json-schema";
import "./entity.tsp";
import "./service.tsp";

using TypeSpec.Http;
using TypeSpec.JsonSchema;

/**
 * The **generated BFF API** over the domain entity store (build plan 4.2; ADR-0018, doc 02 §5). The
 * entity store's CRUD/query surface is exposed as an HTTP API authored *once* in TypeSpec, from which
 * the OpenAPI 3.1 document, the JSON Schema request/response contracts, and the typed edges are all
 * emitted — so the **same JSON Schema that types callers validates every request and response at the
 * runtime boundary** (zero-drift). These record/page shapes and the API-contract vector DSL live in
 * the `@jsonSchema` `Ichiflow.Entity` namespace so they emit as standalone JSON Schema too (the
 * boundary validators); the HTTP operations that reference them are added to the BFF service below.
 */
namespace Ichiflow.Entity {
  /** A persisted record as returned over the API — the entity payload plus store-owned metadata. */
  model LoanApplicationRecord {
    data: LoanApplication;
    meta: EntityMeta;
  }

  /** A page of full records for the list endpoint (detail rows, in the query's deterministic order). */
  model LoanApplicationPage {
    @minValue(0)
    total: int32;

    @minValue(0)
    page: int32;

    @minValue(1)
    size: int32;

    items: LoanApplicationRecord[];
  }

  /** The HTTP method exercised by an API-contract vector step. */
  union ApiMethod {
    get: "GET",
    post: "POST",
    patch: "PATCH",
    delete: "DELETE",
  }

  /**
   * One request of an API-contract **conformance vector** (build plan 4.2, harness-first). Drives the
   * generated BFF and pins the expected HTTP status; positive requests pin the returned record id /
   * version or list ids / total, negative requests pin the boundary-rejection error code (the runtime
   * JSON-Schema validation firing at the edge).
   */
  model ApiRequest {
    method: ApiMethod;

    /** Request path relative to the API root, e.g. `/loan-applications/app-1`. */
    path: string;

    /** Query parameters for the list endpoint (name → stringified value). */
    query?: Record<string>;

    /** JSON request body for create/update (validated against `LoanApplication` at the boundary). */
    body?: Record<unknown>;

    /** The pinned HTTP status this request must return. */
    expectStatus: int32;

    /** For a record response: assert `meta.id`. */
    expectBodyId?: string;

    /** For a record response: assert `meta.version`. */
    expectVersion?: int32;

    /** For a list response: assert the total match count. */
    expectTotal?: int32;

    /** For a list response: assert the returned record ids in deterministic order. */
    expectIds?: string[];

    /** For a 4xx response: assert the error `code`. */
    expectErrorCode?: string;
  }

  /**
   * One committed **API-contract conformance vector** (build plan 4.2): a named sequence of HTTP
   * requests against the generated BFF, each pinned to a status + response shape. Proves the API
   * conforms to the emitted OpenAPI and that runtime JSON-Schema validation guards every boundary.
   */
  model ApiContractVector {
    name: string;
    requests: ApiRequest[];
  }
}

/**
 * The BFF entity-store operations, authored on the same service as the verify status API so they emit
 * into the single OpenAPI document. CRUD + list over the reference entity; runtime JSON-Schema
 * validation at the boundary surfaces as `422 validation-failed`, a missing/soft-deleted record as
 * `404 entity-not-found`.
 */
namespace Ichiflow.VerifyApi {
  using Ichiflow.Entity;

  @error
  model EntityNotFound {
    @statusCode statusCode: 404;
    code: "entity-not-found";
    message: string;
  }

  @error
  model BoundaryValidationError {
    @statusCode statusCode: 422;
    code: "validation-failed";
    message: string;

    /** Structured validation errors (Ajv messages) — never prose. */
    errors: string[];
  }

  model LoanApplicationCreated {
    @statusCode statusCode: 201;

    @body record: LoanApplicationRecord;
  }

  model LoanApplicationDeleted {
    @statusCode statusCode: 204;
  }

  @route("/loan-applications")
  interface LoanApplications {
    /** Create a LoanApplication (boundary-validated); 201 with the persisted record, or 422. */
    @post create(@body data: LoanApplication): LoanApplicationCreated | BoundaryValidationError;

    /** List LoanApplications with deterministic sort/pagination + exact-match/free-text filtering. */
    @get list(
      @query page?: int32,
      @query size?: int32,
      @query sort?: string,
      @query search?: string,
      @query status?: LoanStatus,
      @query productCode?: string,
    ): LoanApplicationPage;

    /** Fetch a single live LoanApplication by id, or 404 if absent/soft-deleted. */
    @route("/{id}")
    @get
    read(@path id: string): LoanApplicationRecord | EntityNotFound;

    /** Update a LoanApplication (boundary-validated); increments version, or 404/422. */
    @route("/{id}")
    @patch
    update(@path id: string, @body data: LoanApplication):
      | LoanApplicationRecord
      | BoundaryValidationError
      | EntityNotFound;

    /** Soft-delete a LoanApplication; 204, or 404 if absent. */
    @route("/{id}")
    @delete
    remove(@path id: string): LoanApplicationDeleted | EntityNotFound;
  }
}
