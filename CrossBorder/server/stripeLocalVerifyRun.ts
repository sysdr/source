/**
 * Fetch live Stripe charges and verify each against SQLite ledger rows.
 */
import { getOrgData, getAllTransactionsForOrg } from './db.js';
import { STRIPE_API_VERSION } from '../services/stripeConstants.js';
import {
  localChargeKey,
  verifyStripeChargesAgainstLocal,
  type LocalStripeSnapshot,
  type StripeChargeSnapshot,
  type StripeLocalVerifyReport,
} from '../services/stripeLocalVerify.js';
import type { Transaction } from '../types.js';

type StripeOrgConfig = {
  apiKey: string;
  accounts?: { id: string; name?: string; scope?: string }[];
  accountsSource?: 'connect' | 'standard';
  stripeContextAccountId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildHeaders(apiKey: string, accountId: string | null, contextId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const isOrgKey = apiKey.startsWith('sk_org_');
  const effective = (accountId ?? contextId)?.trim();
  if (effective) {
    if (isOrgKey) headers['Stripe-Context'] = effective;
    else headers['Stripe-Account'] = effective;
  }
  return headers;
}

async function stripeGet(url: string, headers: Record<string, string>): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status !== 429 && res.status < 500) return res;
    const retryAfter = Number(res.headers.get('Retry-After') || 0);
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
  }
  return fetch(url, { headers });
}

async function fetchChargesForAccount(params: {
  apiKey: string;
  accountId: string | null;
  contextId: string | null;
  startTs: number;
  endTs: number;
  maxPages?: number;
}): Promise<StripeChargeSnapshot[]> {
  const headers = buildHeaders(params.apiKey, params.accountId, params.contextId);
  const out: StripeChargeSnapshot[] = [];
  let startingAfter: string | undefined;
  const maxPages = params.maxPages ?? 200;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      limit: '100',
      'created[gte]': String(params.startTs),
      'created[lte]': String(params.endTs),
      'expand[]': 'data.balance_transaction',
    });
    if (startingAfter) qs.set('starting_after', startingAfter);
    const res = await stripeGet(`https://api.stripe.com/v1/charges?${qs}`, headers);
    const body = await res.json() as {
      data?: StripeChargeSnapshot[];
      has_more?: boolean;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(body.error?.message || `Stripe charges failed (${res.status}) for ${params.accountId ?? 'platform'}`);
    }
    const batch = body.data || [];
    out.push(...batch);
    if (!body.has_more || batch.length === 0) break;
    startingAfter = batch[batch.length - 1]?.id;
    if (!startingAfter) break;
  }
  return out;
}

function accountsToFetch(config: StripeOrgConfig): (string | null)[] {
  const accounts = config.accounts || [];
  const isOrgKey = config.apiKey.startsWith('sk_org_');
  const isStandard = config.accountsSource === 'standard';
  const isConnect = config.accountsSource === 'connect' || isOrgKey;
  if (isStandard) return [null];
  if (isConnect && accounts.length > 0) return accounts.map((a) => a.id);
  if (accounts.length > 0) return [null, ...accounts.map((a) => a.id)];
  return [null];
}

function parseYmdToEndTs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 23, 59, 59) / 1000);
}

function parseYmdToStartTs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000);
}

export async function runStripeLocalVerification(params: {
  orgId: string;
  days?: number;
  entireHistory?: boolean;
  /** Inclusive YYYY-MM-DD — overrides days when set with endDate */
  startDate?: string;
  endDate?: string;
  accountId?: string;
  maxPagesPerAccount?: number;
}): Promise<StripeLocalVerifyReport & { accountsFetched: number; errors: string[]; window: { startDate: string; endDate: string } }> {
  const config = getOrgData(params.orgId, 'suez_stripe_org_config') as StripeOrgConfig | null;
  if (!config?.apiKey?.startsWith('sk_')) {
    throw new Error(`No Stripe API key in org_data for ${params.orgId} (key suez_stripe_org_config)`);
  }

  let endTs = Math.floor(Date.now() / 1000);
  let startTs = params.entireHistory
    ? 1_262_304_000
    : endTs - Math.max(1, params.days ?? 90) * 24 * 60 * 60;

  if (params.startDate && params.endDate) {
    startTs = parseYmdToStartTs(params.startDate);
    endTs = parseYmdToEndTs(params.endDate);
  } else if (params.startDate) {
    startTs = parseYmdToStartTs(params.startDate);
  } else if (params.endDate) {
    endTs = parseYmdToEndTs(params.endDate);
  }

  const startDate = new Date(startTs * 1000).toISOString().slice(0, 10);
  const endDate = new Date(endTs * 1000).toISOString().slice(0, 10);

  const accountFilter = params.accountId?.trim();
  const accounts = accountsToFetch(config).filter((id) =>
    accountFilter ? id === accountFilter : true,
  );

  const charges: Array<StripeChargeSnapshot & { accountId?: string | null }> = [];
  const errors: string[] = [];

  for (const accountId of accounts) {
    try {
      const contextId = accountId ?? config.stripeContextAccountId ?? null;
      const batch = await fetchChargesForAccount({
        apiKey: config.apiKey,
        accountId,
        contextId: accountId ? accountId : contextId,
        startTs,
        endTs,
        maxPages: params.maxPagesPerAccount,
      });
      for (const c of batch) charges.push({ ...c, accountId });
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  const localTxs = (getAllTransactionsForOrg(params.orgId) as Transaction[])
    .filter((t) => t.source === 'Stripe')
    .map((t): LocalStripeSnapshot => ({
      id: t.id,
      stripeChargeId: t.stripeChargeId,
      date: t.date,
      status: t.status,
      amount: t.amount,
      currency: t.currency,
      originalAmount: t.originalAmount,
      originalCurrency: t.originalCurrency,
      feeAmount: t.feeAmount,
      netAmount: t.netAmount,
      stripeAccountId: t.stripeAccountId,
    }));

  // Match by charge id against the full local Stripe ledger (date skew / sync lag).
  // missing_stripe still limited to local rows whose ledger date falls in the window.
  const localForMatch = localTxs;
  const report = verifyStripeChargesAgainstLocal({
    orgId: params.orgId,
    charges,
    localTransactions: localForMatch,
  });

  const localInWindowKeys = new Set(
    localTxs
      .filter((t) => t.date >= startDate && t.date <= endDate)
      .map((t) => localChargeKey(t))
      .filter((k): k is string => Boolean(k)),
  );

  const rows = report.rows.filter((r) => {
    if (r.outcome !== 'missing_stripe') return true;
    return localInWindowKeys.has(r.chargeId);
  });

  const filtered = {
    ...report,
    missingStripe: rows.filter((r) => r.outcome === 'missing_stripe').length,
    rows,
  };

  return {
    ...filtered,
    accountsFetched: accounts.length,
    errors,
    window: { startDate, endDate },
  };
}
