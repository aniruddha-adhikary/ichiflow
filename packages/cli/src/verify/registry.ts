import type { Scope } from "./types.js";
import { selfCheckScope } from "./scopes/self-check.js";
import { agentKitScope } from "./scopes/agent-kit.js";
import { schemaFidelitySpikeScope } from "./scopes/schema-fidelity-spike.js";
import { schemaPipelineScope } from "./scopes/schema-pipeline.js";
import { codegenScope } from "./scopes/codegen.js";

/**
 * The scope registry — the harness catalog (doc 13 §2) as it comes online phase by phase.
 * Phase 0 registers the two spine scopes; Phase 1 appends the schema-pipeline harnesses.
 */
const SCOPES: Scope[] = [
  selfCheckScope,
  agentKitScope,
  schemaFidelitySpikeScope,
  schemaPipelineScope,
  codegenScope,
];

export function allScopes(): Scope[] {
  return [...SCOPES];
}

export function scopeById(id: string): Scope | undefined {
  return SCOPES.find((s) => s.id === id);
}

export function scopeIds(): string[] {
  return SCOPES.map((s) => s.id);
}
