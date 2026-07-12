// contract:accept — the deliberate, documented procedure to accept an intentional contract change
// (build plan chunk 1.4a). Copies the currently emitted OpenAPI over the released baseline, so the
// next `contract:diff` reports zero breaking changes. Run this ONLY when the breaking change is
// intended and reviewed; committing the updated baseline is the record of that acceptance.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const CURRENT_REL = "schemas/generated/openapi3/openapi.yaml";
const BASELINE_REL = "schemas/contract/openapi.baseline.yaml";

copyFileSync(join(repoRoot, CURRENT_REL), join(repoRoot, BASELINE_REL));
console.log(
  `contract:accept — copied ${CURRENT_REL} over ${BASELINE_REL}. Review and commit the baseline to record this contract change.`,
);
