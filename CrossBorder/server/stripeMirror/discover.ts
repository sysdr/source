import type Database from 'better-sqlite3';
import { discoverStripeAccounts, type DiscoveredStripeAccount } from '../../services/stripeAccountDiscovery.js';
import type { MirrorAccount, MirrorResource } from './types.js';

export type DiscoverFn = typeof discoverStripeAccounts;

const UPSERT_ACCOUNT_SQL = `
  INSERT INTO stripe_mirror_accounts (org_id, account_id, name, kind, parent_id, discovered_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(org_id, account_id) DO UPDATE SET
    name = excluded.name, kind = excluded.kind, parent_id = excluded.parent_id`;

function storeAccounts(db: Database.Database, orgId: string, accounts: DiscoveredStripeAccount[]): void {
  const stmt = db.prepare(UPSERT_ACCOUNT_SQL);
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const a of accounts) stmt.run(orgId, a.id, a.name, a.kind, a.parentAccountId ?? null, now);
  })();
}

/**
 * Discovers every account reachable with the key and registers it for mirroring.
 * Accounts already registered but no longer returned are kept (never silently dropped).
 */
export async function discoverAndStoreAccounts(
  db: Database.Database,
  orgId: string,
  apiKey: string,
  knownAccounts: { id: string; name?: string }[],
  discover: DiscoverFn = discoverStripeAccounts,
): Promise<{ discovered: number; added: number; source: string }> {
  const before = countAccounts(db, orgId);
  const { accounts, source } = await discover({ apiKey, knownAccounts, includeConnectChildren: true });
  storeAccounts(db, orgId, accounts);
  return { discovered: accounts.length, added: countAccounts(db, orgId) - before, source };
}

function countAccounts(db: Database.Database, orgId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM stripe_mirror_accounts WHERE org_id = ?').get(orgId) as { n: number };
  return row.n;
}

interface AccountRow {
  account_id: string; name: string; kind: 'organisation' | 'connect_child'; parent_id: string | null;
  discovered_at: string; last_synced_at: string | null; last_status: 'never' | 'ok' | 'failed'; last_error: string | null;
}

export function listAccounts(db: Database.Database, orgId: string): MirrorAccount[] {
  const rows = db.prepare(
    'SELECT * FROM stripe_mirror_accounts WHERE org_id = ? ORDER BY name COLLATE NOCASE, account_id',
  ).all(orgId) as AccountRow[];
  const counts = db.prepare(`
    SELECT account_id, resource, COUNT(*) AS n FROM stripe_mirror_objects
    WHERE org_id = ? AND deleted_at IS NULL GROUP BY account_id, resource`)
    .all(orgId) as { account_id: string; resource: MirrorResource; n: number }[];
  return rows.map((r) => {
    const own = { customers: 0, subscriptions: 0, schedules: 0, charges: 0, products: 0 };
    for (const c of counts) if (c.account_id === r.account_id) own[c.resource] = c.n;
    return {
      accountId: r.account_id, name: r.name, kind: r.kind, parentAccountId: r.parent_id,
      discoveredAt: r.discovered_at, lastSyncedAt: r.last_synced_at, lastStatus: r.last_status,
      lastError: r.last_error, counts: own,
    };
  });
}
