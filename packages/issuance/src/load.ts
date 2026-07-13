import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Doctemplate, IssuanceVector, VerificationVector } from "./types.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "schemas",
  "issuance",
);

function readAll<T>(sub: string, suffix: string): T[] {
  const dir = join(FIXTURES, sub);
  return readdirSync(dir)
    .filter((file) => file.endsWith(suffix))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as T);
}

export function loadTemplates(): Doctemplate[] {
  return readAll("templates", ".doctemplate.json");
}

export function loadIssuanceVectors(): IssuanceVector[] {
  return readAll("vectors", ".vector.json");
}

export function loadVerificationVectors(): VerificationVector[] {
  return readAll("verification", ".vector.json");
}
