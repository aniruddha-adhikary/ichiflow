import { describe, expect, it } from "vitest";
import { Bff } from "../src/bff.js";
import { Contract } from "../src/contract.js";
import { EntityStore, EntityNotFoundError, DuplicateEntityError } from "../src/store.js";
import { runVectors, type ApiContractVector } from "../src/vectors.js";

function bff(): Bff {
  return new Bff(new EntityStore(), Contract.load());
}

const valid = {
  id: "app-1",
  applicant: "Ada",
  amount: 100,
  productCode: "P-HOME",
  status: "submitted",
};

describe("EntityStore", () => {
  it("creates at version 1, updates increment, soft-delete hides", () => {
    const store = new EntityStore();
    const created = store.create("LoanApplication", "a", undefined, { applicant: "X" });
    expect(created.version).toBe(1);
    const updated = store.update("LoanApplication", "a", { applicant: "Y" });
    expect(updated.version).toBe(2);
    store.delete("LoanApplication", "a");
    expect(store.get("LoanApplication", "a")).toBeUndefined();
  });

  it("rejects duplicate create and missing update/delete", () => {
    const store = new EntityStore();
    store.create("LoanApplication", "a", undefined, {});
    expect(() => store.create("LoanApplication", "a", undefined, {})).toThrow(DuplicateEntityError);
    expect(() => store.update("LoanApplication", "z", {})).toThrow(EntityNotFoundError);
    expect(() => store.delete("LoanApplication", "z")).toThrow(EntityNotFoundError);
  });

  it("writes an audit entry + undelivered outbox record per mutation; relay is idempotent", () => {
    const store = new EntityStore();
    store.create("LoanApplication", "a", undefined, {});
    store.update("LoanApplication", "a", {});
    expect(store.auditLog().map((e) => e.operation)).toEqual(["create", "update"]);
    expect(store.outbox().every((r) => !r.delivered)).toBe(true);
    expect(store.relayOutbox()).toBe(2);
    expect(store.relayOutbox()).toBe(0);
  });

  it("queries with exact filter, free-text search, deterministic sort + pagination", () => {
    const store = new EntityStore();
    store.create("LoanApplication", "b", undefined, { applicant: "Bob", productCode: "P-AUTO" });
    store.create("LoanApplication", "a", undefined, { applicant: "Alice", productCode: "P-HOME" });
    store.create("LoanApplication", "c", undefined, { applicant: "Carol", productCode: "P-HOME" });
    expect(
      store
        .query({
          entityType: "LoanApplication",
          filter: { productCode: "P-HOME" },
          sort: "applicant",
        })
        .items.map((r) => r.id),
    ).toEqual(["a", "c"]);
    expect(
      store.query({ entityType: "LoanApplication", search: "bob" }).items.map((r) => r.id),
    ).toEqual(["b"]);
    const page0 = store.query({
      entityType: "LoanApplication",
      sort: "applicant",
      page: 0,
      size: 2,
    });
    expect(page0.total).toBe(3);
    expect(page0.items.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("Bff (generated, OpenAPI-driven)", () => {
  it("routes create → 201 with a conforming record", () => {
    const res = bff().handle({ method: "POST", path: "/loan-applications", body: valid });
    expect(res.status).toBe(201);
    expect((res.body as { meta: { id: string; version: number } }).meta).toMatchObject({
      id: "app-1",
      version: 1,
    });
  });

  it("rejects a malformed body at the boundary with 422", () => {
    const res = bff().handle({
      method: "POST",
      path: "/loan-applications",
      body: { id: "x", status: "nope" },
    });
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe("validation-failed");
    expect((res.body as { errors: string[] }).errors.length).toBeGreaterThan(0);
  });

  it("returns 404 for a missing/soft-deleted record", () => {
    const b = bff();
    b.handle({ method: "POST", path: "/loan-applications", body: valid });
    b.handle({ method: "DELETE", path: "/loan-applications/app-1" });
    const res = b.handle({ method: "GET", path: "/loan-applications/app-1" });
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe("entity-not-found");
  });

  it("lists with filter/sort/pagination via query params", () => {
    const b = bff();
    b.handle({ method: "POST", path: "/loan-applications", body: { ...valid, id: "app-1" } });
    b.handle({
      method: "POST",
      path: "/loan-applications",
      body: { ...valid, id: "app-2", applicant: "Bea" },
    });
    const res = b.handle({
      method: "GET",
      path: "/loan-applications",
      query: { sort: "applicant" },
    });
    expect(res.status).toBe(200);
    expect((res.body as { total: number }).total).toBe(2);
    expect((res.body as { items: { meta: { id: string } }[] }).items.map((i) => i.meta.id)).toEqual(
      ["app-1", "app-2"],
    );
  });
});

describe("contract conformance producer", () => {
  it("scores a hand-built vector against the emitted OpenAPI", () => {
    const vector: ApiContractVector = {
      name: "inline",
      requests: [
        {
          method: "POST",
          path: "/loan-applications",
          body: valid,
          expectStatus: 201,
          expectBodyId: "app-1",
          expectVersion: 1,
        },
        {
          method: "GET",
          path: "/loan-applications/app-1",
          expectStatus: 200,
          expectBodyId: "app-1",
        },
        {
          method: "POST",
          path: "/loan-applications",
          body: { id: "bad", status: "nope" },
          expectStatus: 422,
          expectErrorCode: "validation-failed",
        },
      ],
    };
    const result = runVectors([vector], Contract.load());
    expect(result.vectorsGreen).toBe(1);
    expect(result.boundaryRejections).toBe(1);
    expect(result.vectors[0]!.requests.every((r) => r.conforms && r.ok)).toBe(true);
  });

  it("flags a response that does not match the pinned expectation", () => {
    const vector: ApiContractVector = {
      name: "wrong-version",
      requests: [
        {
          method: "POST",
          path: "/loan-applications",
          body: valid,
          expectStatus: 201,
          expectVersion: 99,
        },
      ],
    };
    const result = runVectors([vector], Contract.load());
    expect(result.vectorsGreen).toBe(0);
    expect(result.vectors[0]!.requests[0]!.ok).toBe(false);
  });
});
