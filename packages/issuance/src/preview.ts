import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runIssuance } from "./run.js";

function main(): void {
  const result = runIssuance();
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "build", "issuance-results.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `issuance: render=${result.render.every((item) => item.deterministic)}, ` +
      `lifecycle=${result.lifecycleGreen}/${result.lifecycle.length}, ` +
      `verification=${result.verificationGreen}/${result.verification.length}, ` +
      `replay=${result.replayIdempotent} → ${outPath}`,
  );
}

main();
