import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assert } from "../check.js";
import type { CheckResult, Scope, ScopeContext } from "../types.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

/**
 * agent-kit — build plan chunk 0.3. Proves the in-repo agent kit is present and coherent:
 * the resources manifest schema-validates, the agent instruction files exist, the first skills
 * are seeded, and the scoped-verify hook is wired (the only guaranteed-execution layer, doc 10 §2.2).
 */
function run(ctx: ScopeContext): CheckResult[] {
  const checks: CheckResult[] = [];
  const { repoRoot } = ctx;

  const exists = (rel: string) => existsSync(join(repoRoot, rel));
  const requireFile = (id: string, rel: string) =>
    checks.push(assert(id, exists(rel), { expected: { present: rel }, diff: `missing ${rel}` }));

  requireFile("agent-kit.agents-md", "AGENTS.md");
  requireFile("agent-kit.claude-md", "CLAUDE.md");
  requireFile("agent-kit.skill-add-schema", ".claude/skills/add-schema/SKILL.md");
  requireFile("agent-kit.skill-run-verify", ".claude/skills/run-verify/SKILL.md");
  requireFile("agent-kit.hook-settings", ".claude/settings.json");

  // The PostToolUse hook must actually invoke a scoped `ichiflow verify` (guaranteed execution).
  if (exists(".claude/settings.json")) {
    let hookWired = false;
    let detail = "no PostToolUse hook running a scoped/incremental `verify` found";
    try {
      const settings = JSON.parse(readFileSync(join(repoRoot, ".claude/settings.json"), "utf8"));
      const hooks = settings?.hooks?.PostToolUse ?? [];
      const flat = JSON.stringify(hooks);
      hookWired = flat.includes("verify") && (flat.includes("--since") || flat.includes("--scope"));
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
    checks.push(assert("agent-kit.hook-runs-scoped-verify", hookWired, { diff: detail }));
  }

  // The resources manifest exists and validates against its generated JSON Schema contract.
  const manifestRel = ".ichiflow/resources.manifest.yaml";
  if (!exists(manifestRel)) {
    checks.push(
      assert("agent-kit.resources-manifest-validates", false, {
        diff: `missing ${manifestRel}`,
      }),
    );
  } else {
    const validation = validateManifest(readFileSync(join(repoRoot, manifestRel), "utf8"));
    checks.push(
      assert("agent-kit.resources-manifest-validates", validation.valid, {
        expected: { valid: true },
        actual: { valid: false },
        diff: validation.errors.join("; "),
      }),
    );
  }

  return checks;
}

function validateManifest(yamlText: string): { valid: boolean; errors: string[] } {
  const entry = require.resolve("@ichiflow/schemas/resources-manifest");
  const dir = dirname(entry);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json")) {
      ajv.addSchema(JSON.parse(readFileSync(join(dir, file), "utf8")));
    }
  }
  const validate = ajv.getSchema("ResourcesManifest.json");
  if (!validate) return { valid: false, errors: ["ResourcesManifest.json schema not found"] };
  let data: unknown;
  try {
    data = parseYaml(yamlText);
  } catch (err) {
    return { valid: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
  const valid = validate(data) as boolean;
  const errors = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`);
  return { valid, errors };
}

export const agentKitScope: Scope = {
  id: "agent-kit",
  description:
    "Proves the in-repo agent kit (instructions, skills, hook, resources manifest) is coherent.",
  run,
};
