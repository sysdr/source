import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPersonProfile, listPeople } from './people';
import { ensureMirrorSchema } from './schema';
import { upsertObjects } from './store';
import type { MirrorResource } from './types';

const ORG = 'o1';
let db: Database.Database;

function put(account: string, resource: MirrorResource, objects: Record<string, unknown>[]): void {
  upsertObjects(db, { orgId: ORG, accountId: account, resource, syncedAt: 't' }, objects);
}

beforeEach(() => {
  db = new Database(':memory:');
  ensureMirrorSchema(db);
  const ins = db.prepare(`INSERT INTO stripe_mirror_accounts (org_id, account_id, name, kind, discovered_at) VALUES (?,?,?,?,?)`);
  ins.run(ORG, 'acct_A', 'Alpha', 'organisation', 'n');
  ins.run(ORG, 'acct_B', 'Beta', 'organisation', 'n');
  put('acct_A', 'customers', [
    { id: 'cus_a1', created: 10, name: 'Ada', email: 'Ada@X.io' },
    { id: 'cus_a2', created: 11, name: 'Solo', email: null },
  ]);
  put('acct_B', 'customers', [{ id: 'cus_b1', created: 12, name: 'Ada L', email: 'ada@x.io' }]);
  put('acct_A', 'products', [{ id: 'prod_1', name: 'Pro Course' }]);
  put('acct_A', 'subscriptions', [{
    id: 'sub_a', customer: 'cus_a1', status: 'active', created: 100, current_period_end: 999, cancel_at_period_end: true,
    items: { data: [{ quantity: 2, price: { id: 'price_1', product: 'prod_1', unit_amount: 1500, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
  }]);
  put('acct_B', 'subscriptions', [{ id: 'sub_b', customer: 'cus_b1', status: 'canceled', created: 200, ended_at: 300, items: { data: [] } }]);
  put('acct_A', 'charges', [{ id: 'ch_a', customer: 'cus_a1', amount: 1500, currency: 'usd', status: 'succeeded', created: 150, amount_refunded: 0 }]);
  put('acct_B', 'charges', [
    { id: 'ch_b', customer: 'cus_b1', amount: 900, currency: 'eur', status: 'succeeded', created: 250, amount_refunded: 100 },
    { id: 'ch_f', customer: 'cus_b1', amount: 900, currency: 'eur', status: 'failed', created: 260, amount_refunded: 0 },
  ]);
});

describe('listPeople', () => {
  it('merges customers sharing an email across accounts (case-insensitive) and keeps no-email customers apart', () => {
    const { people, total } = listPeople(db, ORG, {});
    expect(total).toBe(2);
    const ada = people.find((p) => p.key === 'ada@x.io');
    expect(ada).toMatchObject({ accountCount: 2, liveSubscriptions: 1, paymentCount: 2, lifecycle: 'current' });
    expect(ada?.paid).toEqual({ usd: 1500, eur: 800 });
    expect(people.find((p) => p.key === 'acct_A|cus_a2')).toMatchObject({ accountCount: 1, lifecycle: 'none' });
  });

  it('searches by name, email, customer id or account id and paginates', () => {
    expect(listPeople(db, ORG, { q: 'cus_b1' }).people.map((p) => p.key)).toEqual(['ada@x.io']);
    expect(listPeople(db, ORG, { q: 'solo' }).total).toBe(1);
    expect(listPeople(db, ORG, { q: 'nomatch' }).total).toBe(0);
    expect(listPeople(db, ORG, { limit: 1, offset: 1 }).people).toHaveLength(1);
  });
});

describe('getPersonProfile', () => {
  it('returns every subscription and payment across accounts, newest first, with product names', () => {
    const profile = getPersonProfile(db, ORG, { email: 'ADA@x.io' });
    expect(profile?.customers.map((c) => c.customerId).sort()).toEqual(['cus_a1', 'cus_b1']);
    expect(profile?.subscriptions.map((s) => s.id)).toEqual(['sub_b', 'sub_a']);
    const sub = profile?.subscriptions[1];
    expect(sub).toMatchObject({ accountName: 'Alpha', cancelAtPeriodEnd: true, currentPeriodEnd: 999 });
    expect(sub?.items[0]).toMatchObject({ productName: 'Pro Course', unitAmount: 1500, interval: 'month', quantity: 2 });
    expect(profile?.payments.map((p) => [p.id, p.accountName, p.status])).toEqual([
      ['ch_f', 'Beta', 'failed'], ['ch_b', 'Beta', 'succeeded'], ['ch_a', 'Alpha', 'succeeded'],
    ]);
  });

  it('resolves by account and customer id, and returns null for unknown people', () => {
    expect(getPersonProfile(db, ORG, { accountId: 'acct_A', customerId: 'cus_a2' })?.person.name).toBe('Solo');
    expect(getPersonProfile(db, ORG, { email: 'ghost@x.io' })).toBeNull();
  });

  it('ignores tombstoned rows', () => {
    db.prepare(`UPDATE stripe_mirror_objects SET deleted_at = 'x' WHERE stripe_id = 'ch_a'`).run();
    expect(getPersonProfile(db, ORG, { email: 'ada@x.io' })?.payments.map((p) => p.id)).not.toContain('ch_a');
  });
});
