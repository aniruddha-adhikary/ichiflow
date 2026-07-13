import type { CanonicalEnvelope, Mapping, MappingRule } from "./types.js";

/**
 * The **Message-Translator** (doc 05 §2) — the declarative, **pure** function from a decoded wire
 * message to a `CanonicalEnvelope`. Purity is the load-bearing invariant: no I/O, no cross-message
 * state, no enrichment-by-lookup, so `translate(mapping, wire)` is deterministic and its golden pairs
 * are stable. A `copy`/`copyNumber` reads a wire JSON Pointer (RFC 6901); a `constant` writes a literal.
 */

export class MappingError extends Error {}

/** Resolve an RFC 6901 JSON Pointer against a decoded wire message; returns `undefined` for a missing path. */
function resolvePointer(doc: unknown, pointer: string): unknown {
  if (pointer === "") return doc;
  if (!pointer.startsWith("/")) {
    throw new MappingError(`pointer must start with "/": ${JSON.stringify(pointer)}`);
  }
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = doc;
  for (const token of tokens) {
    if (current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
}

/** Write `value` into `target` at a dotted canonical path (e.g. `applicant.id`), creating intermediate objects. */
function setDotted(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = node[key];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      node[key] = created;
      node = created;
    } else {
      node = next as Record<string, unknown>;
    }
  }
  node[parts[parts.length - 1]!] = value;
}

function applyRule(rule: MappingRule, wire: unknown, payload: Record<string, unknown>): void {
  if (rule.operation === "constant") {
    setDotted(payload, rule.to, rule.value);
    return;
  }
  if (rule.from === undefined) {
    throw new MappingError(`rule for "${rule.to}" with op ${rule.operation} requires "from"`);
  }
  const raw = resolvePointer(wire, rule.from);
  if (raw === undefined) {
    if (rule.optional) return;
    throw new MappingError(`required wire value missing at ${rule.from} (→ ${rule.to})`);
  }
  if (rule.operation === "copyNumber") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (
      typeof raw !== "number" &&
      (typeof raw !== "string" || raw.trim() === "" || Number.isNaN(n))
    ) {
      throw new MappingError(
        `value at ${rule.from} is not coercible to a number: ${JSON.stringify(raw)}`,
      );
    }
    setDotted(payload, rule.to, n);
    return;
  }
  setDotted(payload, rule.to, raw);
}

function requireString(doc: unknown, pointer: string, label: string): string {
  const v = resolvePointer(doc, pointer);
  if (typeof v !== "string" || v.length === 0) {
    throw new MappingError(
      `${label} at ${pointer} must be a non-empty string, got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

/** Translate a decoded wire message into a canonical envelope using a versioned mapping. Pure and deterministic. */
export function translate(mapping: Mapping, wire: Record<string, unknown>): CanonicalEnvelope {
  const payload: Record<string, unknown> = {};
  for (const rule of mapping.rules) applyRule(rule, wire, payload);
  return {
    kind: mapping.kind,
    type: mapping.canonicalType,
    messageId: requireString(wire, mapping.messageIdFrom, "messageId"),
    correlationId: requireString(wire, mapping.correlationFrom, "correlationId"),
    caseId: requireString(wire, mapping.caseIdFrom, "caseId"),
    payload,
  };
}
