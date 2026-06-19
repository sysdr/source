/**
 * Stripe sync service – fetches and persists revenue transactions for all accounts.
 *
 * Key design principles
 * ─────────────────────
 * • Org-scoped state: sync cursors and sync schedule are keyed by active org ID so
 *   switching organisations never bleeds state between accounts.
 * • FX rate pre-fetch: unique (date, currency) pairs from a charge batch are resolved
 *   in parallel before mapping. Subsequent same-key look-ups hit the in-memory cache
 *   in currencyService, so network calls are minimised.
 * • Single ledger write per account: setRevenueData() + mergeRevenueIntoTransactions()
 *   are called exactly once per account sync and in the correct order.
 * • Sync schedule updated only after all-accounts batch completes (not per-account).
 * • forceFullSync clears cursors so the full configured date range is re-fetched.
 * • entireHistory fetches from STRIPE_EARLIEST_CHARGE_TS through today (all charges Stripe lists).
 */

import { Transaction, RevenueCategory } from '../types';
import {
  getBaseCurrency,
  convertToBaseCurrency,
  convertToBaseSync,
  getFxRateForDate,
  getAmountInBase,
  type BaseCurrency,
} from './currencyService';
import {
  getStripeOrgConfig,
  getRevenueData,
  setRevenueData,
  mergeRevenueIntoTransactions,
  getActiveOrgId,
  storage,
  StorageKeys,
  syncToApi,
} from './storageService';
import { api } from './apiClient';

// ── Constants ────────────────────────────────────────────────────────────────

const SYNC_INTERVAL_HOURS = 24;
/**
 * Buffer in seconds: re-fetch charges this many seconds before the cursor to
 * handle clock skew between Stripe servers and late-arriving webhook events.
 */
const CURSOR_BUFFER_SECONDS = 120;

/**
 * Lower bound for `created[gte]` when syncing full Stripe history (Jan 1, 2010 UTC).
 * Stripe’s product era; captures essentially all live charges while avoiding edge cases around 0.
 */
export const STRIPE_EARLIEST_CHARGE_TS = 1262304000;

export interface StripeSyncAccountOptions {
  /** Clear cursor and re-fetch the configured revenue date range (startDate→endDate). */
  forceFullSync?: boolean;
  /**
   * Ignore cursor and fetch from {@link STRIPE_EARLIEST_CHARGE_TS} through today so the DB
   * contains all Stripe charges for the account, not only since revenue.startDate / FY.
   */
  entireHistory?: boolean;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SyncSchedule {
  lastSyncAt: string | null;
  nextScheduledAt: string | null;
  lastSyncResult?: {
    success: boolean;
    transactionCount: number;
    accountsSynced: number;
    error?: string;
  };
}

/** Per-account last-synced Stripe charge `created` timestamp (Unix seconds). */
export type SyncCursors = Record<string, number>;

export interface SyncResult {
  success: boolean;
  transactionCount: number;
  totalAdded: number;
  accountsSynced: number;
  error?: string;
}

// ── Org-scoped storage keys ──────────────────────────────────────────────────

/**
 * Return a storage key scoped to the active org so that switching organisations
 * never shares sync state.
 */
function orgKey(base: string): string {
  const orgId = getActiveOrgId();
  return orgId ? `${orgId}:${base}` : base;
}

// ── Sync cursors ─────────────────────────────────────────────────────────────

function getSyncCursors(): SyncCursors {
  const c = storage.get<SyncCursors>(orgKey(StorageKeys.STRIPE_SYNC_CURSORS) as StorageKeys);
  return c && typeof c === 'object' ? c : {};
}

function setSyncCursors(cursors: SyncCursors): void {
  const key = orgKey(StorageKeys.STRIPE_SYNC_CURSORS) as StorageKeys;
  storage.set(key, cursors, { force: true });
  const orgId = getActiveOrgId();
  if (orgId) syncToApi(() => api.setOrgData(orgId, StorageKeys.STRIPE_SYNC_CURSORS, cursors));
}

function getCursorForAccount(accountId: string | null): number | undefined {
  const key = accountId === null ? 'platform' : accountId;
  return getSyncCursors()[key];
}

function setCursorForAccount(accountId: string | null, createdTimestamp: number): void {
  const cursors = getSyncCursors();
  const key = accountId === null ? 'platform' : accountId;
  setSyncCursors({ ...cursors, [key]: createdTimestamp });
}

/** Clear all cursors so the next sync re-fetches the full date range. */
export function clearStripeSyncCursors(): void {
  setSyncCursors({});
}

// ── Sync schedule ────────────────────────────────────────────────────────────

function getSyncSchedule(): SyncSchedule {
  const s = storage.get<SyncSchedule>(orgKey(StorageKeys.SYNC_SCHEDULE) as StorageKeys);
  return s || { lastSyncAt: null, nextScheduledAt: null };
}

function setSyncSchedule(schedule: SyncSchedule): void {
  const key = orgKey(StorageKeys.SYNC_SCHEDULE) as StorageKeys;
  storage.set(key, schedule, { force: true });
  const orgId = getActiveOrgId();
  if (orgId) syncToApi(() => api.setOrgData(orgId, StorageKeys.SYNC_SCHEDULE, schedule));
}

export function getLastSyncStatus(): SyncSchedule {
  return getSyncSchedule();
}

// ── Stripe HTTP helpers ───────────────────────────────────────────────────────

/**
 * Build Stripe request headers.
 *
 * Key types and their required account headers:
 *
 *   Regular key  (sk_live_* / sk_test_*)
 *     Platform:          no account header
 *     Connected account: Stripe-Account: {accountId}
 *
 *   Organization key (sk_org_live_* / sk_org_test_*)
 *     ALL requests need: Stripe-Context: {accountId}
 *     Platform syncs are skipped (see toFetch logic in runStripeSyncForAllAccounts).
 *
 * The `contextAccountId` param carries the resolved effective account ID
 * (= accountId for connected accounts, stripeContextAccountId for platform on org keys).
 */
function buildStripeHeaders(
  apiKey: string,
  contextAccountId: string | null | undefined,
  accountId?: string | null,
): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Stripe-Version': '2024-06-20',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const isOrgKey = apiKey?.startsWith('sk_org_');
  // Prefer specific accountId; fall back to contextAccountId (used for org key platform requests)
  const effectiveId = (accountId ?? contextAccountId)?.trim();

