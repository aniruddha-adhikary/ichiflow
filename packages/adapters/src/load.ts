import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterPort, Mapping, MappingGoldenVector, ReliabilityVector } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root relative to the built `dist/` dir (`packages/adapters/dist` → repo root). */
export const repoRoot = join(here, "..", "..", "..");

const ADAPTERS_DIR = join(repoRoot, "schemas", "adapters");

function loadDir<T>(sub: string, suffix: string): T[] {
  const dir = join(ADAPTERS_DIR, sub);
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
}

export function loadMappings(): Mapping[] {
  return loadDir<Mapping>("mappings", ".mapping.json");
}

export function loadPorts(): AdapterPort[] {
  return loadDir<AdapterPort>("ports", ".port.json");
}

export function loadGoldens(): MappingGoldenVector[] {
  return loadDir<MappingGoldenVector>("goldens", ".golden.json");
}

export function loadReliabilityVectors(): ReliabilityVector[] {
  return loadDir<ReliabilityVector>("reliability", ".vector.json");
}
