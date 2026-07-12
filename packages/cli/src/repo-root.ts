import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walk up from `start` to the workspace root (marked by pnpm-workspace.yaml); fall back to `start`. */
export function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