  if (effectiveId) {
    if (isOrgKey) {
      headers['Stripe-Context'] = effectiveId; // Org API keys require Stripe-Context
    } else {
      headers['Stripe-Account'] = effectiveId; // Regular keys use Stripe-Account
    }
  }
  return headers;
}

/**
 * Return the effective account ID to pass to buildStripeHeaders.
 *
 * For org keys: every request needs a context account — use stripeContextAccountId
 * as the fallback when accountId is null (platform).
 * For regular keys: platform uses no header (return null); connected uses accountId.
 */
function getEffectiveContextForAccount(
  config: {
    accounts: { id: string; scope?: string }[];
    accountsSource?: string;
    stripeContextAccountId?: string;
    apiKey?: string;
  },
  accountId: string | null,
): string | null {
  const isOrgKey = config.apiKey?.startsWith('sk_org_');
  if (accountId !== null) return accountId; // Connected account — always use its own ID
  if (isOrgKey) return config.stripeContextAccountId?.trim() || null; // Org key platform fallback
  return null; // Regular key, platform — no header needed
}

// ── Stripe API fetchers ───────────────────────────────────────────────────────

/**
 * Fetch a single Stripe URL with exponential-backoff retry on 429 rate-limit
 * responses. Stripe returns a `Retry-After` header (seconds) when throttling;
 * we honour it directly when present, otherwise fall back to `2^attempt * 1s`.
 */
async function stripeGet(url: string, headers: HeadersInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { method: 'GET', headers });
    if (response.status !== 429) return response;
    if (attempt === maxRetries) return response; // give up — caller will throw
    const retryAfter = Number(response.headers.get('Retry-After') || 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  // unreachable — TypeScript needs a return here
  throw new Error('stripeGet: exceeded retry limit');
}

/** Hard stop only for pathological API behaviour (never truncate normal Stripe pagination). */
const MAX_CHARGE_LIST_PAGES = 500_000;

async function fetchChargesFromStripe(
  apiKey: string,
  accountId: string | null,
  startTs: number,
  endTs: number,
  contextAccountId?: string | null,
): Promise<any[]> {
  const allCharges: any[] = [];
  let lastId: string | null = null;
  let page = 0;

  while (true) {
    page++;
    if (page > MAX_CHARGE_LIST_PAGES) {
      console.error('[Stripe] charge list pagination exceeded safety cap — partial fetch', {
        accountId,
        fetchedSoFar: allCharges.length,
      });
      break;
    }
    const params = new URLSearchParams({
      limit: '100',
      'created[gte]': String(startTs),
      'created[lte]': String(endTs),
      'expand[]': 'data.customer',
    });
    // balance_transaction gives us fee/net data; add as second expand
    params.append('expand[]', 'data.balance_transaction');
    if (lastId) params.set('starting_after', lastId);

    const url = `https://api.stripe.com/v1/charges?${params.toString()}`;
    const headers = buildStripeHeaders(apiKey, contextAccountId, accountId);

    const response = await stripeGet(url, headers);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error?.message || `Stripe charges API failed (${response.status})`;
      console.error('[Stripe] charges API error:', response.status, msg, { url, accountId });
      throw new Error(msg);
    }
    const result = await response.json();
    const batch: any[] = result.data || [];
    allCharges.push(...batch);

    if (!result.has_more || batch.length === 0) break;
    lastId = batch[batch.length - 1].id;
  }
  return allCharges;
}

// ── FX pre-fetch ─────────────────────────────────────────────────────────────

