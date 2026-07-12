import type { Scope } from "./types.js";
import { selfCheckScope } from "./scopes/self-check.js";
import { agentKitScope } from "./scopes/agent-kit.js";

/**
 * The scope registry — the harness catalog (doc 13 §2) as it comes online phase by phase.
 * Phase 0 registers the two spine scopes; later phases append (schema-pipeline, decision-layer, …).
 */
const SCOPES: Scope[] = [selfCheckScope, agentKitScope];

export function allScopes(): Scope[] {
  return [...SCOPES];
}

export function scopeById(id: string): Scope | undefined {
  return SCOPES.find((s) => s.id === id);
}

export function scopeIds(): string[] {
  return SCOPES.map((s) => s.id);
}
