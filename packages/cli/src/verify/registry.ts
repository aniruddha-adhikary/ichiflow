import type { Scope } from "./types.js";
import { selfCheckScope } from "./scopes/self-check.js";
import { agentKitScope } from "./scopes/agent-kit.js";
import { schemaFidelitySpikeScope } from "./scopes/schema-fidelity-spike.js";
import { schemaPipelineScope } from "./scopes/schema-pipeline.js";
import { codegenScope } from "./scopes/codegen.js";
import { contractVectorsScope } from "./scopes/contract-vectors.js";
import { referenceDataScope } from "./scopes/reference-data.js";
import { decisionProjectionSpikeScope } from "./scopes/decision-projection-spike.js";
import { decisionLayerScope } from "./scopes/decision-layer.js";
import { interpreterDeterminismSpikeScope } from "./scopes/interpreter-determinism-spike.js";
import { flowLayerScope } from "./scopes/flow-layer.js";
import { decisionRecordScope } from "./scopes/decisionrecord.js";
import { entityStoreScope } from "./scopes/entity-store.js";
import { entityApiScope } from "./scopes/entity-api.js";
import { authzScope } from "./scopes/authz.js";
import { portalScope } from "./scopes/portal.js";
import { codeQualityScope } from "./scopes/code-quality.js";
import { contractGateScope } from "./scopes/contract-gate.js";

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
  contractVectorsScope,
  referenceDataScope,
  decisionProjectionSpikeScope,
  contractGateScope,
  decisionLayerScope,
  interpreterDeterminismSpikeScope,
  flowLayerScope,
  decisionRecordScope,
  entityStoreScope,
  entityApiScope,
  authzScope,
  portalScope,
  codeQualityScope,
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