/**
 * Pre-fetch all unique (date, currency) pairs needed for a charge batch so that
 * the subsequent synchronous-style mapping can reuse the in-memory fxCache from
 * currencyService rather than issuing one HTTP request per charge per conversion.
 *
 * getFxRateForDate internally writes results to fxCache, so later calls within
 * the same batch are cache hits with no network latency.
 */
async function prefetchFxRatesForCharges(
  charges: any[],
  baseCurrency: BaseCurrency,
): Promise<void> {
  const pairs = new Set<string>();
  for (const charge of charges) {
    const currency = (charge.currency?.toUpperCase() || 'USD') as string;
    if (currency === baseCurrency) continue;
    const date = new Date(charge.created * 1000).toISOString().split('T')[0];
    pairs.add(`${date}::${currency}`);
  }
  if (pairs.size === 0) return;

  await Promise.allSettled(
    Array.from(pairs).map(async (pair) => {
      const [date, currency] = pair.split('::');
      await getFxRateForDate(date, currency, baseCurrency);
    }),
  );
}

// ── Charge → Transaction mapping ─────────────────────────────────────────────

async function mapChargeToTransaction(
  charge: any,
  accountId: string | undefined,
  baseCurrency: BaseCurrency,
): Promise<Transaction> {
  const country =
    charge.billing_details?.address?.country ||
    charge.customer?.address?.country ||
    charge.customer?.shipping?.address?.country ||
    'Unknown';
  const isIndia = country === 'IN';
  const classification = isIndia ? RevenueCategory.OIDAR_RISK : RevenueCategory.EXPORT;
  const customerEmail = charge.customer?.email || charge.billing_details?.email || '';
  const now = new Date().toISOString();
  const txDate = new Date(charge.created * 1000).toISOString().split('T')[0];
  const amountRefunded = charge.amount_refunded ?? 0;
  const netAmountCents = charge.amount - amountRefunded;
  const originalAmount = netAmountCents / 100;
  const originalCurrency = charge.currency?.toUpperCase() || 'USD';

  const bt = charge.balance_transaction;
  const feeCents = bt?.fee ?? 0;
  const netCents = bt
    ? (bt.net ?? charge.amount - amountRefunded - feeCents)
    : netAmountCents;
  const feeOriginal = feeCents / 100;
  const netOriginal = netCents / 100;

  // convertToBaseCurrency hits fxCache after the pre-fetch pass — no extra HTTP calls.
  const { amount, fxRate, fxRateDate } = await convertToBaseCurrency(
    originalAmount,
    originalCurrency,
    txDate,
    baseCurrency,
  );
  const { amount: feeAmount } = await convertToBaseCurrency(
    feeOriginal,
    originalCurrency,
    txDate,
    baseCurrency,
  );
  const { amount: netAmount } = await convertToBaseCurrency(
    netOriginal,
    originalCurrency,
    txDate,
    baseCurrency,
  );

  // Guard against zeroed conversions when FX source is unavailable for a supported charge.
  const fallbackAmount = (converted: number, original: number): number => {
    if (converted > 0 || original <= 0) return converted;
    if (originalCurrency === baseCurrency) return original;
    if (originalCurrency === 'USD' && baseCurrency === 'INR') {
      return convertToBaseSync(original, 'USD', 'INR');
    }
    if (originalCurrency === 'INR' && baseCurrency === 'USD') {
      return convertToBaseSync(original, 'INR', 'USD');
    }
    // Final fallback: keep original value instead of writing zero.
    return original;
  };
  const safeAmount = fallbackAmount(amount, originalAmount);
  const safeFeeAmount = fallbackAmount(feeAmount, feeOriginal);
  const safeNetAmount = fallbackAmount(netAmount, netOriginal);

  const txStatus = charge.refunded
    ? 'Refunded'
    : charge.status === 'succeeded'
      ? 'Completed'
      : charge.status === 'failed'
        ? 'Failed'
        : 'Pending';

  return {
    id: charge.id,
    stripeChargeId: charge.id,
    stripeAccountId: accountId,
    lastSyncedAt: now,
    date: txDate,
    description:
      charge.description ||
      `${charge.customer?.name || 'Customer'} (${customerEmail})`,
    amount: safeAmount,
    currency: baseCurrency,
    originalAmount,
    originalCurrency,
    fxRate,
    fxRateDate,
    feeAmount: safeFeeAmount,
    netAmount: safeNetAmount ?? safeAmount - safeFeeAmount,
    source: 'Stripe',
    status: txStatus,
    category:
      charge.metadata?.type || (charge.invoice ? 'Subscription' : 'One-time'),
    type: 'Income',
    customerLocation: country,
    classification,
  };
}

/**
 * If full FX mapping throws, still persist a row so no fetched charge is dropped.
 */
