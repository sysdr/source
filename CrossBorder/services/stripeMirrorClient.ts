/** Browser client for the Stripe mirror API (server/stripeMirror). */
import { apiFetch, qs } from './apiClient';

export type Lifecycle = 'current' | 'future' | 'past' | 'none';
export type LifecycleFilter = Lifecycle | 'all';

export interface MirrorAccount {
  accountId: string;
  name: string;
  kind: 'organisation' | 'connect_child';
  parentAccountId: string | null;
  lastSyncedAt: string | null;
  lastStatus: 'never' | 'ok' | 'failed';
  lastError: string | null;
  counts: { customers: number; subscriptions: number; schedules: number; charges: number; products: number };
}

export interface MirrorCustomer {
  accountId: string;
  accountName: string;
  customerId: string;
  name: string | null;
  email: string | null;
  created: number | null;
  lifecycle: Lifecycle;
  subscriptionStatuses: string[];
  scheduleStatuses: string[];
  paymentCount: number;
  paid: Record<string, number>;
}

export interface CustomerPage {
  customers: MirrorCustomer[];
  total: number;
  lifecycleCounts: Record<LifecycleFilter, number>;
}

export interface MirrorPayment {
  id: string;
  created: number | null;
  amount: number;
  amountRefunded: number;
  currency: string;
  status: string;
  refunded: boolean;
  description: string | null;
  invoiceId: string | null;
  paymentMethodType: string | null;
  receiptUrl: string | null;
  failureMessage: string | null;
}

export interface PersonSummary {
  key: string;
  email: string | null;
  name: string | null;
  lifecycle: Lifecycle;
  accountCount: number;
  liveSubscriptions: number;
  paymentCount: number;
  paid: Record<string, number>;
}

export interface PersonRef {
  email?: string;
  accountId?: string;
  customerId?: string;
}

export interface SubscriptionItem {
  productName: string | null;
  nickname: string | null;
  unitAmount: number | null;
  currency: string | null;
  interval: string | null;
  intervalCount: number | null;
  quantity: number | null;
}

export interface SubscriptionDetail {
  id: string;
  accountId: string;
  accountName: string;
  customerId: string;
  status: string;
  created: number | null;
  trialEnd: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  canceledAt: number | null;
  endedAt: number | null;
  items: SubscriptionItem[];
}

export interface PersonPayment extends MirrorPayment {
  accountId: string;
  accountName: string;
  customerId: string;
}

export interface PersonProfile {
  person: PersonSummary;
  customers: MirrorCustomer[];
  subscriptions: SubscriptionDetail[];
  payments: PersonPayment[];
}

export interface AccountSyncSummary {
  accountId: string;
  ok: boolean;
  error?: string;
}

export interface MirrorRun {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'partial' | 'failed';
  accountIds: string[];
  results: AccountSyncSummary[];
}

export interface CustomerQuery {
  orgId: string;
  account?: string;
  lifecycle?: LifecycleFilter;
  q?: string;
  limit: number;
  offset: number;
}

const BASE = '/api/stripe-mirror';

async function required<T>(promise: Promise<T | null>): Promise<T> {
  const result = await promise;
  if (result === null) throw new Error('API server unreachable — start it with `npm run server`');
  return result;
}

const post = (path: string, body: unknown) =>
  apiFetch<Record<string, unknown>>(`${BASE}/${path}`, { method: 'POST', body: JSON.stringify(body) });

export const stripeMirrorApi = {
  async accounts(orgId: string): Promise<MirrorAccount[]> {
    return (await required(apiFetch<{ accounts: MirrorAccount[] }>(`${BASE}/accounts${qs({ orgId })}`))).accounts;
  },
  async runs(orgId: string): Promise<{ running: boolean; runs: MirrorRun[] }> {
    return required(apiFetch<{ running: boolean; runs: MirrorRun[] }>(`${BASE}/runs${qs({ orgId })}`));
  },
  async customers(query: CustomerQuery): Promise<CustomerPage> {
    return required(apiFetch<CustomerPage>(`${BASE}/customers${qs({ ...query })}`));
  },
  async payments(orgId: string, accountId: string, customerId: string) {
    return required(apiFetch<{ payments: MirrorPayment[]; netPaid: Record<string, number> }>(
      `${BASE}/payments${qs({ orgId, accountId, customerId })}`,
    ));
  },
  async people(orgId: string, q: string, limit: number, offset: number): Promise<{ people: PersonSummary[]; total: number }> {
    return required(apiFetch<{ people: PersonSummary[]; total: number }>(`${BASE}/people${qs({ orgId, q, limit, offset })}`));
  },
  async person(orgId: string, ref: PersonRef): Promise<PersonProfile> {
    return required(apiFetch<PersonProfile>(`${BASE}/person${qs({ orgId, ...ref })}`));
  },
  async discover(orgId: string): Promise<{ discovered: number; added: number }> {
    return (await required(post('discover', { orgId }))) as { discovered: number; added: number };
  },
  async sync(orgId: string, accountIds?: string[]): Promise<{ runId: string }> {
    return (await required(post('sync', { orgId, accountIds }))) as { runId: string };
  },
};
