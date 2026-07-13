import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from the built `dist/` location (packages/uischema/dist → repo root). */
export const repoRoot = join(here, "..", "..", "..");

export const DATA_SCHEMA_ID = "LoanApplication.json";
export const generatedSchemaDir = join(repoRoot, "schemas", "generated", "json-schema");
export const baselineDir = join(repoRoot, "schemas", "ui", "baseline");
export const baselineFile = join(baselineDir, "loan-application.uischema.json");
export const snapshotDir = join(repoRoot, "packages", "uischema", "snapshots");
export const buildDir = join(repoRoot, "packages", "uischema", "build");
export const resultsFile = join(buildDir, "ui-results.json");
