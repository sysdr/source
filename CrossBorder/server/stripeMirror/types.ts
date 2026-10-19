/** Stripe mirror — shared types. Mirrors Stripe objects verbatim; derived fields live in queries. */

export const MIRROR_RESOURCES = ['customers', 'subscriptions', 'schedules', 'charges', 'products'] as const;
export type MirrorResource = (typeof MIRROR_RESOURCES)[number];

/** Stripe list endpoint per mirrored resource. */
export const RESOURCE_PATHS: Record<MirrorResource, string> = {
  customers: '/v1/customers',
  subscriptions: '/v1/subscriptions',
  schedules: '/v1/subscription_schedules',
  charges: '/v1/charges',
  products: '/v1/products',
};

/** Extra list params per resource (subscriptions default hides canceled ones). */
export const RESOURCE_QUERY: Record<MirrorResource, Record<string, string>> = {
  customers: {},
  subscriptions: { status: 'all' },
  schedules: {},
  charges: {},
  products: {},
};

export type CustomerLifecycle = 'current' | 'future' | 'past' | 'none';

export interface MirrorAccount {
  accountId: string;
  name: string;
  kind: 'organisation' | 'connect_child';
  parentAccountId: string | null;
  discoveredAt: string;
  lastSyncedAt: string | null;
  lastStatus: 'never' | 'ok' | 'failed';
  lastError: string | null;
  counts: Record<MirrorResource, number>;
}

export interface ResourceSyncResult {
  resource: MirrorResource;
  fetched: number;
  stored: number;
  tombstoned: number;
  verified: boolean;
}

export interface AccountSyncResult {
  accountId: string;
  ok: boolean;
  error?: string;
  resources: ResourceSyncResult[];
}

export interface StripeCreds {
  apiKey: string;
  /** Stripe-Context (org keys) or Stripe-Account (standard keys) is derived from the key prefix. */
  accountId: string;
}
