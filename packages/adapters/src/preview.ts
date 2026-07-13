import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAdapters } from "./run.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Producer for the `adapters` scope (build plan 5.1): run the mapping goldens, per-binding contract
 * round-trips, and the idempotency/DLQ reliability vectors, and write the verdict artifact the scope
 * reads. Keeps the scope a pure, deterministic read (doc 13 §2.d).
 */
function main(): void {
  const result = runAdapters();
  const outPath = join(here, "..", "build", "adapters-results.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `adapters: goldens ${result.goldensGreen}/${result.goldens.length}, ` +
      `binding-contract ${result.bindingContractGreen}/${result.bindingContract.length}, ` +
      `reliability ${result.reliabilityGreen}/${result.reliability.length} ` +
      `(dedup=${result.dedupPass}, dlq=${result.dlqPass}, redelivery=${result.redeliveryPass}) → ${outPath}`,
  );
}

main();
