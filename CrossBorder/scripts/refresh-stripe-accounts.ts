#!/usr/bin/env tsx
/**
 * Discover all Stripe org accounts and sync charges into SQLite.
 *
 *   npx tsx scripts/refresh-stripe-accounts.ts --org=org-1769926725440
 *   npx tsx scripts/refresh-stripe-accounts.ts --org=... --sync --days=90
 *   npx tsx scripts/refresh-stripe-accounts.ts --org=... --sync --entire --purge=none
 */
import { getOrgData } from '../server/db.ts';
import { discoverStripeAccounts } from '../services/stripeAccountDiscovery.ts';
import { syncStripeToSqlite } from '../server/stripeSqliteSync.ts';
import { setOrgData } from '../server/db.ts';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const orgId = arg('org') || 'org-1769926725440';
  const doSync = hasFlag('sync');
  const entire = hasFlag('entire');
  const days = Number(arg('days') || 90);
  const purge = (arg('purge') as 'none' | 'stripe' | 'all') || 'none';

  const config = getOrgData(orgId, 'suez_stripe_org_config') as {
    apiKey?: string;
    accounts?: { id: string; name?: string }[];
    stripeContextAccountId?: string;
  } | null;

  if (!config?.apiKey?.startsWith('sk_')) {
    throw new Error(`No Stripe API key for ${orgId}`);
  }

  console.error(`Discovering Stripe accounts for ${orgId}…`);
  const before = new Set((config.accounts || []).map((a) => a.id));
  const { accounts, source } = await discoverStripeAccounts({
    apiKey: config.apiKey,
    knownAccounts: config.accounts || [],
    includeConnectChildren: true,
  });

  const now = new Date().toISOString();
  const next = {
    ...config,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, scope: 'organisation' as const, addedAt: now })),
    accountsSource: source === 'standard' ? 'standard' : 'connect',
    lastSavedAt: now,
    accountsRefreshedAt: now,
  };
  setOrgData(orgId, 'suez_stripe_org_config', next);

  const added = accounts.filter((a) => !before.has(a.id));
  console.log(JSON.stringify({
    orgId,
    source,
    totalAccounts: accounts.length,
    previouslyCached: before.size,
    newlyAdded: added.map((a) => ({ id: a.id, name: a.name })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
  }, null, 2));

  if (!doSync) {
    console.error('Discovery only. Pass --sync to import charges.');
    return;
  }

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  console.error(`Syncing ${accounts.length} accounts (${entire ? 'entire history' : `${startDate}→${endDate}`})…`);
  const result = await syncStripeToSqlite({
    orgId,
    baseCurrency: 'INR',
    stripe: {
      apiKey: config.apiKey,
      accounts: next.accounts,
      accountsSource: next.accountsSource as 'connect' | 'standard',
      stripeContextAccountId: config.stripeContextAccountId,
    },
    entireHistory: entire,
    startDate,
    endDate,
    purge,
    refreshAccounts: false, // already refreshed above
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
