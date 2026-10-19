import type Database from 'better-sqlite3';
import type { MirrorResource } from './types.js';

type StripeObject = Record<string, unknown>;

interface Denormalised {
  customerId: string | null;
  status: string | null;
  created: number | null;
  amount: number | null;
  currency: string | null;
}

function refId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' && id ? id : null;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Index columns only — `raw` is the source of truth. */
export function denormalise(resource: MirrorResource, obj: StripeObject): Denormalised {
  const isCustomer = resource === 'customers';
  return {
    customerId: isCustomer ? refId(obj.id) : refId(obj.customer),
    status: typeof obj.status === 'string' ? obj.status : null,
    created: numberOrNull(obj.created),
    amount: resource === 'charges' ? numberOrNull(obj.amount) : null,
    currency: typeof obj.currency === 'string' ? obj.currency : null,
  };
}

const UPSERT_SQL = `
  INSERT INTO stripe_mirror_objects
    (org_id, account_id, resource, stripe_id, customer_id, status, created, amount, currency, raw, synced_at, deleted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT(org_id, account_id, resource, stripe_id) DO UPDATE SET
    customer_id = excluded.customer_id, status = excluded.status, created = excluded.created,
    amount = excluded.amount, currency = excluded.currency, raw = excluded.raw,
    synced_at = excluded.synced_at, deleted_at = NULL`;

export interface UpsertScope {
  orgId: string;
  accountId: string;
  resource: MirrorResource;
  syncedAt: string;
}

/** Upserts the objects, de-duplicated by id (pagination can repeat an object when data shifts). */
export function upsertObjects(db: Database.Database, scope: UpsertScope, objects: StripeObject[]): number {
  const byId = new Map<string, StripeObject>();
  for (const obj of objects) {
    const id = refId(obj.id);
    if (id) byId.set(id, obj);
  }
  const stmt = db.prepare(UPSERT_SQL);
  const run = db.transaction(() => {
    for (const [id, obj] of byId) {
      const d = denormalise(scope.resource, obj);
      stmt.run(
        scope.orgId, scope.accountId, scope.resource, id,
        d.customerId, d.status, d.created, d.amount, d.currency,
        JSON.stringify(obj), scope.syncedAt,
      );
    }
  });
  run();
  return byId.size;
}

/** Marks rows not refreshed by this sync as deleted. Only call after a COMPLETE listing. */
export function tombstoneUnseen(db: Database.Database, scope: UpsertScope): number {
  const result = db.prepare(`
    UPDATE stripe_mirror_objects SET deleted_at = ?
    WHERE org_id = ? AND account_id = ? AND resource = ? AND synced_at < ? AND deleted_at IS NULL`)
    .run(scope.syncedAt, scope.orgId, scope.accountId, scope.resource, scope.syncedAt);
  return result.changes;
}

export function countLive(db: Database.Database, scope: Omit<UpsertScope, 'syncedAt'>): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM stripe_mirror_objects
    WHERE org_id = ? AND account_id = ? AND resource = ? AND deleted_at IS NULL`)
    .get(scope.orgId, scope.accountId, scope.resource) as { n: number };
  return row.n;
}

export function sumLiveAmount(db: Database.Database, scope: Omit<UpsertScope, 'syncedAt'>): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM stripe_mirror_objects
    WHERE org_id = ? AND account_id = ? AND resource = ? AND deleted_at IS NULL`)
    .get(scope.orgId, scope.accountId, scope.resource) as { total: number };
  return row.total;
}
