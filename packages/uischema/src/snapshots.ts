import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SnapshotOutcome {
  produced: number;
  matched: number;
  drift: { story: string; detail: string }[];
}

/** The committed serialized-DOM baseline path for a story (doc 07 §12 preview snapshots). */
export function snapshotPath(snapshotDir: string, storyId: string): string {
  return join(snapshotDir, `${storyId}.html`);
}

/**
 * Compare freshly rendered story fragments against the committed snapshot baselines (or write them in
 * update mode). Serialized DOM only — never pixels — and byte-exact: any drift is a failure the `ui`
 * scope surfaces. In update mode (`UI_UPDATE_SNAPSHOTS=1`) baselines are (re)written and all match.
 */
export function reconcileSnapshots(
  snapshotDir: string,
  fragments: { id: string; html: string }[],
  update: boolean,
): SnapshotOutcome {
  if (update) mkdirSync(snapshotDir, { recursive: true });
  const drift: { story: string; detail: string }[] = [];
  let matched = 0;

  for (const { id, html } of fragments) {
    const path = snapshotPath(snapshotDir, id);
    const content = html.endsWith("\n") ? html : html + "\n";
    if (update) {
      writeFileSync(path, content);
      matched += 1;
      continue;
    }
    if (!existsSync(path)) {
      drift.push({
        story: id,
        detail: "no committed snapshot baseline; run `pnpm ui:preview` update",
      });
      continue;
    }
    const committed = readFileSync(path, "utf8");
    if (committed === content) matched += 1;
    else drift.push({ story: id, detail: "rendered snapshot differs from committed baseline" });
  }

  return { produced: fragments.length, matched, drift };
}
