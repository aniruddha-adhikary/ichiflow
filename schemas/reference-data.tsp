import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * Reference data as a first-class governed artifact class — the **CodeSet**
 * ([02-schema-foundation.md](../docs/architecture/02-schema-foundation.md) §9;
 * [ADR-0025](../docs/adr/0025-reference-data-ownership-and-teams.md)). A CodeSet is a schema'd,
 * row-structured, semver-versioned, effective-dated reference table, owned by a Team. CodeSets are
 * **interdependent**: a row may carry `codeRef` columns pinning a row in another `CodeSet@version`,
 * and that referential integrity is validated across versions and effective dates (§9.4). This file
 * authors the artifact contract; the `reference-data` verify scope enforces the integrity rules.
 */
@jsonSchema
namespace Ichiflow.ReferenceData;

/** A reference to a governed CodeSet row, pinning the version used (§9.3). */
model CodeRef {
  /** The referenced row's `code`, e.g. `XA`. */
  code: string;

  /** The referenced set as `id@version`, e.g. `countries@2026.2.0`. */
  codeSet: string;
}

/** Per-audience display metadata for a code — one source for every Portal audience (§9.2). */
model CodeDisplay {
  /** Technical/system label for back-office and machine audiences. */
  technical?: string;

  /** Professional label for expert operators. */
  professionalLabel?: string;

  /** Plain-language, per-locale label (BCP-47 key → text) for lay/customer audiences. */
  plainLanguage?: Record<string>;
}

/**
 * Effective-dated window. `from` is inclusive; `to` is exclusive and `null` means open-ended.
 * Referential integrity is bitemporal against this window, not "exists today" (§9.4).
 */
model EffectiveWindow {
  from: plainDate;
  to: plainDate | null;
}

/** Governance lifecycle state of a CodeSet (§9.1). */
union GovernanceState {
  draft: "draft",
  inReview: "in-review",
  released: "released",
  deprecated: "deprecated",
}

/** One code row. `codeRefs` are foreign-key-like columns into other CodeSets (§9.4). */
model CodeRow {
  /** Stable code within the set, e.g. `NC_TEMP_IMPORT`. */
  code: string;

  display?: CodeDisplay;

  /** Row-level effective window; defaults to the set's window when absent. */
  effective?: EffectiveWindow;

  /** A deprecated row is not `live`: it cannot be the target of a codeRef (§9.4). */
  deprecated?: boolean;

  /** Foreign-key columns keyed by column name (e.g. `country` → countries@…). */
  codeRefs?: Record<CodeRef>;
}

/** Owning Team + named stewards — metadata mirror of the authz ownership relation (§9.1, doc 06). */
model CodeSetOwner {
  /** Owning Team id, e.g. `trade-policy-team`. */
  team: string;

  /** Named steward principal ids accountable for the rows. */
  stewards: string[];
}

/** Per-artifact governance override of the Workspace/tier dial (§9.1, doc 03 §5.6/§5.8). */
model CodeSetGovernance {
  /** Governance level for this artifact, e.g. `full` | `light`. */
  level: string;

  /** How approval is routed, e.g. `owning-team-role`. */
  routeApprovalBy?: string;
}

/** CodeSet identity + governance metadata. */
model CodeSetMetadata {
  /** CodeSet id, e.g. `obligations`. */
  id: string;

  /** Semver; breaking row/schema changes are gated like any other contract. */
  version: string;

  governanceState: GovernanceState;

  /** The set-level effective window. */
  effective: EffectiveWindow;

  owner: CodeSetOwner;

  governance?: CodeSetGovernance;
}

/**
 * A governed CodeSet — checked in, registry-versioned, effective-dated. Decisions, Flows, and the UI
 * reference it by `id@version`; they never inline its rows (§9.1).
 */
model CodeSet {
  kind: "CodeSet";

  metadata: CodeSetMetadata;

  /** Repo-relative path to the row-shape JSON Schema, if the rows carry a declared shape (§9.2). */
  schema?: string;

  rows: CodeRow[];
}
