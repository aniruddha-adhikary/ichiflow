import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const VECTORS_REL = "schemas/entity-api/vectors";
const VECTOR_SCHEMA = "ApiContractVector.json";
const RESULTS_REL = "packages/api/build/api-contract-results.json";
const PRODUCER = "pnpm api:contract";

interface RequestResult {
  operationId: string;
  status: number;
  expectStatus: number;
  conforms: boolean;
  ok: boolean;
  detail: string;
}

interface VectorResult {
  name: string;
  green: boolean;
  requests: RequestResult[];
}

interface ContractRunResult {
  vectorsGreen: number;
  total: number;
  operationsCovered: string[];
  operationsDeclared: string[];
  boundaryRejections: number;
  vectors: VectorResult[];
}

interface VectorDoc {
  name?: string;
}

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  const dir = generatedSchemaDir();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    ajv.addSchema(JSON.parse(readFileSync(join(dir, file), "utf8")));
  }
  return ajv;
}

/**
 * entity-api — build plan 4.2 (ADR-0018, doc 02 §5). The **generated BFF** over the entity store: the
 * HTTP surface is authored once in TypeSpec and emitted to OpenAPI 3.1, and the *same* JSON Schema that
 * types callers validates every request and response at the runtime boundary (zero-drift). This scope
 * gates two things. **DSL-valid**: every committed API-contract vector validates against the emitted
 * `ApiContractVector` schema. **Contract conformance**: replaying each vector through the BFF (produced
 * by `${PRODUCER}`) yields responses that validate against the emitted OpenAPI response schemas and hit
 * the pinned statuses / ids / totals; every non-`Verify_status` operation is covered; and the boundary
 * validator provably rejects malformed writes (≥1 `422`). The reference binding is deterministic.
 */
export const entityApiScope: Scope = {
  id: "entity-api",
  description:
    "The generated BFF over the entity store: committed API-contract vectors are DSL-valid, every response conforms to the emitted OpenAPI, every entity operation is covered, and runtime boundary validation rejects malformed writes.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const vectorsDir = join(repoRoot, VECTORS_REL);

    if (!existsSync(vectorsDir)) {
      return [fail("entity-api.vectors-present", { diff: `missing ${VECTORS_REL}` })];
    }
    const vectorFiles = readdirSync(vectorsDir)
      .filter((f) => f.endsWith(".vector.json"))
      .sort();
    checks.push(
      assert("entity-api.vectors-present", vectorFiles.length > 0, {
        diff: `no *.vector.json fixtures in ${VECTORS_REL}`,
      }),
    );
    if (vectorFiles.length === 0) return checks;

    const ajv = buildAjv();
    const validateVector = ajv.getSchema(VECTOR_SCHEMA);
    if (!validateVector) {
      return [
        fail("entity-api.schema-present", {
          diff: `emitted ${VECTOR_SCHEMA} not found; run pnpm --filter @ichiflow/schemas build`,
        }),
      ];
    }

    const vectorNames: string[] = [];
    for (const file of vectorFiles) {
      const doc = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as VectorDoc;
      const valid = validateVector(doc);
      checks.push(
        assert(`entity-api.dsl-valid.${file}`, valid === true, {
          expected: `${file} conforms to ${VECTOR_SCHEMA}`,
          actual: valid ? "valid" : ajv.errorsText(validateVector.errors),
        }),
      );
      if (typeof doc.name === "string") vectorNames.push(doc.name);
    }

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("entity-api.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to replay the vectors through the BFF`,
        }),
      );
      return checks;
    }

    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as ContractRunResult;

    const covered = new Set(r.vectors.map((v) => v.name));
    checks.push(
      assert(
        "entity-api.vectors-covered",
        vectorNames.every((n) => covered.has(n)),
        {
          expected: `results cover all ${vectorNames.length} committed vectors`,
          actual: `covers ${covered.size}; missing ${vectorNames.filter((n) => !covered.has(n)).join(", ") || "none"}`,
        },
      ),
    );

    for (const v of r.vectors) {
      const bad = v.requests.find((rq) => !rq.ok);
      checks.push(
        assert(`entity-api.conforms.${v.name}`, v.green, {
          expected:
            "every response conforms to the emitted OpenAPI and hits its pinned expectation",
          actual: bad ? `${bad.operationId}: ${bad.detail}` : "all conform",
        }),
      );
    }

    // Contract-coverage: every entity-store operation the OpenAPI declares (all but the verify status
    // API) must be exercised by at least one vector — an un-hit operation is an untested boundary.
    const entityOps = r.operationsDeclared.filter((id) => id !== "Verify_status");
    const uncovered = entityOps.filter((id) => !r.operationsCovered.includes(id));
    checks.push(
      assert("entity-api.operations-covered", uncovered.length === 0, {
        expected: `all ${entityOps.length} entity operations covered`,
        actual: uncovered.length > 0 ? `uncovered: ${uncovered.join(", ")}` : "all covered",
      }),
    );

    // Runtime boundary validation must provably fire — a malformed write is rejected with 422.
    checks.push(
      assert("entity-api.boundary-rejects", r.boundaryRejections > 0, {
        expected: "≥1 malformed write rejected at the boundary (422 validation-failed)",
        actual: `${r.boundaryRejections} boundary rejection(s)`,
      }),
    );

    checks.push({
      id: "entity-api.vectors-green",
      status: r.vectorsGreen === r.total && r.total > 0 ? "pass" : "fail",
      metric: "vectors_green",
      value: r.vectorsGreen,
      threshold: r.total,
    });

    return checks;
  },
};
