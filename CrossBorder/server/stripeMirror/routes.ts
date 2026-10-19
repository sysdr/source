import type http from 'node:http';
import type Database from 'better-sqlite3';
import { discoverAndStoreAccounts, listAccounts, type DiscoverFn } from './discover.js';
import { getPersonProfile, listPeople } from './people.js';
import { listCustomerPayments, listCustomers } from './queries.js';
import { createRun, runSync } from './sync.js';
import { ensureMirrorSchema } from './schema.js';
import type { CustomerLifecycle } from './types.js';

export interface StripeConfigLite {
  apiKey?: string;
  accounts?: { id: string; name?: string }[];
}

export interface MirrorRouteContext {
  req: http.IncomingMessage;
  url: string;
  qs: Record<string, string>;
  role: 'owner' | 'accountant' | 'employee';
  db: Database.Database;
  respond: (status: number, data: unknown) => void;
  parseBody: () => Promise<Record<string, unknown>>;
  isAuthorized: () => boolean;
  getStripeConfig: (orgId: string) => StripeConfigLite | null;
  discover?: DiscoverFn;
}

const ROUTE_PREFIX = '/api/stripe-mirror/';
const ACCOUNT_ID_RE = /^acct_[A-Za-z0-9]+$/;
const LIFECYCLES = new Set(['all', 'current', 'future', 'past', 'none']);
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;
const RUN_LIST_LIMIT = 10;
const activeOrgs = new Set<string>();
const schemaReady = new WeakSet<Database.Database>();

export function isMirrorEnabled(): boolean {
  return process.env.FF_STRIPE_MIRROR !== 'false';
}

function clampInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
}

function requireKey(ctx: MirrorRouteContext, orgId: string): StripeConfigLite & { apiKey: string } | null {
  const cfg = ctx.getStripeConfig(orgId);
  if (!cfg?.apiKey?.startsWith('sk_')) {
    ctx.respond(400, { error: `No Stripe API key stored for org ${orgId}` });
    return null;
  }
  return cfg as StripeConfigLite & { apiKey: string };
}

async function postDiscover(ctx: MirrorRouteContext): Promise<void> {
  const body = await ctx.parseBody();
  const orgId = typeof body.orgId === 'string' ? body.orgId : '';
  if (!orgId) return ctx.respond(400, { error: 'orgId required' });
  const cfg = requireKey(ctx, orgId);
  if (!cfg) return;
  try {
    const result = await discoverAndStoreAccounts(ctx.db, orgId, cfg.apiKey, cfg.accounts ?? [], ctx.discover);
    ctx.respond(200, { ok: true, ...result, accounts: listAccounts(ctx.db, orgId) });
  } catch (err) {
    ctx.respond(502, { error: `Account discovery failed: ${(err as Error).message}` });
  }
}

function resolveAccountIds(ctx: MirrorRouteContext, orgId: string, requested: unknown): string[] | string {
  const registered = listAccounts(ctx.db, orgId).map((a) => a.accountId);
  if (registered.length === 0) return 'No accounts registered — run discovery first';
  if (requested === undefined) return registered;
  if (!Array.isArray(requested) || !requested.every((id) => typeof id === 'string' && ACCOUNT_ID_RE.test(id))) {
    return 'accountIds must be an array of acct_… ids';
  }
  const unknown = requested.filter((id) => !registered.includes(id));
  return unknown.length ? `Unregistered accounts: ${unknown.join(', ')}` : requested;
}

async function postSync(ctx: MirrorRouteContext): Promise<void> {
  const body = await ctx.parseBody();
  const orgId = typeof body.orgId === 'string' ? body.orgId : '';
  if (!orgId) return ctx.respond(400, { error: 'orgId required' });
  const cfg = requireKey(ctx, orgId);
  if (!cfg) return;
  const ids = resolveAccountIds(ctx, orgId, body.accountIds);
  if (typeof ids === 'string') return ctx.respond(400, { error: ids });
  if (activeOrgs.has(orgId)) return ctx.respond(409, { error: 'A mirror sync is already running for this org' });
  activeOrgs.add(orgId);
  const runId = createRun(ctx.db, orgId, ids);
  void runSync({ db: ctx.db, orgId, apiKey: cfg.apiKey }, runId, ids)
    .catch((err: Error) => {
      ctx.db.prepare(`UPDATE stripe_mirror_runs SET status = 'failed', finished_at = ?, results = ? WHERE run_id = ?`)
        .run(new Date().toISOString(), JSON.stringify([{ error: err.message }]), runId);
    })
    .finally(() => activeOrgs.delete(orgId));
  ctx.respond(202, { ok: true, runId, accountIds: ids });
}

