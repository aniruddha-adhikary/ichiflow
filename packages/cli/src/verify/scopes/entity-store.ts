import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const VECTORS_REL = "schemas/entity-store/vectors";
const VECTOR_SCHEMA = "EntityStoreVector.json";
const ENTITY_SCHEMA = "LoanApplication.json";
const RESULTS_REL = "core/build/entity-store-results.json";
const PRODUCER = "pnpm entity:jvm";

interface VectorOutcome {
  name: string;
  entityType: string;
  pass: boolean;
  detail: string;
  outboxSize: number;
  delivered: number;
}

interface EntityStoreResult {
  vectors: VectorOutcome[];
  vectorsGreen: number;
  total: number;
  outboxDelivered: number;
  outboxTotal: number;
}

interface VectorOp {
  operation: string;
  data?: unknown;
}

interface VectorDoc {
  name?: string;
  ops?: VectorOp[];
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
 * entity-store — build plan 4.1 (ADR-0018, ADR-0012, doc 13). The domain entity store is the home the
 * design review found missing for ordinary business records (a `LoanApplication` that is queryable /
 * editable / listable / searchable). It is CRUD + audit-log + **transactional outbox**, not
 * event-sourced (ADR-0011). This scope gates the Repository SPI's reference binding in two parts.
 * **DSL-valid**: every committed conformance vector validates against the emitted `EntityStoreVector`
 * schema, and every persisted payload validates against the schema-defined entity (`LoanApplication`) —
 * the same JSON Schema that types callers validates at the store boundary (zero drift, doc 02 §5).
 * **Round-trip + outbox**: replaying each vector's CRUD/query ops against the SPI (produced by
 * `${PRODUCER}`) reproduces the pinned audit-log + outbox oracle in order, and relaying the outbox marks
 * every record delivered — the transactional-outbox liveness that later feeds adapters (Phase 5) and
 * read models. The reference binding is deterministic (monotonic sequence stamps, no wall-clock/RNG).
 */
export const entityStoreScope: Scope = {
  id: "entity-store",
  description:
    "The domain entity store (CRUD + audit-log + transactional outbox): committed vectors are DSL-valid, every payload conforms to the schema-defined entity, and each round-trips to its pinned audit/outbox oracle with the outbox fully delivered.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const vectorsDir = join(repoRoot, VECTORS_REL);

    if (!existsSync(vectorsDir)) {
      return [fail("entity-store.vectors-present", { diff: `missing ${VECTORS_REL}` })];
    }
    const vectorFiles = readdirSync(vectorsDir)
      .filter((f) => f.endsWith(".vector.json"))
      .sort();
    checks.push(
      assert("entity-store.vectors-present", vectorFiles.length > 0, {
        diff: `no *.vector.json fixtures in ${VECTORS_REL}`,
      }),
    );
    if (vectorFiles.length === 0) return checks;

    const ajv = buildAjv();
    const validateVector = ajv.getSchema(VECTOR_SCHEMA);
    const validateEntity = ajv.getSchema(ENTITY_SCHEMA);
    if (!validateVector || !validateEntity) {
      return [
        fail("entity-store.schema-present", {
          diff: `emitted ${VECTOR_SCHEMA}/${ENTITY_SCHEMA} not found; run pnpm --filter @ichiflow/schemas build`,
        }),
      ];
    }

    const vectorNames: string[] = [];
    for (const file of vectorFiles) {
      const doc = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as VectorDoc;
      const valid = validateVector(doc);
      checks.push(
        assert(`entity-store.dsl-valid.${file}`, valid === true, {
          expected: `${file} conforms to ${VECTOR_SCHEMA}`,
          actual: valid ? "valid" : ajv.errorsText(validateVector.errors),
        }),
      );
      if (typeof doc.name === "string") vectorNames.push(doc.name);

      // Every persisted payload must validate against the schema-defined entity (boundary validation).
      const payloads = (doc.ops ?? []).filter(
        (o) => (o.operation === "create" || o.operation === "update") && o.data !== undefined,
      );
      const badPayload = payloads.find((o) => validateEntity(o.data) !== true);
      checks.push(
        assert(`entity-store.entity-valid.${file}`, badPayload === undefined, {
          expected: `every create/update payload conforms to ${ENTITY_SCHEMA}`,
          actual: badPayload ? ajv.errorsText(validateEntity.errors) : "all valid",
        }),
      );
    }

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("entity-store.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\` to replay the vectors`,
        }),
      );
      return checks;
    }

    const r = JSON.parse(readFileSync(resultsPath, "utf8")) as EntityStoreResult;

    // The artifact must cover every committed vector — a vector added without a re-run is a stale verdict.
    const covered = new Set(r.vectors.map((v) => v.name));
    checks.push(
      assert(
        "entity-store.vectors-covered",
        vectorNames.every((n) => covered.has(n)),
        {
          expected: `results cover all ${vectorNames.length} committed vectors`,
          actual: `covers ${covered.size}; missing ${vectorNames.filter((n) => !covered.has(n)).join(", ") || "none"}`,
        },
      ),
    );

    for (const v of r.vectors) {
      checks.push(
        assert(`entity-store.round-trip.${v.name}`, v.pass, {
          expected: "vector round-trips to its pinned audit/outbox oracle",
          actual: v.detail,
        }),
      );
    }

    checks.push({
      id: "entity-store.vectors-green",
      status: r.vectorsGreen === r.total ? "pass" : "fail",
      metric: "vectors_green",
      value: r.vectorsGreen,
      threshold: r.total,
    });

    // Transactional-outbox liveness: every enqueued record is delivered by the relay (no dual-write gap).
    checks.push({
      id: "entity-store.outbox-delivered",
      status: r.outboxDelivered === r.outboxTotal && r.outboxTotal > 0 ? "pass" : "fail",
      metric: "outbox_delivered",
      value: r.outboxDelivered,
      threshold: r.outboxTotal,
    });

    return checks;
  },
};
