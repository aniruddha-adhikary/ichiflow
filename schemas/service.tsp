import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";
import "./verdict.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;
using Ichiflow.Verify;

/**
 * The verify status API (build plan chunk 1.1, ADR-0006). A minimal but real HTTP surface whose sole
 * purpose in Phase 1 is to exercise the TypeSpec→OpenAPI 3.1 emit + regenerate-and-diff drift path
 * on the same authoring source that feeds JSON Schema. It reuses the canonical `VerdictEnvelope`, so
 * the OpenAPI document and the JSON Schema stay derived from one model — the whole point of ADR-0006.
 */
@service(#{ title: "ichiflow verify API" })
@info(#{ version: "0.0.0" })
namespace Ichiflow.VerifyApi;

@error
model NotFound {
  @statusCode statusCode: 404;
  code: "scope-not-found";
  message: string;
}

@route("/verify")
interface Verify {
  /** Latest verdict for a scope, or 404 if the scope has never run. */
  @get status(@path scope: string): VerdictEnvelope | NotFound;
}