function buildFallbackStripeTransaction(
  charge: any,
  accountId: string | undefined,
  baseCurrency: BaseCurrency,
): Transaction {
  const now = new Date().toISOString();
  const created = typeof charge?.created === 'number' ? charge.created : Math.floor(Date.now() / 1000);
  const txDate = new Date(created * 1000).toISOString().split('T')[0];
  const chargeId =
    typeof charge?.id === 'string' && charge.id.length > 0
      ? charge.id
      : `ch_unknown_${created}_${Math.random().toString(36).slice(2, 9)}`;
  const amountRefunded = charge.amount_refunded ?? 0;
  const netAmountCents = (charge.amount ?? 0) - amountRefunded;
  const originalAmount = netAmountCents / 100;
  const originalCurrency = (charge.currency?.toUpperCase() || 'USD') as string;
  let amount = originalAmount;
  if (originalCurrency === baseCurrency) {
    amount = originalAmount;
  } else if (originalCurrency === 'USD' && baseCurrency === 'INR') {
    amount = convertToBaseSync(originalAmount, 'USD', 'INR');
  } else if (originalCurrency === 'INR' && baseCurrency === 'USD') {
    amount = convertToBaseSync(originalAmount, 'INR', 'USD');
  }
  const country =
    charge?.billing_details?.address?.country ||
    charge?.customer?.address?.country ||
    'Unknown';
  const isIndia = country === 'IN';
  const classification = isIndia ? RevenueCategory.OIDAR_RISK : RevenueCategory.EXPORT;
  const customerEmail = charge?.customer?.email || charge?.billing_details?.email || '';
  const txStatus = charge.refunded
    ? 'Refunded'
    : charge.status === 'succeeded'
      ? 'Completed'
      : charge.status === 'failed'
        ? 'Failed'
        : 'Pending';
  return {
    id: chargeId,
    stripeChargeId: chargeId,
    stripeAccountId: accountId,
    lastSyncedAt: now,
    date: txDate,
    description:
      (charge.description ? `${charge.description} · ` : '') +
      `${charge.customer?.name || 'Customer'} (${customerEmail}) (import: FX fallback)`,
    amount,
    currency: baseCurrency,
    originalAmount,
    originalCurrency,
    fxRate: originalCurrency === baseCurrency ? 1 : undefined,
    fxRateDate: txDate,
    feeAmount: 0,
    netAmount: amount,
    source: 'Stripe',
    status: txStatus,
    category: charge.metadata?.type || (charge.invoice ? 'Subscription' : 'One-time'),
    type: 'Income',
    customerLocation: country,
    classification,
  };
}

async function mapChargeToTransactionSafe(
  charge: any,
  accountId: string | undefined,
  baseCurrency: BaseCurrency,
): Promise<Transaction> {
  try {
    return await mapChargeToTransaction(charge, accountId, baseCurrency);
  } catch (err) {
    console.error('[Stripe] mapChargeToTransaction failed; storing fallback', charge?.id, err);
    return buildFallbackStripeTransaction(charge, accountId, baseCurrency);
  }
}

// ── Balance & Payouts types / fetchers ────────────────────────────────────────

export interface StripeBalanceResult {
  availableUsd: number;
  pendingUsd: number;
  accountId: string | null;
  accountName: string;
}

export interface StripePayoutItem {
  id: string;
  amountCents: number;
  currency: string;
  arrivalDate: string;
  status: string;
  accountId: string | null;
  accountName: string;
}

export interface StripeAccountBalance {
  accountId: string | null;
  accountName: string;
  availableUsd: number;
  pendingUsd: number;
  payouts: StripePayoutItem[];
}

export interface RevenueBalanceResult {
  balance: { availableBase: number; pendingBase: number };
  accounts: Array<{
    accountId: string | null;
    accountName: string;
    availableBase: number;
    pendingBase: number;
  }>;
}

/**
 * Compute balance from stored revenue transactions (no Stripe API call).
 * Available = completed income; Pending = pending income.
 */
export function computeBalanceFromRevenueTransactions(): RevenueBalanceResult {
  const revenue = getRevenueData();
  const config = getStripeOrgConfig();
  const txns = revenue.transactions || [];

  const completed = txns.filter((t) => t.status === 'Completed' && t.type === 'Income');
  const pending = txns.filter((t) => t.status === 'Pending' && t.type === 'Income');

  const availableBase = completed.reduce((sum, t) => sum + t.amount, 0);
  const pendingBase = pending.reduce((sum, t) => sum + t.amount, 0);

  const accountMap = new Map<string | null, { availableBase: number; pendingBase: number }>();
  const add = (accId: string | null, avail: number, pend: number) => {
    const cur = accountMap.get(accId) ?? { availableBase: 0, pendingBase: 0 };
    accountMap.set(accId, {
      availableBase: cur.availableBase + avail,
      pendingBase: cur.pendingBase + pend,
    });
  };
  completed.forEach((t) => add(t.stripeAccountId ?? null, t.amount, 0));
  pending.forEach((t) => add(t.stripeAccountId ?? null, 0, t.amount));

  const accounts = config.accounts || [];
  const accountsBreakdown = Array.from(accountMap.entries()).map(([accountId, totals]) => {
    const accountName =
      accountId === null
        ? 'Platform'
        : accounts.find((a) => a.id === accountId)?.name ||
          (accountId ? accountId.slice(0, 12) + '...' : 'Platform');
    return { accountId, accountName, ...totals };
  });

  if (accountMap.size === 0 && (txns.length > 0 || config.accountsSource === 'standard')) {
    accountsBreakdown.push({
      accountId: null,
      accountName: 'Platform',
      availableBase,
      pendingBase,
    });
  }

  return { balance: { availableBase, pendingBase }, accounts: accountsBreakdown };
}

