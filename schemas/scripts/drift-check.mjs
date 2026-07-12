// Regenerate-and-diff drift check for the schema pipeline (doc 02 §4.3, doc 13 §2.a).
// Recompiles TypeSpec into a temp dir and asserts the checked-in `generated/` outputs are
// byte-identical. Any delta is a failed check — the committed artifact is the contract of record.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const committedDir = join(projectRoot, "generated", "json-schema");
const tmp = mkdtempSync(join(tmpdir(), "ichiflow-schema-drift-"));

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath ?? e.path, e.name)))
    .sort();
}

try {
  execFileSync(
    process.execPath,
    [
      join(projectRoot, "node_modules", "@typespec", "compiler", "cmd", "tsp.js"),
      "compile",
      ".",
      "--option",
      `@typespec/json-schema.emitter-output-dir=${tmp}`,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );

  const committed = listFiles(committedDir);
  const regenerated = listFiles(tmp);
  const drifted = [];

  const allNames = new Set([...committed, ...regenerated]);
  for (const name of allNames) {
    const a = committed.includes(name) ? readFileSync(join(committedDir, name), "utf8") : null;
    const b = regenerated.includes(name) ? readFileSync(join(tmp, name), "utf8") : null;
    if (a !== b) drifted.push(name);
  }

  if (drifted.length > 0) {
    console.error("Schema drift detected in:", drifted.join(", "));
    console.error("Run `pnpm --filter @ichiflow/schemas build` and commit the result.");
    process.exit(1);
  }
  console.log(`Schema drift clean (${committed.length} generated file(s) match).`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
