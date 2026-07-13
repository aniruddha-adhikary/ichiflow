import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toy3Step, TOY_RESULT_VAR } from "./flows/toy-3step.js";
import { runInterpreterSpike } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Producer for the `interpreter-determinism-spike` scope (mirrors the JVM producers): run the
 * determinism harness against the *built* interpreter workflow and write the verdict artifact the
 * verify scope reads. Keeps the scope a pure, deterministic read of a committed-shape result file.
 */
async function main(): Promise<void> {
  const result = await runInterpreterSpike({
    workflowsPath: join(here, "interpreter.js"),
    flow: toy3Step,
    resultVar: TOY_RESULT_VAR,
  });
  const outPath = join(here, "..", "build", "interpreter-spike-results.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `interpreter spike: result=${result.result} (expected ${result.expected}), ` +
      `replayClean=${result.replayClean}, fastForwarded=${result.sla.fastForwarded} → ${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
