/**
 * Deterministic in-memory entity store — the TS reference binding of the Repository SPI (build plan
 * 4.1/4.2, ADR-0018) that the generated BFF sits on. Mirrors the Kotlin `InMemoryEntityRepository`:
 * monotonic sequence stamps (no wall-clock/RNG), CRUD + soft-delete + optimistic version, an
 * append-only audit log, and a transactional outbox written atomically with every mutation. The
 * persistence pick stays open (ADR-0018); this binding exists so the API's contract is verifiable.
 */

export type EntityOp = "create" | "update" | "delete";

export interface StoredEntity {
  id: string;
  caseId?: string;
  entityType: string;
  version: number;
  createdSeq: number;
  updatedSeq: number;
  deleted: boolean;
  data: Record<string, unknown>;
}

export interface AuditEntry {
  seq: number;
  id: string;
  entityType: string;
  operation: EntityOp;
  version: number;
  caseId?: string;
}

export interface OutboxRecord {
  seq: number;
  id: string;
  entityType: string;
  operation: EntityOp;
  caseId?: string;
  delivered: boolean;
}

export interface QuerySpec {
  entityType: string;
  filter?: Record<string, string>;
  search?: string;
  sort?: string;
  page?: number;
  size?: number;
}

export interface PageResult {
  total: number;
  page: number;
  size: number;
  items: StoredEntity[];
}

export class EntityNotFoundError extends Error {
  constructor(entityType: string, id: string) {
    super(`no live ${entityType} with id '${id}'`);
    this.name = "EntityNotFoundError";
  }
}

export class DuplicateEntityError extends Error {
  constructor(entityType: string, id: string) {
    super(`${entityType} with id '${id}' already exists`);
    this.name = "DuplicateEntityError";
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export class EntityStore {
  private readonly rows = new Map<string, StoredEntity>();
  private readonly auditEntries: AuditEntry[] = [];
  private readonly outboxRecords: OutboxRecord[] = [];
  private seqCounter = 0;
  private auditSeq = 0;
  private outboxSeq = 0;

  private key(entityType: string, id: string): string {
    return `${entityType}\u0000${id}`;
  }

  private record(
    entityType: string,
    id: string,
    operation: EntityOp,
    version: number,
    caseId?: string,
  ): void {
    this.auditEntries.push({ seq: this.auditSeq++, id, entityType, operation, version, caseId });
    this.outboxRecords.push({
      seq: this.outboxSeq++,
      id,
      entityType,
      operation,
      caseId,
      delivered: false,
    });
  }

  create(
    entityType: string,
    id: string,
    caseId: string | undefined,
    data: Record<string, unknown>,
  ): StoredEntity {
    const key = this.key(entityType, id);
    const existing = this.rows.get(key);
    if (existing && !existing.deleted) throw new DuplicateEntityError(entityType, id);
    const seq = this.seqCounter++;
    const row: StoredEntity = {
      id,
      caseId,
      entityType,
      version: 1,
      createdSeq: seq,
      updatedSeq: seq,
      deleted: false,
      data,
    };
    this.rows.set(key, row);
    this.record(entityType, id, "create", 1, caseId);
    return { ...row };
  }

  get(entityType: string, id: string): StoredEntity | undefined {
    const row = this.rows.get(this.key(entityType, id));
    if (!row || row.deleted) return undefined;
    return { ...row };
  }

  update(entityType: string, id: string, data: Record<string, unknown>): StoredEntity {
    const key = this.key(entityType, id);
    const row = this.rows.get(key);
    if (!row || row.deleted) throw new EntityNotFoundError(entityType, id);
    const updated: StoredEntity = {
      ...row,
      version: row.version + 1,
      updatedSeq: this.seqCounter++,
      data,
    };
    this.rows.set(key, updated);
    this.record(entityType, id, "update", updated.version, updated.caseId);
    return { ...updated };
  }

  delete(entityType: string, id: string): void {
    const key = this.key(entityType, id);
    const row = this.rows.get(key);
    if (!row || row.deleted) throw new EntityNotFoundError(entityType, id);
    const deleted: StoredEntity = {
      ...row,
      version: row.version + 1,
      updatedSeq: this.seqCounter++,
      deleted: true,
    };
    this.rows.set(key, deleted);
    this.record(entityType, id, "delete", deleted.version, deleted.caseId);
  }

  query(spec: QuerySpec): PageResult {
    const page = spec.page ?? 0;
    const size = spec.size ?? 50;
    let matches = [...this.rows.values()].filter(
      (r) => r.entityType === spec.entityType && !r.deleted,
    );

    for (const [field, wanted] of Object.entries(spec.filter ?? {})) {
      matches = matches.filter((r) => stringify(r.data[field]) === wanted);
    }
    if (spec.search) {
      const needle = spec.search.toLowerCase();
      matches = matches.filter((r) =>
        Object.values(r.data).some((v) => stringify(v).toLowerCase().includes(needle)),
      );
    }

    const sortField = spec.sort;
    matches.sort((a, b) => {
      if (sortField) {
        const av = stringify(a.data[sortField]);
        const bv = stringify(b.data[sortField]);
        if (av !== bv) return av < bv ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const total = matches.length;
    const start = page * size;
    const items = matches.slice(start, start + size).map((r) => ({ ...r }));
    return { total, page, size, items };
  }

  auditLog(): AuditEntry[] {
    return this.auditEntries.map((e) => ({ ...e }));
  }

  outbox(): OutboxRecord[] {
    return this.outboxRecords.map((r) => ({ ...r }));
  }

  relayOutbox(): number {
    let dispatched = 0;
    for (const r of this.outboxRecords) {
      if (!r.delivered) {
        r.delivered = true;
        dispatched++;
      }
    }
    return dispatched;
  }
}