function getRuns(ctx: MirrorRouteContext, orgId: string): void {
  const rows = ctx.db.prepare(`
    SELECT run_id, started_at, finished_at, status, account_ids, results FROM stripe_mirror_runs
    WHERE org_id = ? ORDER BY started_at DESC LIMIT ?`).all(orgId, RUN_LIST_LIMIT) as Record<string, string>[];
  ctx.respond(200, {
    ok: true,
    running: activeOrgs.has(orgId),
    runs: rows.map((r) => ({
      runId: r.run_id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status,
      accountIds: JSON.parse(r.account_ids), results: JSON.parse(r.results),
    })),
  });
}

function getCustomers(ctx: MirrorRouteContext, orgId: string): void {
  const lifecycle = LIFECYCLES.has(ctx.qs.lifecycle ?? '') ? (ctx.qs.lifecycle as CustomerLifecycle | 'all') : 'all';
  const page = listCustomers(ctx.db, orgId, {
    account: ctx.qs.account?.trim() || undefined,
    q: ctx.qs.q?.trim() || undefined,
    lifecycle,
    limit: clampInt(ctx.qs.limit, DEFAULT_PAGE, MAX_PAGE),
    offset: clampInt(ctx.qs.offset, 0, Number.MAX_SAFE_INTEGER),
  });
  ctx.respond(200, { ok: true, ...page });
}

function getPayments(ctx: MirrorRouteContext, orgId: string): void {
  const { accountId, customerId } = ctx.qs;
  if (!accountId || !customerId) return ctx.respond(400, { error: 'accountId and customerId required' });
  ctx.respond(200, { ok: true, ...listCustomerPayments(ctx.db, orgId, accountId, customerId) });
}

function getPeople(ctx: MirrorRouteContext, orgId: string): void {
  ctx.respond(200, {
    ok: true,
    ...listPeople(ctx.db, orgId, {
      q: ctx.qs.q?.trim() || undefined,
      limit: clampInt(ctx.qs.limit, DEFAULT_PAGE, MAX_PAGE),
      offset: clampInt(ctx.qs.offset, 0, Number.MAX_SAFE_INTEGER),
    }),
  });
}

function getPerson(ctx: MirrorRouteContext, orgId: string): void {
  const { email, accountId, customerId } = ctx.qs;
  if (!email && !(accountId && customerId)) return ctx.respond(400, { error: 'email, or accountId and customerId, required' });
  const profile = getPersonProfile(ctx.db, orgId, { email, accountId, customerId });
  if (!profile) return ctx.respond(404, { error: 'No mirrored customer matches' });
  ctx.respond(200, { ok: true, ...profile });
}

/** Returns true when the request was a stripe-mirror route (and has been answered). */
export async function handleStripeMirrorRoute(ctx: MirrorRouteContext): Promise<boolean> {
  if (!ctx.url.startsWith(ROUTE_PREFIX)) return false;
  if (!isMirrorEnabled()) { ctx.respond(503, { error: 'Stripe mirror disabled (FF_STRIPE_MIRROR=false)' }); return true; }
  if (!ctx.isAuthorized()) { ctx.respond(401, { error: 'Unauthorized' }); return true; }
  if (ctx.role === 'employee') { ctx.respond(403, { error: 'Forbidden' }); return true; }
  if (!schemaReady.has(ctx.db)) { ensureMirrorSchema(ctx.db); schemaReady.add(ctx.db); }
  const route = ctx.url.slice(ROUTE_PREFIX.length);
  const method = ctx.req.method;
  const orgId = ctx.qs.orgId || 'default';
  const isWrite = method === 'POST';
  if (isWrite && ctx.role !== 'owner') { ctx.respond(403, { error: 'Owner role required' }); return true; }
  if (method === 'GET' && route === 'accounts') ctx.respond(200, { ok: true, accounts: listAccounts(ctx.db, orgId) });
  else if (method === 'GET' && route === 'runs') getRuns(ctx, orgId);
  else if (method === 'GET' && route === 'customers') getCustomers(ctx, orgId);
  else if (method === 'GET' && route === 'payments') getPayments(ctx, orgId);
  else if (method === 'GET' && route === 'people') getPeople(ctx, orgId);
  else if (method === 'GET' && route === 'person') getPerson(ctx, orgId);
  else if (isWrite && route === 'discover') await postDiscover(ctx);
  else if (isWrite && route === 'sync') await postSync(ctx);
  else ctx.respond(404, { error: 'Unknown stripe-mirror route' });
  return true;
}
