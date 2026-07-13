import { mkdirSync, writeFileSync } from "node:fs";
import { generateBaseline } from "./generator.js";
import { loadSchemaBundle, schemaVersion } from "./schema-io.js";
import { DATA_SCHEMA_ID, baselineDir, baselineFile, generatedSchemaDir } from "./paths.js";

/**
 * Emit the **generated-once baseline uischema** for the `LoanApplication` data schema and commit it
 * (doc 07 §3 rule 1). This is a one-way generator: it produces the designer's starting point, it does
 * not overwrite a designer-owned document during verify. Deterministic — pure function of the emitted
 * data schema — so re-running is a no-op unless the data schema changed.
 */
function main(): void {
  const bundle = loadSchemaBundle(generatedSchemaDir);
  const version = schemaVersion(generatedSchemaDir, DATA_SCHEMA_ID);
  const ui = generateBaseline(DATA_SCHEMA_ID, bundle, version);
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(baselineFile, JSON.stringify(ui, null, 2) + "\n");
  process.stdout.write(`wrote ${baselineFile}\n`);
}

main();
