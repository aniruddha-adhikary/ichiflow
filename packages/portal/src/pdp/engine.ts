import type { RelationTuple } from "../types.js";

/**
 * A minimal, deterministic **OpenFGA-semantics** relation-check engine (doc 06 Part 2, ADR-0010).
 * It evaluates the SAME committed relation model as the `authz` PDP slice
 * (`schemas/authz/model.json`) — the Portal reuses one relation vocabulary rather than inventing a
 * second (doc 13 §2.f "design-time = runtime, one vector set"). Pure: `check` is a function of the
 * model + tuples only, with a cycle guard, no wall-clock / RNG.
 */

interface Rewrite {
  direct?: string[];
  computedUserset?: string;
  tupleToUserset?: { tupleset: string; relation: string };
  unionOf?: Rewrite[];
}

interface RelationDef {
  name: string;
  rewrite: Rewrite;
}

interface TypeDef {
  type: string;
  relations: RelationDef[];
}

export interface AuthzModel {
  schemaVersion: string;
  types: TypeDef[];
}

function typeOf(objectOrUser: string): string {
  return objectOrUser.split(":", 1)[0] ?? "";
}

export class Pdp {
  private readonly relationsByType = new Map<string, Map<string, RelationDef>>();

  constructor(
    model: AuthzModel,
    private readonly tuples: readonly RelationTuple[],
  ) {
    for (const t of model.types) {
      const rels = new Map<string, RelationDef>();
      for (const r of t.relations) rels.set(r.name, r);
      this.relationsByType.set(t.type, rels);
    }
  }

  /** Does `subject` (e.g. `user:eve`) hold `relation` on `object` (e.g. `case:c-100`)? */
  check(subject: string, relation: string, object: string): boolean {
    return this.checkInner(subject, relation, object, new Set<string>());
  }

  private checkInner(
    subject: string,
    relation: string,
    object: string,
    seen: Set<string>,
  ): boolean {
    const key = `${object}#${relation}@${subject}`;
    if (seen.has(key)) return false;
    seen.add(key);

    const def = this.relationsByType.get(typeOf(object))?.get(relation);
    if (!def) return false;
    return this.evalRewrite(subject, relation, def.rewrite, object, seen);
  }

  /** Evaluate a rewrite; `relation` is the owning relation name (threaded for `direct` tuple scans). */
  private evalRewrite(
    subject: string,
    relation: string,
    rewrite: Rewrite,
    object: string,
    seen: Set<string>,
  ): boolean {
    if (rewrite.unionOf) {
      return rewrite.unionOf.some((r) => this.evalRewrite(subject, relation, r, object, seen));
    }
    if (rewrite.computedUserset) {
      return this.checkInner(subject, rewrite.computedUserset, object, seen);
    }
    if (rewrite.tupleToUserset) {
      const { tupleset, relation: usersetRelation } = rewrite.tupleToUserset;
      for (const t of this.tuples) {
        if (t.object === object && t.relation === tupleset) {
          if (this.checkInner(subject, usersetRelation, t.user, seen)) return true;
        }
      }
      return false;
    }
    if (rewrite.direct) {
      return this.evalDirect(subject, relation, object, seen);
    }
    return false;
  }

  /** A `direct` rewrite: `subject` holds `relation` on `object` iff a tuple assigns it, expanding usersets. */
  private evalDirect(
    subject: string,
    relation: string,
    object: string,
    seen: Set<string>,
  ): boolean {
    for (const t of this.tuples) {
      if (t.object !== object || t.relation !== relation) continue;
      if (t.user === subject) return true;
      const hash = t.user.indexOf("#");
      if (hash !== -1) {
        const usersetObject = t.user.slice(0, hash);
        const usersetRelation = t.user.slice(hash + 1);
        if (this.checkInner(subject, usersetRelation, usersetObject, seen)) return true;
      }
    }
    return false;
  }

  /** The subset of `objects` on which `subject` holds `relation` — the reverse-index list-filter. */
  listVisible(subject: string, relation: string, objects: readonly string[]): string[] {
    return objects.filter((o) => this.check(subject, relation, o));
  }
}
