import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  NotificationGolden,
  NotificationReliabilityVector,
  NotificationTemplate,
} from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root relative to the built `dist/` dir (`packages/notifications/dist` → repo root). */
export const repoRoot = join(here, "..", "..", "..");

const NOTIFICATIONS_DIR = join(repoRoot, "schemas", "notifications");

function loadDir<T>(sub: string, suffix: string): T[] {
  const dir = join(NOTIFICATIONS_DIR, sub);
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
}

export function loadTemplates(): NotificationTemplate[] {
  return loadDir<NotificationTemplate>("templates", ".template.json");
}

export function loadGoldens(): NotificationGolden[] {
  return loadDir<NotificationGolden>("goldens", ".golden.json");
}

export function loadReliabilityVectors(): NotificationReliabilityVector[] {
  return loadDir<NotificationReliabilityVector>("reliability", ".vector.json");
}