export interface StripeBalanceAndPayoutsResult {
  balance: { availableUsd: number; pendingUsd: number };
  payouts: StripePayoutItem[];
  accounts: StripeAccountBalance[];
  error?: string;
}

async function fetchBalanceFromStripe(
  apiKey: string,
  accountId: string | null,
  contextAccountId: string | null | undefined,
): Promise<{ availableUsd: number; pendingUsd: number }> {
  const headers = buildStripeHeaders(apiKey, contextAccountId, accountId);
  const response = await fetch('https://api.stripe.com/v1/balance', { method: 'GET', headers });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Stripe balance API failed (${response.status})`);
  }
  const data = await response.json();
  const toUsd = (list: { amount: number; currency: string }[] | undefined): number => {
    if (!Array.isArray(list)) return 0;
    return list.reduce((sum, item) => {
      const cents = item?.amount ?? 0;
      const cur = (item?.currency ?? 'usd').toLowerCase();
      return cur === 'usd' ? sum + cents / 100 : sum;
    }, 0);
  };
  return { availableUsd: toUsd(data.available), pendingUsd: toUsd(data.pending) };
}

async function fetchPayoutsFromStripe(
  apiKey: string,
  accountId: string | null,
  contextAccountId: string | null | undefined,
  accountName: string,
): Promise<StripePayoutItem[]> {
  const headers = buildStripeHeaders(apiKey, contextAccountId, accountId);
  const response = await fetch('https://api.stripe.com/v1/payouts?limit=20', {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Stripe payouts API failed (${response.status})`);
  }
  const data = await response.json();
  const list: any[] = data.data || [];
  return list
    .filter((p) => (p.status ?? '') === 'pending')
    .map((p) => ({
      id: p.id,
      amountCents: p.amount ?? 0,
      currency: (p.currency ?? 'usd').toLowerCase(),
      arrivalDate: p.arrival_date
        ? new Date(p.arrival_date * 1000).toISOString().split('T')[0]
        : '',
      status: p.status ?? 'pending',
      accountId,
      accountName,
    }));
}

