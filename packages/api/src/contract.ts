import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { parse as parseYaml } from "yaml";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

/**
 * The emitted OpenAPI 3.1 contract, loaded as the single source of truth for the generated BFF's
 * boundary validation (doc 02 §5). Every request body and every response is validated against the
 * *same* component schemas the OpenAPI document declares — so "conforms to the emitted OpenAPI" is a
 * runtime fact, not a claim. Component `$ref`s (`#/components/schemas/X`) are rewritten to Ajv `$id`s.
 */

interface MediaType {
  schema?: { $ref?: string };
}
interface Response {
  content?: Record<string, MediaType>;
}
interface Operation {
  operationId?: string;
  requestBody?: { content?: Record<string, MediaType> };
  responses?: Record<string, Response>;
}
type PathItem = Record<string, Operation>;
interface OpenApiDoc {
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, unknown> };
}

const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;

/** Resolve the emitted OpenAPI path from the `@ichiflow/schemas` package (sibling of json-schema). */
export function openApiPath(): string {
  const jsonSchemaDir = dirname(require.resolve("@ichiflow/schemas/verdict-envelope"));
  return join(jsonSchemaDir, "..", "openapi3", "openapi.yaml");
}

/** Deeply rewrite `#/components/schemas/X` refs to bare Ajv `$id`s (`X`). */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string") {
        out.$ref = value.replace("#/components/schemas/", "");
      } else {
        out[key] = rewriteRefs(value);
      }
    }
    return out;
  }
  return node;
}

export interface MatchedOperation {
  operationId: string;
  pathTemplate: string;
  operation: Operation;
  params: Record<string, string>;
}

export class Contract {
  private readonly doc: OpenApiDoc;
  private readonly ajv: Ajv2020;

  constructor(openApiYaml: string) {
    this.doc = parseYaml(openApiYaml) as OpenApiDoc;
    this.ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
    addFormats(this.ajv);
    for (const [name, schema] of Object.entries(this.doc.components?.schemas ?? {})) {
      this.ajv.addSchema({ $id: name, ...(rewriteRefs(schema) as object) }, name);
    }
  }

  static load(): Contract {
    return new Contract(readFileSync(openApiPath(), "utf8"));
  }

  /** All BFF operationIds declared in the contract (for coverage assertions). */
  operationIds(): string[] {
    const ids: string[] = [];
    for (const item of Object.values(this.doc.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (op?.operationId) ids.push(op.operationId);
      }
    }
    return ids.sort();
  }

  /** Match a concrete (method, path) to a declared operation, extracting path params. */
  match(method: string, path: string): MatchedOperation | undefined {
    const wantSegments = path.split("/").filter((s) => s.length > 0);
    for (const [template, item] of Object.entries(this.doc.paths ?? {})) {
      const op = item[method.toLowerCase()];
      if (!op) continue;
      const tplSegments = template.split("/").filter((s) => s.length > 0);
      if (tplSegments.length !== wantSegments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < tplSegments.length; i++) {
        const tpl = tplSegments[i]!;
        const seg = wantSegments[i]!;
        if (tpl.startsWith("{") && tpl.endsWith("}")) params[tpl.slice(1, -1)] = seg;
        else if (tpl !== seg) {
          ok = false;
          break;
        }
      }
      if (ok)
        return {
          operationId: op.operationId ?? `${method} ${template}`,
          pathTemplate: template,
          operation: op,
          params,
        };
    }
    return undefined;
  }

  private validator(ref: string): ValidateFunction | undefined {
    const name = ref.replace("#/components/schemas/", "");
    return this.ajv.getSchema(name);
  }

  /** Validate a create/update request body against the operation's declared requestBody schema. */
  validateRequestBody(op: Operation, body: unknown): { valid: boolean; errors: string[] } {
    const ref = op.requestBody?.content?.["application/json"]?.schema?.$ref;
    if (!ref) return { valid: true, errors: [] };
    return this.runValidator(ref, body);
  }

  /** Validate a response body against the operation's declared response schema for `status`. */
  validateResponse(
    op: Operation,
    status: number,
    body: unknown,
  ): { valid: boolean; errors: string[] } {
    const response = op.responses?.[String(status)];
    if (!response)
      return { valid: false, errors: [`no ${status} response declared in the contract`] };
    const ref = response.content?.["application/json"]?.schema?.$ref;
    if (!ref)
      return {
        valid: body === undefined,
        errors: body === undefined ? [] : ["response declares no body but one was returned"],
      };
    return this.runValidator(ref, body);
  }

  private runValidator(ref: string, value: unknown): { valid: boolean; errors: string[] } {
    const validate = this.validator(ref);
    if (!validate) return { valid: false, errors: [`no component schema for ${ref}`] };
    const valid = validate(value) as boolean;
    const errors = (validate.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    );
    return { valid, errors };
  }
}
