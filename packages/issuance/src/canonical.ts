import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonicalize(object[key])]),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

export function immutableCopy<T>(value: T): T {
  return freezeTree(JSON.parse(stableJson(value)) as T);
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
