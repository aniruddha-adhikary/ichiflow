import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract } from "./contract.js";
import { runVectors, type ApiContractVector } from "./vectors.js";

/**
 * Producer entry (build plan 4.2): loads the committed API-contract vectors, drives them through the
 * generated BFF, validates every response against the emitted OpenAPI, and writes the machine-readable
 * result the `entity-api` verify scope reads. Deterministic — no wall-clock, no RNG.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const vectorsDir = join(repoRoot, "schemas", "entity-api", "vectors");
const outDir = join(repoRoot, "packages", "api", "build");
const outFile = join(outDir, "api-contract-results.json");

function loadVectors(): ApiContractVector[] {
  return readdirSync(vectorsDir)
    .filter((f) => f.endsWith(".vector.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(vectorsDir, f), "utf8")) as ApiContractVector);
}

function main(): void {
  const contract = Contract.load();
  const result = runVectors(loadVectors(), contract);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
  const summary = {
    vectorsGreen: result.vectorsGreen,
    total: result.total,
    operationsCovered: result.operationsCovered.length,
    operationsDeclared: result.operationsDeclared.length,
    boundaryRejections: result.boundaryRejections,
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
}

main();
