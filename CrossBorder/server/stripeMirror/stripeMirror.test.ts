import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyCustomer } from './lifecycle';
import { listAll, buildHeaders, type ListDeps } from './stripeApi';
import { ensureMirrorSchema } from './schema';
import { runSync, createRun, syncAccount, type SyncContext } from './sync';
import { listCustomerPayments, listCustomers } from './queries';
import { discoverAndStoreAccounts, listAccounts } from './discover';

const ORG = 'org-test';
const ACC = 'acct_AAA111';

type Page = { data: Record<string, unknown>[]; has_more: boolean };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/** Fake Stripe: path -> pages served in order of starting_after. */
function fakeStripe(pages: Record<string, Page[]>, failPath?: string): ListDeps & { calls: string[] } {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.searchParams.toString()}`);
    if (url.pathname === failPath) return jsonResponse({ error: { message: 'boom' } }, 400);
    const list = pages[url.pathname] ?? [{ data: [], has_more: false }];
    const after = url.searchParams.get('starting_after');
    const idx = after ? list.findIndex((p) => p.data.some((o) => o.id === after)) + 1 : 0;
    return jsonResponse(list[idx]);
  }) as unknown as typeof fetch;
  return { fetchFn, sleep: async () => undefined, calls };
}

const customer = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, object: 'customer', created: 1700000000, name: `Name ${id}`, email: `${id}@x.io`, ...extra });
const sub = (id: string, cus: string, status: string) => ({ id, customer: cus, status, created: 1700000100 });
const charge = (id: string, cus: string | null, amount: number, status = 'succeeded', extra: Record<string, unknown> = {}) =>
  ({ id, customer: cus, amount, currency: 'usd', status, created: 1700000200, amount_refunded: 0, ...extra });

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  ensureMirrorSchema(db);
  db.prepare(`INSERT INTO stripe_mirror_accounts (org_id, account_id, name, kind, discovered_at) VALUES (?,?,?,?,?)`)
    .run(ORG, ACC, 'Acme Inc', 'organisation', 'now');
});

function ctx(deps: ListDeps, now = '2026-01-01T00:00:00.000Z'): SyncContext {
  return { db, orgId: ORG, apiKey: 'sk_org_test', deps, now: () => new Date(now) };
}

describe('classifyCustomer', () => {
  it.each([
    [['active'], [], false, 'current'],
    [['past_due'], [], false, 'current'],
    [['canceled', 'trialing'], [], false, 'future'],
    [[], ['not_started'], false, 'future'],
    [['canceled'], [], false, 'past'],
    [[], [], true, 'past'],
    [['incomplete'], [], false, 'none'],
    [[], [], false, 'none'],
    [['trialing', 'active'], [], false, 'current'],
  ])('subs=%j schedules=%j paid=%s -> %s', (subs, schedules, paid, expected) => {
    expect(classifyCustomer({ subscriptionStatuses: subs, scheduleStatuses: schedules, hasSucceededCharge: paid }))
      .toBe(expected);
  });
});

describe('listAll', () => {
  it('follows has_more with starting_after and scopes org keys via Stripe-Context', async () => {
    const deps = fakeStripe({
      '/v1/customers': [
        { data: [customer('cus_1'), customer('cus_2')], has_more: true },
        { data: [customer('cus_3')], has_more: false },
      ],
    });
    const out = await listAll({ apiKey: 'sk_org_x', accountId: ACC }, '/v1/customers', {}, deps);
    expect(out.map((o) => o.id)).toEqual(['cus_1', 'cus_2', 'cus_3']);
    expect(deps.calls[1]).toContain('starting_after=cus_2');
    expect(buildHeaders({ apiKey: 'sk_org_x', accountId: ACC })['Stripe-Context']).toBe(ACC);
    expect(buildHeaders({ apiKey: 'sk_live_x', accountId: ACC })['Stripe-Account']).toBe(ACC);
  });

  it('retries 429 using Retry-After then succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(jsonResponse({ data: [], has_more: false })) as unknown as typeof fetch;
    await listAll({ apiKey: 'sk_x', accountId: ACC }, '/v1/charges', {}, { fetchFn, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('throws a specific error on non-retryable failure', async () => {
    const deps = fakeStripe({}, '/v1/charges');
    await expect(listAll({ apiKey: 'sk_x', accountId: ACC }, '/v1/charges', {}, deps))
      .rejects.toThrow('/v1/charges failed (400): boom');
  });
});

describe('sync + queries', () => {
  const fullPages = (): Record<string, Page[]> => ({
    '/v1/customers': [{ data: [customer('cus_cur'), customer('cus_try'), customer('cus_old'), customer('cus_new')], has_more: false }],
    '/v1/subscriptions': [{ data: [sub('sub_1', 'cus_cur', 'active'), sub('sub_2', 'cus_try', 'trialing'), sub('sub_3', 'cus_old', 'canceled')], has_more: false }],
    '/v1/subscription_schedules': [{ data: [{ id: 'sub_sched_1', customer: 'cus_new', status: 'not_started', created: 1 }], has_more: false }],
    '/v1/charges': [{ data: [
      charge('ch_1', 'cus_cur', 5000), charge('ch_2', 'cus_cur', 2000, 'succeeded', { amount_refunded: 500 }),
      charge('ch_3', 'cus_cur', 900, 'failed'), charge('ch_4', 'cus_old', 1200), charge('ch_5', null, 700),
    ], has_more: false }],
  });

  it('mirrors all four resources and classifies past/current/future customers', async () => {
    const result = await syncAccount(ctx(fakeStripe(fullPages())), ACC);
    expect(result.ok).toBe(true);
    expect(result.resources.every((r) => r.verified)).toBe(true);
    const page = listCustomers(db, ORG, { limit: 50, offset: 0 });
    const byId = Object.fromEntries(page.customers.map((c) => [c.customerId, c.lifecycle]));
    expect(byId).toEqual({ cus_cur: 'current', cus_try: 'future', cus_new: 'future', cus_old: 'past' });
    expect(page.lifecycleCounts).toMatchObject({ all: 4, current: 1, future: 2, past: 1, none: 0 });
    expect(page.customers.find((c) => c.customerId === 'cus_cur')?.paid).toEqual({ usd: 6500 });
  });

  it('lists payments per customer incl. failed, with net totals after refunds', async () => {
    await syncAccount(ctx(fakeStripe(fullPages())), ACC);
    const { payments, netPaid } = listCustomerPayments(db, ORG, ACC, 'cus_cur');
    expect(payments.map((p) => [p.id, p.status])).toEqual(
      expect.arrayContaining([['ch_1', 'succeeded'], ['ch_2', 'succeeded'], ['ch_3', 'failed']]),
    );
    expect(netPaid).toEqual({ usd: 6500 });
  });

  it('filters by account id substring, account name, lifecycle and search text', async () => {
    await syncAccount(ctx(fakeStripe(fullPages())), ACC);
    const f = { limit: 50, offset: 0 };
    expect(listCustomers(db, ORG, { ...f, account: 'AAA111' }).total).toBe(4);
    expect(listCustomers(db, ORG, { ...f, account: 'acme' }).total).toBe(4);
    expect(listCustomers(db, ORG, { ...f, account: 'acct_ZZZ' }).total).toBe(0);
    expect(listCustomers(db, ORG, { ...f, lifecycle: 'future' }).total).toBe(2);
    expect(listCustomers(db, ORG, { ...f, q: 'cus_old@' }).customers.map((c) => c.customerId)).toEqual(['cus_old']);
    expect(listCustomers(db, ORG, { ...f, q: '%' }).total).toBe(0);
  });

  it('tombstones rows Stripe stopped returning, and revives them if they return', async () => {
    await syncAccount(ctx(fakeStripe(fullPages())), ACC);
    const shrunk = fullPages();
    shrunk['/v1/customers'] = [{ data: [customer('cus_cur')], has_more: false }];
    const r = await syncAccount(ctx(fakeStripe(shrunk), '2026-02-01T00:00:00.000Z'), ACC);
    expect(r.resources.find((x) => x.resource === 'customers')?.tombstoned).toBe(3);
    expect(listCustomers(db, ORG, { limit: 50, offset: 0 }).total).toBe(1);
    await syncAccount(ctx(fakeStripe(fullPages()), '2026-03-01T00:00:00.000Z'), ACC);
    expect(listCustomers(db, ORG, { limit: 50, offset: 0 }).total).toBe(4);
  });

  it('never tombstones when a listing fails midway; reports the failure', async () => {
    await syncAccount(ctx(fakeStripe(fullPages())), ACC);
    const failing = await syncAccount(ctx(fakeStripe(fullPages(), '/v1/charges'), '2026-02-01T00:00:00.000Z'), ACC);
    expect(failing.ok).toBe(false);
    expect(failing.error).toContain('/v1/charges failed');
    expect(listCustomerPayments(db, ORG, ACC, 'cus_cur').payments).toHaveLength(3);
    expect(listAccounts(db, ORG)[0]).toMatchObject({ lastStatus: 'failed' });
  });

  it('dedupes objects repeated across pages', async () => {
    const pages = fullPages();
    pages['/v1/customers'] = [
      { data: [customer('cus_cur'), customer('cus_try')], has_more: true },
      { data: [customer('cus_try'), customer('cus_old')], has_more: false },
    ];
    const r = await syncAccount(ctx(fakeStripe(pages)), ACC);
    const res = r.resources.find((x) => x.resource === 'customers');
    expect(res).toMatchObject({ fetched: 4, stored: 3, verified: true });
  });

  it('runSync records a partial run when one account fails', async () => {
    db.prepare(`INSERT INTO stripe_mirror_accounts (org_id, account_id, name, kind, discovered_at) VALUES (?,?,?,?,?)`)
      .run(ORG, 'acct_BBB222', 'Beta', 'organisation', 'now');
    const deps: ListDeps = {
      sleep: async () => undefined,
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const scope = (init?.headers as Record<string, string>)['Stripe-Context'];
        return scope === 'acct_BBB222'
          ? jsonResponse({ error: { message: 'no access' } }, 403)
          : jsonResponse({ data: [], has_more: false });
      }) as typeof fetch,
    };
    const runId = createRun(db, ORG, [ACC, 'acct_BBB222']);
    const results = await runSync(ctx(deps), runId, [ACC, 'acct_BBB222']);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    const row = db.prepare('SELECT status FROM stripe_mirror_runs WHERE run_id = ?').get(runId) as { status: string };
    expect(row.status).toBe('partial');
  });
});

describe('discoverAndStoreAccounts', () => {
  it('registers every discovered account and keeps previously registered ones', async () => {
    const discover = vi.fn(async () => ({
      source: 'organisation' as const,
      accounts: [
        { id: ACC, name: 'Acme Renamed', kind: 'organisation' as const },
        { id: 'acct_CCC333', name: 'Child', kind: 'connect_child' as const, parentAccountId: ACC },
      ],
    }));
    const r = await discoverAndStoreAccounts(db, ORG, 'sk_org_x', [], discover);
    expect(r).toMatchObject({ discovered: 2, added: 1 });
    const accounts = listAccounts(db, ORG);
    expect(accounts.map((a) => a.name)).toEqual(['Acme Renamed', 'Child']);
    expect(accounts[1]).toMatchObject({ parentAccountId: ACC, lastStatus: 'never' });
  });
});
