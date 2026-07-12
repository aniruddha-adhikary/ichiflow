// Regenerate-and-diff drift check for the schema pipeline (doc 02 §4.3, doc 13 §2.a).
// Recompiles TypeSpec into a temp dir and asserts every checked-in `generated/` output is
// byte-identical. Any delta is a failed check — the committed artifact is the contract of record.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "ichiflow-schema-drift-"));

// Each emitter writes to its own subdir; regenerate all of them and compare the whole tree.
const EMITTERS = [
  { option: "@typespec/json-schema", subdir: "json-schema" },
  { option: "@typespec/openapi3", subdir: "openapi3" },
];

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
      ...EMITTERS.flatMap((e) => [
        "--option",
        `${e.option}.emitter-output-dir=${join(tmp, e.subdir)}`,
      ]),
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );

  const drifted = [];
  let matched = 0;

  for (const { subdir } of EMITTERS) {
    const committedDir = join(projectRoot, "generated", subdir);
    const regenDir = join(tmp, subdir);
    const names = new Set([...listFiles(committedDir), ...listFiles(regenDir)]);
    for (const name of names) {
      const rel = join(subdir, name);
      const a = existsSync(join(committedDir, name))
        ? readFileSync(join(committedDir, name), "utf8")
        : null;
      const b = existsSync(join(regenDir, name)) ? readFileSync(join(regenDir, name), "utf8") : null;
      if (a !== b) drifted.push(rel);
      else matched++;
    }
  }

  if (drifted.length > 0) {
    console.error("Schema drift detected in:", drifted.join(", "));
    console.error("Run `pnpm --filter @ichiflow/schemas build` and commit the result.");
    process.exit(1);
  }
  console.log(`Schema drift clean (${matched} generated file(s) match).`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
