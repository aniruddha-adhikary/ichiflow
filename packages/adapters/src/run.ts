import { decode, V1_BINDINGS, type TransportFrame } from "./bindings.js";
import { loadGoldens, loadMappings, loadPorts, loadReliabilityVectors } from "./load.js";
import { translate } from "./mapping.js";
import { evaluateVector } from "./reliability.js";
import type { AdapterPort, AdapterProtocol, CanonicalEnvelope, Mapping } from "./types.js";

export interface GoldenOutcome {
  name: string;
  mappingId: string;
  match: boolean;
  actual: CanonicalEnvelope | null;
  error: string | null;
}

export interface BindingContractOutcome {
  portId: string;
  protocol: AdapterProtocol;
  /** A representative frame in the port's protocol decoded and re-translated to the golden's canonical output. */
  roundTrips: boolean;
  error: string | null;
}

export interface ReliabilityOutcomeRecord {
  name: string;
  scenario: string;
  expected: { applied: number; deduped: number; dlq: number };
  actual: { applied: number; deduped: number; dlq: number };
  pass: boolean;
}

export interface AdaptersResult {
  mappingsCount: number;
  portsCount: number;
  goldens: GoldenOutcome[];
  goldensGreen: number;
  bindings: Array<{ protocol: AdapterProtocol; inboundPorts: number; covered: boolean }>;
  bindingsCovered: boolean;
  bindingContract: BindingContractOutcome[];
  bindingContractGreen: number;
  reliability: ReliabilityOutcomeRecord[];
  reliabilityGreen: number;
  dedupPass: boolean;
  dlqPass: boolean;
  redeliveryPass: boolean;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/** Stable, order-independent object serialization so a golden match does not depend on key order. */
function canonicalize(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(v as Record<string, unknown>).sort()) {
    out[key] = canonicalize((v as Record<string, unknown>)[key]);
  }
  return out;
}

function frameFor(protocol: AdapterProtocol, wire: Record<string, unknown>): TransportFrame {
  // Reconstruct a transport frame from a decoded wire message so decode() round-trips it back.
  switch (protocol) {
    case "rest":
      return { protocol: "rest", body: wire };
    case "broker": {
      const { _headers, ...body } = wire as Record<string, unknown> & {
        _headers?: Record<string, string>;
      };
      return { protocol: "broker", headers: _headers ?? {}, body };
    }
    case "webhook": {
      const { _query, ...body } = wire as Record<string, unknown> & {
        _query?: Record<string, string>;
      };
      return { protocol: "webhook", query: _query ?? {}, body };
    }
  }
}

/**
 * Compute the full adapter-harness verdict from the committed fixtures (doc 13 §2.d): mapping goldens
 * (`input wire → expected canonical`), per-binding contract round-trips (decode ∘ translate reproduces
 * the golden through each transport profile), and the reliability vectors (dedup / DLQ / redelivery).
 * Pure and deterministic — no I/O beyond the committed fixture read.
 */
export function runAdapters(): AdaptersResult {
  const mappings = loadMappings();
  const ports = loadPorts();
  const goldens = loadGoldens();
  const reliabilityVectors = loadReliabilityVectors();

  const mappingById = new Map<string, Mapping>(mappings.map((m) => [m.id, m]));
  const goldenByMapping = new Map<string, Record<string, unknown>>();

  const goldenOutcomes: GoldenOutcome[] = goldens.map((g) => {
    const mapping = mappingById.get(g.mappingId);
    if (!mapping) {
      return {
        name: g.name,
        mappingId: g.mappingId,
        match: false,
        actual: null,
        error: `no mapping ${g.mappingId}`,
      };
    }
    try {
      const actual = translate(mapping, g.wire);
      goldenByMapping.set(g.mappingId, g.wire);
      return {
        name: g.name,
        mappingId: g.mappingId,
        match: deepEqual(actual, g.expected),
        actual,
        error: null,
      };
    } catch (err) {
      return {
        name: g.name,
        mappingId: g.mappingId,
        match: false,
        actual: null,
        error: (err as Error).message,
      };
    }
  });

  // Binding coverage: every v1 transport profile must have at least one inbound port.
  const bindings = V1_BINDINGS.map((protocol) => {
    const inboundPorts = ports.filter(
      (p) => p.protocol === protocol && p.direction === "inbound",
    ).length;
    return { protocol, inboundPorts, covered: inboundPorts > 0 };
  });
  const bindingsCovered = bindings.every((b) => b.covered);

  // Contract round-trip: for each port, take a golden wire for its mapping, wrap it in the port's
  // transport frame, decode it back, translate, and confirm it reproduces the golden's canonical output.
  const bindingContract: BindingContractOutcome[] = ports.map((port: AdapterPort) => {
    const mapping = mappingById.get(port.mapping);
    const wire = goldenByMapping.get(port.mapping);
    if (!mapping || !wire) {
      return {
        portId: port.id,
        protocol: port.protocol,
        roundTrips: false,
        error: "no golden wire for port mapping",
      };
    }
    try {
      const canonicalDirect = translate(mapping, wire);
      const decoded = decode(frameFor(port.protocol, wire));
      const canonicalViaBinding = translate(mapping, decoded);
      return {
        portId: port.id,
        protocol: port.protocol,
        roundTrips: deepEqual(canonicalDirect, canonicalViaBinding),
        error: null,
      };
    } catch (err) {
      return {
        portId: port.id,
        protocol: port.protocol,
        roundTrips: false,
        error: (err as Error).message,
      };
    }
  });

  const reliability = reliabilityVectors.map(evaluateVector);
  const scenarioPass = (s: string): boolean =>
    reliability.filter((r) => r.scenario === s).every((r) => r.pass) &&
    reliability.some((r) => r.scenario === s);

  return {
    mappingsCount: mappings.length,
    portsCount: ports.length,
    goldens: goldenOutcomes,
    goldensGreen: goldenOutcomes.filter((g) => g.match).length,
    bindings,
    bindingsCovered,
    bindingContract,
    bindingContractGreen: bindingContract.filter((b) => b.roundTrips).length,
    reliability,
    reliabilityGreen: reliability.filter((r) => r.pass).length,
    dedupPass: scenarioPass("duplicate"),
    dlqPass: scenarioPass("poison"),
    redeliveryPass: scenarioPass("redelivery"),
  };
}
