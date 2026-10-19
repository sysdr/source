import type http from 'node:http';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStripeMirrorRoute, type MirrorRouteContext } from './routes';
import { ensureMirrorSchema } from './schema';

const ORG = 'org-test';
let db: Database.Database;
let sent: { status: number; data: Record<string, unknown> } | null;

function makeCtx(over: Partial<MirrorRouteContext> & { method?: string; body?: Record<string, unknown> }): MirrorRouteContext {
  const { method = 'GET', body = {}, ...rest } = over;
  return {
    req: { method } as http.IncomingMessage,
    url: '/api/stripe-mirror/accounts',
    qs: { orgId: ORG },
    role: 'owner',
    db,
    respond: (status, data) => { sent = { status, data: data as Record<string, unknown> }; },
    parseBody: async () => body,
    isAuthorized: () => true,
    getStripeConfig: () => ({ apiKey: 'sk_org_test', accounts: [] }),
    ...rest,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  ensureMirrorSchema(db);
  sent = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FF_STRIPE_MIRROR;
});

describe('stripe-mirror routes', () => {
  it('ignores non-mirror urls', async () => {
    expect(await handleStripeMirrorRoute(makeCtx({ url: '/api/other' }))).toBe(false);
    expect(sent).toBeNull();
  });

  it('401 when unauthorised, 403 for employees, 503 when flag off', async () => {
    await handleStripeMirrorRoute(makeCtx({ isAuthorized: () => false }));
    expect(sent?.status).toBe(401);
    await handleStripeMirrorRoute(makeCtx({ role: 'employee' }));
    expect(sent?.status).toBe(403);
    process.env.FF_STRIPE_MIRROR = 'false';
    await handleStripeMirrorRoute(makeCtx({}));
    expect(sent?.status).toBe(503);
  });

  it('accountants may read but not discover or sync', async () => {
    await handleStripeMirrorRoute(makeCtx({ role: 'accountant' }));
    expect(sent?.status).toBe(200);
    await handleStripeMirrorRoute(makeCtx({ role: 'accountant', method: 'POST', url: '/api/stripe-mirror/sync', body: { orgId: ORG } }));
    expect(sent?.status).toBe(403);
  });

  it('discover registers accounts; sync refuses before discovery, validates ids, then 202 + 409', async () => {
    await handleStripeMirrorRoute(makeCtx({ method: 'POST', url: '/api/stripe-mirror/sync', body: { orgId: ORG } }));
    expect(sent).toMatchObject({ status: 400, data: { error: expect.stringContaining('run discovery first') } });

    const discover = vi.fn(async () => ({
      source: 'organisation' as const,
      accounts: [{ id: 'acct_AAA111', name: 'Acme', kind: 'organisation' as const }],
    }));
    await handleStripeMirrorRoute(makeCtx({ method: 'POST', url: '/api/stripe-mirror/discover', body: { orgId: ORG }, discover }));
    expect(sent?.status).toBe(200);
    expect(sent?.data.discovered).toBe(1);

    await handleStripeMirrorRoute(makeCtx({ method: 'POST', url: '/api/stripe-mirror/sync', body: { orgId: ORG, accountIds: ['nope'] } }));
    expect(sent?.status).toBe(400);
    await handleStripeMirrorRoute(makeCtx({ method: 'POST', url: '/api/stripe-mirror/sync', body: { orgId: ORG, accountIds: ['acct_ZZZ999'] } }));
    expect(sent?.data.error).toContain('Unregistered accounts');

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
    }));
    const syncCtx = () => makeCtx({ method: 'POST', url: '/api/stripe-mirror/sync', body: { orgId: ORG } });
    await handleStripeMirrorRoute(syncCtx());
    expect(sent?.status).toBe(202);
    await handleStripeMirrorRoute(syncCtx());
    expect(sent?.status).toBe(409);
    release();
    await vi.waitFor(async () => {
      await handleStripeMirrorRoute(makeCtx({ url: '/api/stripe-mirror/runs' }));
      expect(sent?.data.running).toBe(false);
    });
    expect((sent?.data.runs as { status: string }[])[0].status).toBe('completed');
  });
});
