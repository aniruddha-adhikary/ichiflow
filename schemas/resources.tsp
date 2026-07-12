import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * The resources manifest (BRIEF §12; doc 10 §2.5) — the diffable record of *what an agent may
 * reach for*: version pins (engines, TCK, generators) so "which version" is a fact not ambient
 * knowledge, and named resources (skills, blessed patterns, harness pointers). Seeded in Phase 0.3;
 * grows as each subsystem's manifest entries come online.
 */
@jsonSchema
namespace Ichiflow.Resources;

/** A pinned external dependency: an exact version an agent and CI both read. */
model VersionPin {
  /** Pin id, e.g. `apache-kie`, `dmn-tck`, `fabrikt`. */
  id: string;

  /** Exact version or commit, e.g. `10.2.0` or a git sha. */
  version: string;

  /** Why this pin exists / what reruns on a bump. */
  note?: string;
}

/** Kind of a named resource an agent can reach for. */
union ResourceKind {
  skill: "skill",
  pattern: "pattern",
  harness: "harness",
  schema: "schema",
  generated: "generated",
}

/** A named, discoverable resource in the Workspace. */
model Resource {
  /** Resource id, e.g. `run-verify`, `SeededAllocate`. */
  id: string;

  kind: ResourceKind;

  /** Repo-relative path to the resource's definition, if it has one. */
  path?: string;

  description?: string;
}

/** The manifest root — a governed, schema-validated Workspace artifact. */
model ResourcesManifest {
  /** Manifest schema version. */
  version: string;

  pins: VersionPin[];
  resources: Resource[];
}