/** Fetch only pending payouts (no balance API). Pair with computeBalanceFromRevenueTransactions. */
export async function fetchStripePayoutsOnly(): Promise<{
  payouts: StripePayoutItem[];
  error?: string;
}> {
  const config = getStripeOrgConfig();
  if (!config.apiKey?.startsWith('sk_')) {
    return { payouts: [], error: 'No Stripe API key configured' };
  }

  const accounts = config.accounts;
  const isStandardAccount = config.accountsSource === 'standard';
  const isOrgKey = config.apiKey?.startsWith('sk_org_');
  const isConnect = config.accountsSource === 'connect' || isOrgKey;
  const toFetch: (string | null)[] = isStandardAccount
    ? [null]
    : isConnect && accounts.length > 0
      ? accounts.map((a) => a.id)
      : accounts.length > 0
        ? [null, ...accounts.map((a) => a.id)]
        : [null];

  const allPayouts: StripePayoutItem[] = [];
  const errors: string[] = [];

  for (const accId of toFetch) {
    const effectiveContext = getEffectiveContextForAccount(config, accId);
    const accName =
      accId === null
        ? 'Platform'
        : accounts.find((a) => a.id === accId)?.name || accId.slice(0, 12) + '...';
    try {
      const payouts = await fetchPayoutsFromStripe(config.apiKey, accId, effectiveContext, accName);
      allPayouts.push(...payouts);
    } catch (err: any) {
      errors.push(`${accName}: ${err?.message || 'Unknown error'}`);
    }
  }

  return {
    payouts: allPayouts.sort((a, b) => (a.arrivalDate || '').localeCompare(b.arrivalDate || '')),
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/**
 * Fetch live Stripe balance and pending payouts for all configured accounts.
 *
 * @deprecated Prefer computeBalanceFromRevenueTransactions() + fetchStripePayoutsOnly()
 *             for balance derived from received payments.
 */
export async function fetchStripeBalanceAndPayouts(): Promise<StripeBalanceAndPayoutsResult> {
  const config = getStripeOrgConfig();
  if (!config.apiKey?.startsWith('sk_')) {
    return {
      balance: { availableUsd: 0, pendingUsd: 0 },
      payouts: [],
      accounts: [],
      error: 'No Stripe API key configured',
    };
  }

  const accounts = config.accounts;
  const isStandardAccount = config.accountsSource === 'standard';
  const isOrgKey = config.apiKey?.startsWith('sk_org_');
  const isConnect = config.accountsSource === 'connect' || isOrgKey;
  const toFetch: (string | null)[] = isStandardAccount
    ? [null]
    : isConnect && accounts.length > 0
      ? accounts.map((a) => a.id)
      : accounts.length > 0
        ? [null, ...accounts.map((a) => a.id)]
        : [null];

  let totalAvailableUsd = 0;
  let totalPendingUsd = 0;
  const allPayouts: StripePayoutItem[] = [];
  const accountsBreakdown: StripeAccountBalance[] = [];
  const errors: string[] = [];

  for (const accId of toFetch) {
    const effectiveContext = getEffectiveContextForAccount(config, accId);
    const accName =
      accId === null
        ? 'Platform'
        : accounts.find((a) => a.id === accId)?.name || accId.slice(0, 12) + '...';
    try {
      const bal = await fetchBalanceFromStripe(config.apiKey, accId, effectiveContext);
      totalAvailableUsd += bal.availableUsd;
      totalPendingUsd += bal.pendingUsd;
      const payouts = await fetchPayoutsFromStripe(
        config.apiKey,
        accId,
        effectiveContext,
        accName,
      );
      allPayouts.push(...payouts);
      accountsBreakdown.push({
        accountId: accId,
        accountName: accName,
        availableUsd: bal.availableUsd,
        pendingUsd: bal.pendingUsd,
        payouts: payouts.sort((a, b) => (a.arrivalDate || '').localeCompare(b.arrivalDate || '')),
      });
    } catch (err: any) {
      errors.push(`${accName}: ${err?.message || 'Unknown error'}`);
    }
  }

  return {
    balance: { availableUsd: totalAvailableUsd, pendingUsd: totalPendingUsd },
    payouts: allPayouts.sort((a, b) => (a.arrivalDate || '').localeCompare(b.arrivalDate || '')),
    accounts: accountsBreakdown,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

// ── Core sync logic ───────────────────────────────────────────────────────────

/**
 * Sync a single Stripe account.
 *
 * Flow:
 *   1. Determine date range (incremental from cursor, or full from revenue.startDate).
 *   2. Pre-fetch all unique (date, currency) FX pairs for the charge batch.
 *   3. Map each charge to a Transaction (FX hits memory cache — no extra HTTP).
 *   4. Deduplicate: merge mapped txns with existing non-account txns, keyed by stripeChargeId.
 *   5. Atomic write: setRevenueData (revenue store) then mergeRevenueIntoTransactions (ledger).
 *   6. Advance cursor to max(created) of fetched charges.
 *
 * Note: sync schedule is NOT updated here — only runStripeSyncForAllAccounts() updates it,
 * so per-account calls don't cause partial schedule updates.
 */
export async function runStripeSyncForAccount(
  accountId: string | null,
  options?: StripeSyncAccountOptions,
): Promise<SyncResult> {
  const config = getStripeOrgConfig();
  if (!config.apiKey?.startsWith('sk_')) {
    return {
      success: false,
      transactionCount: 0,
      totalAdded: 0,
      accountsSynced: 0,
      error: 'No Stripe API key configured',
    };
  }

  const revenue = getRevenueData();
  // Default start date: beginning of current financial year (Apr 1) rather than hardcoded past date
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const defaultStartDate = `${fyStart}-04-01`;
  const startDate = revenue.startDate || defaultStartDate;
  // Always sync up to today for incremental syncs; respect stored endDate only for full historical re-syncs
  const today = new Date().toISOString().split('T')[0];
  const endDate = revenue.endDate && revenue.endDate > today ? revenue.endDate : today;
  const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86399;
  const nowTs = Math.floor(Date.now() / 1000);

  const entireHistory = options?.entireHistory === true;
  const ignoreCursor = options?.forceFullSync === true || entireHistory;
  const cursor = ignoreCursor ? undefined : getCursorForAccount(accountId);
  const useIncremental = cursor != null;

  let startTs: number;
  let effectiveEndTs: number;
  if (useIncremental) {
    startTs = Math.max(0, cursor! - CURSOR_BUFFER_SECONDS);
    effectiveEndTs = Math.min(nowTs + 60, endTs);
  } else if (entireHistory) {
    startTs = STRIPE_EARLIEST_CHARGE_TS;
    effectiveEndTs = endTs;
  } else {
    startTs = Math.floor(new Date(startDate).getTime() / 1000);
    effectiveEndTs = endTs;
  }

  const base = getBaseCurrency();
  const existingTransactions = revenue.transactions;
  const effectiveContext = getEffectiveContextForAccount(config, accountId);

  try {
    // ── 1. Fetch charges ────────────────────────────────────────────────────
    const charges = await fetchChargesFromStripe(
      config.apiKey,
      accountId,
      startTs,
      effectiveEndTs,
      effectiveContext,
    );

    if (charges.length === 0) {
      return { success: true, transactionCount: 0, totalAdded: 0, accountsSynced: 1 };
    }

    // ── 2. Pre-fetch FX rates (batched, fills in-memory cache) ──────────────
    await prefetchFxRatesForCharges(charges, base);

    // ── 3. Map charges → Transactions (FX calls hit cache); per-charge fallback so none are dropped ──
    const mapped = await Promise.all(
      charges.map((c) => mapChargeToTransactionSafe(c, accountId || undefined, base)),
    );

    // ── 4. Deduplicate & merge — ADDITIVE (never drop historical charges) ──────
    //
    // Bug fix: the previous approach replaced ALL of an account's transactions
    // with only the cursor-window batch (otherAccountsTxns + mapped), silently
    // dropping historical charges on every incremental sync.
    //
    // Correct behaviour:
    //   • Keep ALL existing transactions.
    //   • Overlay freshly-fetched charges on top (update status, fee, etc.).
    //   • New charges (not seen before) are added.
    //
    // We use a Map keyed by stripeChargeId for O(1) dedup; the freshly-fetched
    // version wins so status changes (pending→completed, etc.) are captured.
    const merged = new Map<string, Transaction>(
      existingTransactions.map((t) => [t.stripeChargeId || t.id, t]),
    );
    // Overlay: fresh data wins for all re-fetched charges
    for (const t of mapped) {
      merged.set(t.stripeChargeId || t.id, t);
    }

    // Truly new charges (not in previous ledger)
    const existingIds = new Set(existingTransactions.map((t) => t.stripeChargeId || t.id));
    const newTxns = mapped.filter((t) => !existingIds.has(t.stripeChargeId || t.id));

    const byDate = Array.from(merged.values()).sort((a, b) => (b.date > a.date ? 1 : -1));

    const allDates = byDate.map((t) => t.date);
    const minTxDate =
      allDates.length > 0 ? allDates.reduce((a, b) => (a < b ? a : b)) : startDate;
    const revenueStartDate = entireHistory ? minTxDate : startDate;

    // ── 5. Atomic write — ledger first, then revenue store ──────────────────
    // Write ledger first so revenue store is never ahead of the ledger
    if (newTxns.length > 0) {
      mergeRevenueIntoTransactions(newTxns);
    }
    // Revenue store: all synced transactions (used by Balance & Revenue screens)
    setRevenueData(
      { transactions: byDate, lastSyncDate: new Date().toISOString(), startDate: revenueStartDate, endDate },
      { force: true },
    );
    window.dispatchEvent(new Event('suez_data_updated'));

    // ── 6. Advance cursor ───────────────────────────────────────────────────
    const maxCreated = Math.max(...charges.map((c: any) => c.created ?? 0));
    if (maxCreated > 0) setCursorForAccount(accountId, maxCreated);

    return {
      success: true,
      transactionCount: mapped.length,
      totalAdded: newTxns.length,
      accountsSynced: 1,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Unknown sync error';
    return { success: false, transactionCount: 0, totalAdded: 0, accountsSynced: 0, error: errorMsg };
  }
}

/**
 * Sync all configured Stripe accounts sequentially.
 *
 * After all accounts complete, the sync schedule is updated once with the
 * aggregate result. Pass forceFullSync: true to clear cursors and re-fetch
 * the full date range for every account.
 */
export async function runStripeSyncForAllAccounts(options?: {
  onStatus?: (msg: string) => void;
  forceFullSync?: boolean;
  /** Same as {@link StripeSyncAccountOptions.entireHistory} for every account. */
  entireHistory?: boolean;
}): Promise<SyncResult> {
  const config = getStripeOrgConfig();
  if (!config.apiKey?.startsWith('sk_')) {
    return {
      success: false,
      transactionCount: 0,
      totalAdded: 0,
      accountsSynced: 0,
      error: 'No Stripe API key configured',
    };
  }

  if (options?.forceFullSync || options?.entireHistory) clearStripeSyncCursors();

  const accounts = config.accounts;
  const isStandardAccount = config.accountsSource === 'standard';
  // Org API keys (sk_org_*) behave like Connect: all charges are under
  // connected accounts. The platform (null) cannot be queried directly —
  // it requires Stripe-Context which only makes sense per-account.
  const isOrgKey = config.apiKey?.startsWith('sk_org_');
  const isConnect = config.accountsSource === 'connect' || isOrgKey;

  // For Connect / org keys: sub-accounts only (platform sync skipped — always 400).
  // For standard / unconfigured: only platform (null).
  const toFetch: (string | null)[] = isStandardAccount
    ? [null]
    : isConnect && accounts.length > 0
      ? accounts.map((a) => a.id)           // Connect / org: sub-accounts only
      : accounts.length > 0
        ? [null, ...accounts.map((a) => a.id)] // Mixed: platform + sub-accounts
        : [null];                              // Fallback: platform only

  const onStatus = options?.onStatus;
  let totalAdded = 0;
  let accountsSynced = 0;
  const errors: string[] = [];

  for (let i = 0; i < toFetch.length; i++) {
    const accId = toFetch[i];
    const accName =
      accId === null
        ? 'Platform'
        : accounts.find((a) => a.id === accId)?.name || accId.slice(0, 12) + '...';
    onStatus?.(`Syncing ${i + 1}/${toFetch.length}: ${accName}…`);
    try {
      const result = await runStripeSyncForAccount(accId, {
        forceFullSync: options?.forceFullSync,
        entireHistory: options?.entireHistory,
      });
      if (result.success) {
        totalAdded += result.totalAdded;
        accountsSynced += 1;
      } else if (result.error) {
        errors.push(`${accName}: ${result.error}`);
      }
    } catch (err: any) {
      errors.push(`${accName}: ${err?.message || 'Unknown error'}`);
    }
  }

  // Update sync schedule once for the entire batch
  const revenue = getRevenueData();
  const nextScheduled = new Date();
  nextScheduled.setHours(nextScheduled.getHours() + SYNC_INTERVAL_HOURS);
  setSyncSchedule({
    lastSyncAt: new Date().toISOString(),
    nextScheduledAt: nextScheduled.toISOString(),
    lastSyncResult: {
      success: accountsSynced > 0,
      transactionCount: revenue.transactions.length,
      accountsSynced,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    },
  });

  const errorMsg = errors.length > 0 ? errors.join('; ') : undefined;
  return {
    success: accountsSynced > 0,
    transactionCount: revenue.transactions.length,
    totalAdded,
    accountsSynced,
    error: errorMsg,
  };
}

/**
 * Run an auto-sync if the last sync was more than 24 h ago.
 * Call this on app load when an org with Stripe is active.
 */
export async function runDailySyncIfDue(): Promise<SyncResult | null> {
  const orgId = getActiveOrgId();
  if (!orgId) return null;

  const config = getStripeOrgConfig();
  if (!config.apiKey?.startsWith('sk_')) return null;

  const schedule = getSyncSchedule();
  const now = new Date();
  const lastSync = schedule.lastSyncAt ? new Date(schedule.lastSyncAt) : null;
  const hoursSinceLast = lastSync
    ? (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60)
    : SYNC_INTERVAL_HOURS + 1;

  if (hoursSinceLast >= SYNC_INTERVAL_HOURS) {
    return runStripeSyncForAllAccounts();
  }
  return null;
}

// ── Actuals summary ───────────────────────────────────────────────────────────

export interface StripeActualsSummary {
  totalCharges: number;
  totalCommissions: number;
  totalRevenue: number;
  transactionCount: number;
  accountBreakdown: Array<{
    accountId: string | null;
    accountName: string;
    charges: number;
    commissions: number;
    revenue: number;
  }>;
}

export function computeStripeActualsFromRevenue(
  transactions: Transaction[],
): StripeActualsSummary {
  const stripeOnly = transactions.filter(
    (t) => t.source === 'Stripe' && t.status === 'Completed' && t.type === 'Income',
  );
  const baseCurrency = getBaseCurrency();
  let totalCharges = 0;
  let totalCommissions = 0;
  let totalRevenue = 0;
  const byAccount = new Map<
    string | null,
    { charges: number; commissions: number; revenue: number }
  >();

  type AmtInput = Parameters<typeof getAmountInBase>[0];
  for (const t of stripeOnly) {
    const txInput: AmtInput = { amount: t.amount, currency: t.currency, originalAmount: t.originalAmount, originalCurrency: t.originalCurrency as 'INR' | 'USD' | undefined };
    const gross = getAmountInBase(txInput, baseCurrency);
    const fee = t.feeAmount ?? 0;
    const net =
      t.netAmount != null
        ? getAmountInBase({ ...txInput, amount: t.netAmount }, baseCurrency)
        : gross - fee;
    totalCharges += gross;
    totalCommissions += fee;
    totalRevenue += net;
    const accId = t.stripeAccountId ?? null;
    const cur = byAccount.get(accId) ?? { charges: 0, commissions: 0, revenue: 0 };
    byAccount.set(accId, {
      charges: cur.charges + gross,
      commissions: cur.commissions + fee,
      revenue: cur.revenue + net,
    });
  }

  const config = getStripeOrgConfig();
  const accounts = config.accounts || [];
  const accountBreakdown = Array.from(byAccount.entries()).map(([accountId, totals]) => ({
    accountId,
    accountName:
      accountId === null
        ? 'Platform'
        : accounts.find((a) => a.id === accountId)?.name ||
          (accountId?.slice(0, 12) + '...') ||
          'Platform',
    ...totals,
  }));

  return {
    totalCharges,
    totalCommissions,
    totalRevenue,
    transactionCount: stripeOnly.length,
    accountBreakdown,
  };
}
