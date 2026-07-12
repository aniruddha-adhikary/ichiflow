/**
 * The CodeSet referential-integrity engine (build plan 1.4, ADR-0025 / doc 02 §9.4). CodeSets are
 * interdependent: a row may carry `codeRef` columns pinning a row in another `CodeSet@version`.
 * This module resolves those references across versions and checks them bitemporally — a referenced
 * row must exist, be **live** (non-deprecated), and its effective window must **cover** the
 * referencing row's window. The logic is pure and deterministic so it can be exercised on synthetic
 * sets (both valid and deliberately-broken) without touching disk.
 */

export interface EffectiveWindow {
  /** Inclusive ISO `plainDate` (YYYY-MM-DD). */
  from: string;
  /** Exclusive ISO `plainDate`; `null` means open-ended. */
  to: string | null;
}

export interface CodeRef {
  code: string;
  /** `id@version`, e.g. `countries@2026.2.0`. */
  codeSet: string;
}

export interface CodeRow {
  code: string;
  deprecated?: boolean;
  effective?: EffectiveWindow;
  codeRefs?: Record<string, CodeRef>;
}

export interface CodeSetDoc {
  kind: "CodeSet";
  metadata: {
    id: string;
    version: string;
    governanceState: string;
    effective: EffectiveWindow;
  };
  rows: CodeRow[];
}

export interface CodeRefCheck {
  /** Stable id, e.g. `natures-covered@1.0.0.NC_TEMP_IMPORT.country`. */
  id: string;
  /** Human-readable source coordinate. */
  from: string;
  /** Referenced coordinate, e.g. `countries@2026.2.0 code XA`. */
  target: string;
  resolves: boolean;
  resolveDetail?: string;
  /** `null` when the reference did not resolve (coverage is then not meaningful). */
  effectiveCovered: boolean | null;
  effectiveDetail?: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface IntegrityReport {
  checks: CodeRefCheck[];
  edges: DependencyEdge[];
}

function setKey(id: string, version: string): string {
  return `${id}@${version}`;
}

/** `true` iff window `outer` fully covers window `inner` (both `from` inclusive, `to` exclusive). */
export function windowCovers(outer: EffectiveWindow, inner: EffectiveWindow): boolean {
  if (outer.from > inner.from) return false;
  if (outer.to === null) return true;
  if (inner.to === null) return false;
  return inner.to <= outer.to;
}

/**
 * Resolve and bitemporally validate every `codeRef` across the given CodeSets. Returns one check per
 * codeRef plus the CodeSet→CodeSet dependency edges (the "what depends on this" graph, §9.4).
 */
export function checkReferentialIntegrity(sets: CodeSetDoc[]): IntegrityReport {
  const byKey = new Map<string, CodeSetDoc>();
  for (const s of sets) byKey.set(setKey(s.metadata.id, s.metadata.version), s);

  const checks: CodeRefCheck[] = [];
  const edges: DependencyEdge[] = [];

  for (const s of sets) {
    const srcKey = setKey(s.metadata.id, s.metadata.version);
    for (const row of s.rows) {
      const refs = row.codeRefs ?? {};
      for (const [column, ref] of Object.entries(refs)) {
        const id = `${srcKey}.${row.code}.${column}`;
        const from = `${srcKey} row ${row.code} col ${column}`;
        const target = `${ref.codeSet} code ${ref.code}`;
        edges.push({ from: srcKey, to: ref.codeSet });

        const targetSet = byKey.get(ref.codeSet);
        if (!targetSet) {
          checks.push({
            id,
            from,
            target,
            resolves: false,
            resolveDetail: `referenced set ${ref.codeSet} not found`,
            effectiveCovered: null,
          });
          continue;
        }
        const targetRow = targetSet.rows.find((r) => r.code === ref.code);
        if (!targetRow) {
          checks.push({
            id,
            from,
            target,
            resolves: false,
            resolveDetail: `code ${ref.code} not found in ${ref.codeSet}`,
            effectiveCovered: null,
          });
          continue;
        }
        if (targetRow.deprecated === true) {
          checks.push({
            id,
            from,
            target,
            resolves: false,
            resolveDetail: `code ${ref.code} in ${ref.codeSet} is deprecated (not a live target)`,
            effectiveCovered: null,
          });
          continue;
        }

        const srcWindow = row.effective ?? s.metadata.effective;
        const targetWindow = targetRow.effective ?? targetSet.metadata.effective;
        const covered = windowCovers(targetWindow, srcWindow);
        checks.push({
          id,
          from,
          target,
          resolves: true,
          effectiveCovered: covered,
          effectiveDetail: covered
            ? undefined
            : `target window [${targetWindow.from}, ${targetWindow.to ?? "∞"}) does not cover referencing window [${srcWindow.from}, ${srcWindow.to ?? "∞"})`,
        });
      }
    }
  }

  return { checks, edges };
}
