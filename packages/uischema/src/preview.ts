import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runAxeAA } from "./axe.js";
import { checkContrast } from "./contrast.js";
import { lintScopes } from "./lint.js";
import {
  DATA_SCHEMA_ID,
  baselineFile,
  buildDir,
  generatedSchemaDir,
  resultsFile,
  snapshotDir,
} from "./paths.js";
import { renderStoryDocument, renderStoryFragment } from "./render.js";
import { loadSchemaBundle, schemaVersion } from "./schema-io.js";
import { reconcileSnapshots } from "./snapshots.js";
import { buildStories } from "./stories.js";
import { PDP_STATES, type UiSchema } from "./types.js";

/**
 * The `pnpm ui:preview` **producer** (build plan 4.5): render every PDP-state story headlessly, run
 * axe-core over each, reconcile the serialized-DOM snapshots, evaluate the token-contract contrast
 * gate, and write a deterministic machine-readable results artifact to
 * `packages/uischema/build/ui-results.json`. The `ui` verify scope reads that artifact and asserts
 * over it — the producer→scope split every other harness uses.
 *
 * Determinism: no wall-clock, no RNG, no network. `UI_UPDATE_SNAPSHOTS=1` (re)writes the committed
 * snapshot baselines instead of comparing.
 */
async function main(): Promise<void> {
  const update = process.env.UI_UPDATE_SNAPSHOTS === "1";
  const bundle = loadSchemaBundle(generatedSchemaDir);
  const currentVersion = schemaVersion(generatedSchemaDir, DATA_SCHEMA_ID);

  const ui = JSON.parse(readFileSync(baselineFile, "utf8")) as UiSchema;

  const provenanceCurrent =
    ui.dataSchema.id === DATA_SCHEMA_ID && ui.dataSchema.version === currentVersion;

  const dataSchema = bundle[DATA_SCHEMA_ID]!;
  const dangling = lintScopes(ui, dataSchema, "schemas/ui/baseline/loan-application.uischema.json");
  const controls = ui.layout.elements?.filter((e) => e.type === "Control").length ?? 0;

  const stories = buildStories(ui, DATA_SCHEMA_ID, bundle);
  const placedControls = stories.length / PDP_STATES.length;
  const statesRequired = placedControls * PDP_STATES.length;

  const fragments: { id: string; html: string }[] = [];
  const violations: { story: string; ruleId: string; impact: string }[] = [];
  let statesCovered = 0;
  let aaPass = 0;

  for (const story of stories) {
    const fragment = renderStoryFragment(story);
    if (fragment.length > 0) statesCovered += 1;
    fragments.push({ id: story.id, html: fragment });

    const found = await runAxeAA(renderStoryDocument(story));
    if (found.length === 0) aaPass += 1;
    for (const v of found) violations.push({ story: story.id, ruleId: v.ruleId, impact: v.impact });
  }

  const snapshots = reconcileSnapshots(snapshotDir, fragments, update);
  const contrast = checkContrast();

  const results = {
    dataSchemaId: DATA_SCHEMA_ID,
    dataSchemaVersion: currentVersion,
    provenanceCurrent,
    scopeLint: {
      clean: dangling.length === 0,
      controls,
      dangling: [...dangling].sort((a, b) => a.pointer.localeCompare(b.pointer)),
    },
    states: { required: statesRequired, covered: statesCovered },
    axe: {
      storiesRun: stories.length,
      aaPass,
      violations: violations.sort(
        (a, b) => a.story.localeCompare(b.story) || a.ruleId.localeCompare(b.ruleId),
      ),
    },
    contrast: {
      total: contrast.length,
      pass: contrast.filter((c) => c.pass).length,
      checks: contrast,
    },
    snapshots,
  };

  mkdirSync(buildDir, { recursive: true });
  writeFileSync(resultsFile, JSON.stringify(results, null, 2) + "\n");

  const summary = {
    scopeLintClean: results.scopeLint.clean,
    statesCovered: `${statesCovered}/${statesRequired}`,
    axeAaPass: `${aaPass}/${stories.length}`,
    snapshotsMatched: `${snapshots.matched}/${snapshots.produced}`,
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
}

main().catch((err: unknown) => {
  process.stderr.write(String(err instanceof Error ? err.stack : err) + "\n");
  process.exitCode = 1;
});
