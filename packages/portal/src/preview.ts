import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runHarness } from "./harness.js";

/**
 * `pnpm portal:preview` — the deterministic producer (doc 13 §2.e, producer→scope split). Runs the
 * Portal harness headlessly and writes the results artifact the `portal` verify scope reads. Mirrors
 * `api:contract` → `packages/api/build/api-contract-results.json`.
 */
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "build");
  const outFile = join(outDir, "portal-results.json");

  const results = await runHarness();

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n");
  console.log(`Portal preview harness wrote ${outFile}`);
  console.log(
    `  inbox principals: ${results.inbox.length}; signal emitted: ${results.signal.emitted}; ` +
      `trace nodes: ${results.trace.nodeIds.length}; chain complete: ${results.trace.chainComplete}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
