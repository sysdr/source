import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { defaultListDeps, listAll, type ListDeps } from './stripeApi.js';
import { countLive, sumLiveAmount, tombstoneUnseen, upsertObjects, type UpsertScope } from './store.js';
import {
  MIRROR_RESOURCES, RESOURCE_PATHS, RESOURCE_QUERY,
  type AccountSyncResult, type MirrorResource, type ResourceSyncResult,
} from './types.js';

export interface SyncContext {
  db: Database.Database;
  orgId: string;
  apiKey: string;
  deps?: ListDeps;
  now?: () => Date;
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ component: 'stripe_mirror', event, ...fields }));
}

function sumAmounts(objects: Record<string, unknown>[]): number {
  const seen = new Map<string, number>();
  for (const obj of objects) {
    if (typeof obj.id === 'string') seen.set(obj.id, typeof obj.amount === 'number' ? obj.amount : 0);
  }
  let total = 0;
  for (const amount of seen.values()) total += amount;
  return total;
}

/**
 * Mirrors one resource for one account. Tombstoning happens only after the full listing
 * succeeded, so a mid-listing failure leaves the previous mirror state untouched.
 */
export async function syncResource(
  ctx: SyncContext, accountId: string, resource: MirrorResource, startedAt: string,
): Promise<ResourceSyncResult> {
  const objects = await listAll(
    { apiKey: ctx.apiKey, accountId },
    RESOURCE_PATHS[resource],
    RESOURCE_QUERY[resource],
    ctx.deps ?? defaultListDeps,
  );
  const scope: UpsertScope = { orgId: ctx.orgId, accountId, resource, syncedAt: startedAt };
  const stored = upsertObjects(ctx.db, scope, objects);
  const tombstoned = tombstoneUnseen(ctx.db, scope);
  const live = countLive(ctx.db, scope);
  const amountsMatch = resource !== 'charges' || sumLiveAmount(ctx.db, scope) === sumAmounts(objects);
  return { resource, fetched: objects.length, stored, tombstoned, verified: live === stored && amountsMatch };
}

function markAccount(ctx: SyncContext, accountId: string, ok: boolean, at: string, error: string | null): void {
  ctx.db.prepare(`
    UPDATE stripe_mirror_accounts SET last_synced_at = ?, last_status = ?, last_error = ?
    WHERE org_id = ? AND account_id = ?`)
    .run(at, ok ? 'ok' : 'failed', error, ctx.orgId, accountId);
}

export async function syncAccount(ctx: SyncContext, accountId: string): Promise<AccountSyncResult> {
  const startedAt = (ctx.now ?? (() => new Date()))().toISOString();
  const resources: ResourceSyncResult[] = [];
  try {
    for (const resource of MIRROR_RESOURCES) {
      resources.push(await syncResource(ctx, accountId, resource, startedAt));
    }
    const unverified = resources.filter((r) => !r.verified).map((r) => r.resource);
    const error = unverified.length ? `Verification mismatch: ${unverified.join(', ')}` : null;
    markAccount(ctx, accountId, error === null, startedAt, error);
    logEvent('account_synced', { orgId: ctx.orgId, accountId, ok: error === null, resources });
    return { accountId, ok: error === null, ...(error ? { error } : {}), resources };
  } catch (err) {
    const message = (err as Error).message;
    markAccount(ctx, accountId, false, startedAt, message);
    logEvent('account_failed', { orgId: ctx.orgId, accountId, error: message });
    return { accountId, ok: false, error: message, resources };
  }
}

export function createRun(db: Database.Database, orgId: string, accountIds: string[]): string {
  const runId = `run_${randomUUID()}`;
  db.prepare(`
    INSERT INTO stripe_mirror_runs (run_id, org_id, started_at, status, account_ids)
    VALUES (?, ?, ?, 'running', ?)`)
    .run(runId, orgId, new Date().toISOString(), JSON.stringify(accountIds));
  return runId;
}

function finishRun(db: Database.Database, runId: string, results: AccountSyncResult[]): void {
  const failed = results.filter((r) => !r.ok).length;
  const status = failed === 0 ? 'completed' : failed === results.length ? 'failed' : 'partial';
  db.prepare(`UPDATE stripe_mirror_runs SET finished_at = ?, status = ?, results = ? WHERE run_id = ?`)
    .run(new Date().toISOString(), status, JSON.stringify(results), runId);
}

/** Accounts run sequentially to stay inside Stripe's per-key rate limit; one failure never stops the rest. */
export async function runSync(ctx: SyncContext, runId: string, accountIds: string[]): Promise<AccountSyncResult[]> {
  const results: AccountSyncResult[] = [];
  for (const accountId of accountIds) {
    results.push(await syncAccount(ctx, accountId));
  }
  finishRun(ctx.db, runId, results);
  return results;
}
