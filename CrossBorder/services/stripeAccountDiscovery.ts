/**
 * Discover every Stripe account reachable with an Organization API key (sk_org_).
 *
 * Stripe does not expose a first-class "list org member accounts" endpoint for sk_org_.
 * `/v1/accounts` only returns Connect children of the context account (usually empty
 * for sibling org accounts). We therefore:
 *  1. Probe the org-wide Sigma query API without Stripe-Context — the 403 lists every
 *     member account id in the organization.
 *  2. Resolve display names via GET /v1/account per id.
 *  3. Also walk `/v1/accounts` under each member for any Connect children.
 */
import { STRIPE_API_VERSION } from './stripeConstants';

export type DiscoveredStripeAccount = {
  id: string;
  name: string;
  /** Direct org member vs Connect child under a member. */
  kind: 'organisation' | 'connect_child';
  parentAccountId?: string;
};

const ACCOUNT_ID_RE = /acct_[A-Za-z0-9]+/g;
const SIGMA_PROBE_VERSION = '2026-04-22.preview';

function accountDisplayName(acc: Record<string, unknown>): string {
  const bp = acc.business_profile as { name?: string } | undefined;
  const settings = acc.settings as { dashboard?: { display_name?: string } } | undefined;
  return (
    bp?.name ||
    settings?.dashboard?.display_name ||
    (typeof acc.email === 'string' ? acc.email : null) ||
    `${String(acc.id || '').slice(0, 12)}...`
  );
}

async function stripeJson(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** Extract acct_* ids from a Sigma "missing a Sigma plan" error (org-wide). */
export function parseOrgAccountIdsFromSigmaError(message: string): string[] {
  const ids = message.match(ACCOUNT_ID_RE) || [];
  return [...new Set(ids)].sort();
}

/**
 * List all organization member account ids using the Sigma query-run 403 probe.
 * Returns [] if the probe shape changes or the key is not an org key.
 */
export async function listOrgAccountIdsViaSigmaProbe(apiKey: string): Promise<string[]> {
  if (!apiKey.startsWith('sk_org_')) return [];

  const res = await stripeJson(
    'https://api.stripe.com/v2/data/reporting/query_runs',
    {
      Authorization: `Bearer ${apiKey}`,
      'Stripe-Version': SIGMA_PROBE_VERSION,
      'Content-Type': 'application/json',
    },
    {
      method: 'POST',
      body: JSON.stringify({ sql: 'SELECT 1' }),
    },
  );

  const err = res.body.error as { message?: string; code?: string } | undefined;
  const message = err?.message || '';
  const ids = parseOrgAccountIdsFromSigmaError(message);
  if (ids.length > 0) return ids;

  // Unexpected success or different error — cannot discover.
  if (res.ok) {
    throw new Error('Sigma probe unexpectedly succeeded; cannot extract org account list from error.');
  }
  throw new Error(
    `Unable to list organization accounts via Sigma probe: ${message || `HTTP ${res.status}`}`,
  );
}

async function retrieveAccount(
  apiKey: string,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  const res = await stripeJson(`https://api.stripe.com/v1/account`, {
    Authorization: `Bearer ${apiKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
    'Stripe-Context': accountId,
  });
  if (!res.ok) return null;
  return res.body;
}

async function listConnectChildren(
  apiKey: string,
  parentAccountId: string,
): Promise<DiscoveredStripeAccount[]> {
  const out: DiscoveredStripeAccount[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ limit: '100' });
    if (startingAfter) qs.set('starting_after', startingAfter);
    const res = await stripeJson(`https://api.stripe.com/v1/accounts?${qs}`, {
      Authorization: `Bearer ${apiKey}`,
      'Stripe-Version': STRIPE_API_VERSION,
      'Stripe-Context': parentAccountId,
    });
    if (!res.ok) break;
    const data = (res.body.data as Record<string, unknown>[]) || [];
    for (const acc of data) {
      const id = String(acc.id || '');
      if (!id) continue;
      out.push({
        id,
        name: accountDisplayName(acc),
        kind: 'connect_child',
        parentAccountId,
      });
    }
    if (!res.body.has_more || data.length === 0) break;
    startingAfter = String(data[data.length - 1]?.id || '');
    if (!startingAfter) break;
  }
  return out;
}

/**
 * Full discovery for sk_org_ keys: every org member (+ Connect children).
 * For non-org keys, falls back to `/v1/accounts` then `/v1/account`.
 */
export async function discoverStripeAccounts(params: {
  apiKey: string;
  /** Optional seed / previously saved accounts merged if probe fails. */
  knownAccounts?: { id: string; name?: string }[];
  includeConnectChildren?: boolean;
}): Promise<{ accounts: DiscoveredStripeAccount[]; source: 'organisation' | 'connect' | 'standard' }> {
  const { apiKey, knownAccounts = [], includeConnectChildren = true } = params;

  if (apiKey.startsWith('sk_org_')) {
    let memberIds: string[] = [];
    try {
      memberIds = await listOrgAccountIdsViaSigmaProbe(apiKey);
    } catch {
      memberIds = knownAccounts.map((a) => a.id).filter(Boolean);
    }
    if (memberIds.length === 0) {
      throw new Error(
        'No organization accounts discovered. Add account IDs manually or check the Organization API key.',
      );
    }

    const byId = new Map<string, DiscoveredStripeAccount>();
    for (const id of memberIds) {
      const acc = await retrieveAccount(apiKey, id);
      const known = knownAccounts.find((a) => a.id === id);
      byId.set(id, {
        id,
        name: acc ? accountDisplayName(acc) : known?.name || `${id.slice(0, 12)}...`,
        kind: 'organisation',
      });
      if (includeConnectChildren) {
        const children = await listConnectChildren(apiKey, id);
        for (const child of children) byId.set(child.id, child);
      }
    }
    return { accounts: [...byId.values()], source: 'organisation' };
  }

  // Standard / Connect platform key
  const connect: DiscoveredStripeAccount[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ limit: '100' });
    if (startingAfter) qs.set('starting_after', startingAfter);
    const res = await stripeJson(`https://api.stripe.com/v1/accounts?${qs}`, {
      Authorization: `Bearer ${apiKey}`,
      'Stripe-Version': STRIPE_API_VERSION,
    });
    if (!res.ok) break;
    const data = (res.body.data as Record<string, unknown>[]) || [];
    for (const acc of data) {
      const id = String(acc.id || '');
      if (!id) continue;
      connect.push({ id, name: accountDisplayName(acc), kind: 'connect_child' });
    }
    if (!res.body.has_more || data.length === 0) break;
    startingAfter = String(data[data.length - 1]?.id || '');
    if (!startingAfter) break;
  }
  if (connect.length > 0) return { accounts: connect, source: 'connect' };

  const self = await stripeJson('https://api.stripe.com/v1/account', {
    Authorization: `Bearer ${apiKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
  });
  if (!self.ok) {
    throw new Error(
      ((self.body.error as { message?: string } | undefined)?.message) ||
        `Stripe account lookup failed (${self.status})`,
    );
  }
  return {
    accounts: [
      {
        id: String(self.body.id),
        name: accountDisplayName(self.body),
        kind: 'organisation',
      },
    ],
    source: 'standard',
  };
}
