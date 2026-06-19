/**
 * Server-side Stripe → SQLite ingestion (no browser, no localStorage).
 * Mirrors client charge mapping + Frankfurter FX so totals align with dashboard sync.
 */

import {
  bulkUpsertTransactions,
  deleteAllTransactionsForOrg,
  deleteTransactionsByOrgAndSource,
} from './db.js';

const STRIPE_VERSION = '2024-06-20';
export const STRIPE_EARLIEST_CHARGE_TS = 1262304000;
const MAX_CHARGE_LIST_PAGES = 500_000;
const DEFAULT_USD_INR = 83.5;

const FRANKFURTER = new Set([
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HRK', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'RUB', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

type BaseCurrency = 'INR' | 'USD';

export interface StripeOrgConfigInput {
  apiKey: string;
  accounts: { id: string; name?: string; scope?: string }[];
  accountsSource?: 'connect' | 'standard';
  stripeContextAccountId?: string;
}

export interface StripeSqliteSyncOptions {
  orgId: string;
  baseCurrency: BaseCurrency;
  stripe: StripeOrgConfigInput;
  /** When true, use created[gte]=STRIPE_EARLIEST_CHARGE_TS; when false, use FY-style window from startDate/endDate. */
  entireHistory: boolean;
  /** Revenue window when entireHistory is false */
  startDate: string;
  endDate: string;
  /** What to remove before import */
  purge: 'none' | 'stripe' | 'all';
}

const RevenueExport = {
  OIDAR_RISK: 'OIDAR GST Risk (18% Liability)',
  EXPORT: 'Export Revenue (GST 0%)',
} as const; // align with types.RevenueCategory

async function stripeGet(url: string, headers: HeadersInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { method: 'GET', headers });
    if (response.status !== 429) return response;
    if (attempt === maxRetries) return response;
    const retryAfter = Number(response.headers.get('Retry-After') || 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error('stripeGet: exceeded retry limit');
}

function buildStripeHeaders(
  apiKey: string,
  contextAccountId: string | null | undefined,
  accountId?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Stripe-Version': STRIPE_VERSION,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const isOrgKey = apiKey?.startsWith('sk_org_');
  const effectiveId = (accountId ?? contextAccountId)?.trim();
  if (effectiveId) {
    if (isOrgKey) headers['Stripe-Context'] = effectiveId;
    else headers['Stripe-Account'] = effectiveId;
  }
  return headers;
}

function getEffectiveContextForAccount(
  config: StripeOrgConfigInput,
  accountId: string | null,
): string | null {
  const isOrgKey = config.apiKey?.startsWith('sk_org_');
  if (accountId !== null) return accountId;
  if (isOrgKey) return config.stripeContextAccountId?.trim() || null;
  return null;
}

function accountsToFetch(config: StripeOrgConfigInput): (string | null)[] {
  const accounts = config.accounts || [];
  const isStandardAccount = config.accountsSource === 'standard';
  const isOrgKey = config.apiKey?.startsWith('sk_org_');
  const isConnect = config.accountsSource === 'connect' || isOrgKey;
  if (isStandardAccount) return [null];
  if (isConnect && accounts.length > 0) return accounts.map((a) => a.id);
  if (accounts.length > 0) return [null, ...accounts.map((a) => a.id)];
  return [null];
}

async function fetchChargesFromStripe(
  apiKey: string,
  accountId: string | null,
  startTs: number,
  endTs: number,
  contextAccountId: string | null | undefined,
): Promise<unknown[]> {
  const allCharges: unknown[] = [];
  let lastId: string | null = null;
  let page = 0;

  while (true) {
    page++;
    if (page > MAX_CHARGE_LIST_PAGES) break;
    const params = new URLSearchParams({
      limit: '100',
      'created[gte]': String(startTs),
      'created[lte]': String(endTs),
      'expand[]': 'data.customer',
    });
    params.append('expand[]', 'data.balance_transaction');
    if (lastId) params.set('starting_after', lastId);

    const url = `https://api.stripe.com/v1/charges?${params.toString()}`;
    const headers = buildStripeHeaders(apiKey, contextAccountId, accountId);
    const response = await stripeGet(url, headers);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = (err as { error?: { message?: string } })?.error?.message || `Stripe charges failed (${response.status})`;
      throw new Error(msg);
    }
    const result = (await response.json()) as { data?: unknown[]; has_more?: boolean };
    const batch = result.data || [];
    allCharges.push(...batch);
    if (!result.has_more || batch.length === 0) break;
    const last = batch[batch.length - 1] as { id?: string };
    lastId = last.id || null;
    if (!lastId) break;
  }
  return allCharges;
}

const fxMem = new Map<string, number>();

async function getFxRateForDate(date: string, from: string, to: string): Promise<number> {
  const fromUpper = from?.toUpperCase() || 'USD';
  const toUpper = to?.toUpperCase() || 'USD';
  if (fromUpper === toUpper) return 1;
  const cacheKey = `${date}-${fromUpper}-${toUpper}`;
  if (fxMem.has(cacheKey)) return fxMem.get(cacheKey)!;
  const fromCode = FRANKFURTER.has(fromUpper) ? fromUpper : 'USD';
  const toCode = FRANKFURTER.has(toUpper) ? toUpper : 'USD';
  try {
    const res = await fetch(`https://api.frankfurter.app/${date}?from=${fromCode}&to=${toCode}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('FX failed');
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data?.rates?.[toCode];
    if (typeof rate === 'number' && rate > 0) {
      fxMem.set(cacheKey, rate);
      return rate;
    }
  } catch {
    // fall through
  }
  if (fromUpper === 'USD' && toUpper === 'INR') return DEFAULT_USD_INR;
  if (fromUpper === 'INR' && toUpper === 'USD') return 1 / DEFAULT_USD_INR;
  return 1;
}

async function convertToBaseCurrency(
  amount: number,
  fromCurrency: string,
  date: string,
  baseCurrency: BaseCurrency,
): Promise<{ amount: number; fxRate: number; fxRateDate: string }> {
  const from = (fromCurrency?.toUpperCase() || 'USD') as string;
  if (from === baseCurrency) return { amount, fxRate: 1, fxRateDate: date };
  if (!FRANKFURTER.has(from)) {
    return convertToBaseCurrency(amount, 'USD', date, baseCurrency);
  }
  const rate = await getFxRateForDate(date, from, baseCurrency);
  if (rate <= 0) return { amount: 0, fxRate: 0, fxRateDate: date };
  return { amount: Math.round(amount * rate * 100) / 100, fxRate: rate, fxRateDate: date };
}

function convertToBaseSync(amount: number, from: 'USD' | 'INR', base: BaseCurrency): number {
  if (from === base) return amount;
  if (from === 'USD' && base === 'INR') return amount * DEFAULT_USD_INR;
  if (from === 'INR' && base === 'USD') return amount / DEFAULT_USD_INR;
  return amount;
}

async function mapCharge(
  charge: Record<string, unknown>,
  accountId: string | undefined,
  baseCurrency: BaseCurrency,
): Promise<Record<string, unknown>> {
  const c = charge;
  const customer = c.customer as Record<string, unknown> | undefined;
  const billing = c.billing_details as Record<string, unknown> | undefined;
  const addr = (billing?.address || customer?.address || (customer?.shipping as Record<string, unknown> | undefined)?.address) as Record<string, unknown> | undefined;
  const country = (addr?.country as string) || 'Unknown';
  const isIndia = country === 'IN';
  const classification = isIndia ? RevenueExport.OIDAR_RISK : RevenueExport.EXPORT;
  const customerEmail = (customer?.email as string) || (billing?.email as string) || '';
  const now = new Date().toISOString();
  const created = typeof c.created === 'number' ? c.created : Math.floor(Date.now() / 1000);
  const txDate = new Date(created * 1000).toISOString().split('T')[0];
  const amountRefunded = (c.amount_refunded as number) ?? 0;
  const amount = (c.amount as number) ?? 0;
  const netAmountCents = amount - amountRefunded;
  const originalAmount = netAmountCents / 100;
  const originalCurrency = ((c.currency as string) || 'usd').toUpperCase();

  const bt = c.balance_transaction as Record<string, unknown> | undefined;
  const feeCents = (bt?.fee as number) ?? 0;
  const netCents = bt
    ? ((bt.net as number) ?? netAmountCents - feeCents)
    : netAmountCents;
  const feeOriginal = feeCents / 100;
  const netOriginal = netCents / 100;

  const { amount: convAmt, fxRate, fxRateDate } = await convertToBaseCurrency(originalAmount, originalCurrency, txDate, baseCurrency);
  const { amount: feeAmount } = await convertToBaseCurrency(feeOriginal, originalCurrency, txDate, baseCurrency);
  const { amount: netAmount } = await convertToBaseCurrency(netOriginal, originalCurrency, txDate, baseCurrency);

  const fallbackAmount = (converted: number, orig: number): number => {
    if (converted > 0 || orig <= 0) return converted;
    if (originalCurrency === baseCurrency) return orig;
    if (originalCurrency === 'USD' && baseCurrency === 'INR') return convertToBaseSync(orig, 'USD', 'INR');
    if (originalCurrency === 'INR' && baseCurrency === 'USD') return convertToBaseSync(orig, 'INR', 'USD');
    return orig;
  };
  const safeAmount = fallbackAmount(convAmt, originalAmount);
  const safeFee = fallbackAmount(feeAmount, feeOriginal);
  const safeNet = fallbackAmount(netAmount, netOriginal);

  const refunded = Boolean(c.refunded);
  const statusStr = (c.status as string) || '';
  const txStatus = refunded
    ? 'Refunded'
    : statusStr === 'succeeded'
      ? 'Completed'
      : statusStr === 'failed'
        ? 'Failed'
        : 'Pending';

  const desc =
    (c.description as string) ||
    `${(customer?.name as string) || 'Customer'} (${customerEmail})`;

  const id = (c.id as string) || `ch_${created}`;

  return {
    id,
    stripeChargeId: id,
    stripeAccountId: accountId,
    lastSyncedAt: now,
    date: txDate,
    description: desc,
    amount: safeAmount,
    currency: baseCurrency,
    originalAmount,
    originalCurrency,
    fxRate,
    fxRateDate,
    feeAmount: safeFee,
    netAmount: safeNet ?? safeAmount - safeFee,
    source: 'Stripe',
    status: txStatus,
    category: (c.metadata as Record<string, string> | undefined)?.type || (c.invoice ? 'Subscription' : 'One-time'),
    type: 'Income',
    customerLocation: country,
    classification,
  };
}

const CHUNK = 250;

export async function syncStripeToSqlite(opts: StripeSqliteSyncOptions): Promise<{
  ok: boolean;
  accountsSynced: number;
  chargeCount: number;
  upserted: number;
  purgeRemoved: number;
  error?: string;
}> {
  const { orgId, baseCurrency, stripe, entireHistory, startDate, endDate, purge } = opts;

  if (!stripe.apiKey?.startsWith('sk_')) {
    return { ok: false, accountsSynced: 0, chargeCount: 0, upserted: 0, purgeRemoved: 0, error: 'Invalid Stripe API key' };
  }

  let purgeRemoved = 0;
  if (purge === 'all') {
    purgeRemoved = deleteAllTransactionsForOrg(orgId);
  } else if (purge === 'stripe') {
    purgeRemoved = deleteTransactionsByOrgAndSource(orgId, 'Stripe');
  }

  const today = new Date().toISOString().split('T')[0];
  const endD = endDate && endDate > today ? endDate : today;
  const endTs = Math.floor(new Date(endD).getTime() / 1000) + 86399;
  const nowTs = Math.floor(Date.now() / 1000);

  const startTs = entireHistory
    ? STRIPE_EARLIEST_CHARGE_TS
    : Math.floor(new Date(startDate).getTime() / 1000);

  const effectiveEndTs = Math.min(nowTs + 60, endTs);

  const toFetch = accountsToFetch(stripe);
  const allMapped: Record<string, unknown>[] = [];
  let chargeCount = 0;

  try {
    for (const accId of toFetch) {
      const ctx = getEffectiveContextForAccount(stripe, accId);
      const charges = await fetchChargesFromStripe(stripe.apiKey, accId, startTs, effectiveEndTs, ctx);
      chargeCount += charges.length;
      for (const ch of charges) {
        try {
          const row = await mapCharge(ch as Record<string, unknown>, accId || undefined, baseCurrency);
          allMapped.push(row);
        } catch (e) {
          console.error('[stripeSqliteSync] mapCharge failed', (ch as { id?: string })?.id, e);
        }
      }
    }

    for (let i = 0; i < allMapped.length; i += CHUNK) {
      bulkUpsertTransactions(orgId, allMapped.slice(i, i + CHUNK));
    }

    return {
      ok: true,
      accountsSynced: toFetch.length,
      chargeCount,
      upserted: allMapped.length,
      purgeRemoved,
    };
  } catch (e) {
    return {
      ok: false,
      accountsSynced: 0,
      chargeCount,
      upserted: 0,
      purgeRemoved,
      error: (e as Error).message,
    };
  }
}
