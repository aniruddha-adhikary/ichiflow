import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNotifications } from "./run.js";

function main(): void {
  const result = runNotifications();
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "build", "notifications-results.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `notifications: render=${result.renderGoldensGreen}/${result.renderGoldens.length}, ` +
      `driver-selection=${result.driverSelectionGreen}/${result.driverSelection.length}, ` +
      `reliability=${result.reliabilityGreen}/${result.reliability.length} ` +
      `(dedup=${result.dedupPass}, dlq=${result.dlqPass}, redelivery=${result.redeliveryPass}) → ${outPath}`,
  );
}

main();
