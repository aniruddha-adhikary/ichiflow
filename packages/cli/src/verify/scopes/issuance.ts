import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, fail } from "../check.js";
import { generatedSchemaDir } from "../envelope.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const ISSUANCE_REL = "schemas/issuance";
const RESULTS_REL = "packages/issuance/build/issuance-results.json";
const PRODUCER =
  "pnpm --filter @ichiflow/issuance build && pnpm --filter @ichiflow/issuance preview";

interface IssuanceResult {
  render: Array<{
    binding: string;
    deterministic: boolean;
    bindingScopeClean: boolean;
    accessible: boolean;
  }>;
  lifecycle: Array<{ name: string; pass: boolean }>;
  lifecycleGreen: number;
  replayIdempotent: boolean;
  replayNoDoubleConsume: boolean;
  verification: Array<{ name: string; pass: boolean }>;
  verificationGreen: number;
  allocation: { gapfreeContiguous: boolean; gappedOk: boolean };
}

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  for (const file of readdirSync(generatedSchemaDir())) {
    if (file.endsWith(".json")) {
      ajv.addSchema(JSON.parse(readFileSync(join(generatedSchemaDir(), file), "utf8")));
    }
  }
  return ajv;
}

function validateFixtures(
  ajv: Ajv2020,
  checks: CheckResult[],
  repoRoot: string,
  sub: string,
  suffix: string,
  schemaName: string,
): void {
  const dir = join(repoRoot, ISSUANCE_REL, sub);
  const validate = ajv.getSchema(schemaName);
  if (!validate) {
    checks.push(fail(`issuance.schema-present.${schemaName}`, { diff: `missing ${schemaName}` }));
    return;
  }
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith(suffix))
        .sort()
    : [];
  checks.push(
    assert(`issuance.fixtures-present.${sub}`, files.length > 0, {
      diff: `no ${suffix} fixtures in ${ISSUANCE_REL}/${sub}`,
    }),
  );
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const valid = validate(fixture);
    checks.push(
      assert(`issuance.contract.${sub}.${file}`, valid === true, {
        expected: `${file} conforms to ${schemaName}`,
        actual: valid ? "valid" : ajv.errorsText(validate.errors),
      }),
    );
  }
}

/** Phase 5.3 issuance gate (doc 13 §2.k): deterministic render, lifecycle/replay, and verification. */
export const issuanceScope: Scope = {
  id: "issuance",
  description:
    "Document issuance: TypeSpec-valid Document/doctemplate/vectors, deterministic Typst-default rendering, binding/a11y checks, exactly-once numbering, lifecycle, replay idempotency, and data-minimal public verification.",
  run({ repoRoot }: ScopeContext): CheckResult[] {
    const checks: CheckResult[] = [];
    const ajv = buildAjv();

    validateFixtures(ajv, checks, repoRoot, "templates", ".doctemplate.json", "Doctemplate.json");
    validateFixtures(ajv, checks, repoRoot, "documents", ".document.json", "Document.json");
    validateFixtures(ajv, checks, repoRoot, "vectors", ".vector.json", "IssuanceVector.json");
    validateFixtures(
      ajv,
      checks,
      repoRoot,
      "verification",
      ".vector.json",
      "DocumentVerificationVector.json",
    );

    const resultsPath = join(repoRoot, RESULTS_REL);
    if (!existsSync(resultsPath)) {
      checks.push(
        fail("issuance.results-present", {
          diff: `missing ${RESULTS_REL}; run \`${PRODUCER}\``,
        }),
      );
      return checks;
    }

    const result = JSON.parse(readFileSync(resultsPath, "utf8")) as IssuanceResult;
    for (const render of result.render) {
      checks.push(
        assert(`issuance.render-deterministic.${render.binding}`, render.deterministic, {
          expected: "normalized-identical bytes across two renders",
          actual: render.deterministic ? "pass" : "bytes differ",
        }),
      );
      checks.push(
        assert(`issuance.binding-scope.${render.binding}`, render.bindingScopeClean, {
          expected: "every doctemplate binding resolves",
          actual: render.bindingScopeClean ? "clean" : "dangling binding",
        }),
      );
      checks.push(
        assert(`issuance.accessibility.${render.binding}`, render.accessible, {
          expected: "PDF/UA marker and contrast thresholds satisfied",
          actual: render.accessible ? "pass" : "fail",
        }),
      );
    }
    checks.push({
      id: "issuance.lifecycle-vectors-green",
      status:
        result.lifecycle.length > 0 && result.lifecycleGreen === result.lifecycle.length
          ? "pass"
          : "fail",
      metric: "lifecycle_vectors_green",
      value: result.lifecycleGreen,
      threshold: result.lifecycle.length,
    });
    checks.push(
      assert("issuance.replay-idempotent", result.replayIdempotent, {
        expected: "replay allocates once and emits one issued event",
        actual: result.replayIdempotent ? "pass" : "fail",
      }),
    );
    checks.push(
      assert("issuance.replay-no-double-consume", result.replayNoDoubleConsume, {
        expected: "replay does not consume the number counter twice",
        actual: result.replayNoDoubleConsume ? "pass" : "fail",
      }),
    );
    checks.push({
      id: "issuance.verification-vectors-green",
      status:
        result.verification.length > 0 && result.verificationGreen === result.verification.length
          ? "pass"
          : "fail",
      metric: "verification_vectors_green",
      value: result.verificationGreen,
      threshold: result.verification.length,
    });
    checks.push(
      assert("issuance.allocation-gapfree-contiguous", result.allocation.gapfreeContiguous, {
        expected: "gap-free allocations are contiguous",
        actual: result.allocation.gapfreeContiguous ? "pass" : "fail",
      }),
    );
    checks.push(
      assert("issuance.allocation-gapped", result.allocation.gappedOk, {
        expected: "gapped allocation remains monotonic",
        actual: result.allocation.gappedOk ? "pass" : "fail",
      }),
    );
    return checks;
  },
};
