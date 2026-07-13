import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConformance } from "./conformance.js";
import { loadVectors } from "./vectors.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Producer for the `flow-layer` scope: run the generic interpreter over every committed conformance
 * vector and write the verdict artifact the scope reads. Keeps the scope a pure, deterministic read.
 */
async function main(): Promise<void> {
  const vectors = loadVectors();
  const result = await runConformance({ workflowsPath: join(here, "interpreter.js"), vectors });
  const outPath = join(here, "..", "build", "flow-conformance-results.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `flow conformance: ${result.vectorsGreen}/${result.vectors.length} vectors green, ` +
      `determinismClean=${result.determinismClean} → ${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
