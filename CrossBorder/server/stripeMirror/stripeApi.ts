import { STRIPE_API_VERSION } from '../../services/stripeConstants.js';
import type { StripeCreds } from './types.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 100_000;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1000;
const RATE_LIMIT_STATUS = 429;
const SERVER_ERROR_FLOOR = 500;

export interface ListDeps {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export const defaultListDeps: ListDeps = {
  fetchFn: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Org keys address a member account with Stripe-Context; standard keys use Stripe-Account. */
export function buildHeaders(creds: StripeCreds): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.apiKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
  };
  const scopeHeader = creds.apiKey.startsWith('sk_org_') ? 'Stripe-Context' : 'Stripe-Account';
  headers[scopeHeader] = creds.accountId;
  return headers;
}

function isRetryable(status: number): boolean {
  return status === RATE_LIMIT_STATUS || status >= SERVER_ERROR_FLOOR;
}

async function getWithRetry(url: string, headers: Record<string, string>, deps: ListDeps): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await deps.fetchFn(url, { method: 'GET', headers });
    if (!isRetryable(response.status) || attempt >= MAX_RETRIES) return response;
    const retryAfterMs = Number(response.headers.get('Retry-After') || 0) * 1000;
    await deps.sleep(retryAfterMs > 0 ? retryAfterMs : BACKOFF_BASE_MS * 2 ** attempt);
  }
}

async function errorMessage(response: Response, url: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  return `Stripe GET ${url.split('?')[0]} failed (${response.status}): ${body.error?.message ?? 'no message'}`;
}

/**
 * Lists every object at `path` for one account. Throws on any non-2xx so callers never
 * treat a partial listing as complete (a partial listing must not tombstone mirror rows).
 */
export async function listAll(
  creds: StripeCreds,
  path: string,
  query: Record<string, string>,
  deps: ListDeps = defaultListDeps,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), ...query });
    if (startingAfter) params.set('starting_after', startingAfter);
    const url = `https://api.stripe.com${path}?${params.toString()}`;
    const response = await getWithRetry(url, buildHeaders(creds), deps);
    if (!response.ok) throw new Error(await errorMessage(response, url));
    const body = (await response.json()) as { data?: Record<string, unknown>[]; has_more?: boolean };
    const batch = body.data ?? [];
    out.push(...batch);
    const lastId = batch.length > 0 ? String(batch[batch.length - 1]?.id ?? '') : '';
    if (!body.has_more || !lastId) return out;
    startingAfter = lastId;
  }
  throw new Error(`Stripe GET ${path} exceeded ${MAX_PAGES} pages`);
}
