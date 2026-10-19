import type Database from 'better-sqlite3';
import { listCustomerPayments, summarizeCustomers, type CustomerSummary, type PaymentRow } from './queries.js';
import type { CustomerLifecycle } from './types.js';

/**
 * A "person" groups the per-account Stripe customers that share an email (case-insensitive).
 * Stripe customer ids are per account, so email is the only cross-account identity available.
 * Customers without an email stay on their own, keyed by account and customer id.
 */
export interface PersonSummary {
  key: string;
  email: string | null;
  name: string | null;
  lifecycle: CustomerLifecycle;
  accountCount: number;
  liveSubscriptions: number;
  paymentCount: number;
  /** Succeeded charges net of refunds, minor units, keyed by lowercase currency. */
  paid: Record<string, number>;
}

export interface PersonRef {
  email?: string;
  accountId?: string;
  customerId?: string;
}

export interface SubscriptionItem {
  priceId: string | null;
  productId: string | null;
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

export interface PersonPayment extends PaymentRow {
  accountId: string;
  accountName: string;
  customerId: string;
}

export interface PersonProfile {
  person: PersonSummary;
  customers: CustomerSummary[];
  subscriptions: SubscriptionDetail[];
  payments: PersonPayment[];
}

const LIVE_STATUSES = new Set(['active', 'past_due', 'unpaid', 'paused', 'trialing']);
const LIFECYCLE_RANK: Record<CustomerLifecycle, number> = { current: 3, future: 2, past: 1, none: 0 };
const DEFAULT_PAGE = 50;

export function personKey(c: Pick<CustomerSummary, 'email' | 'accountId' | 'customerId'>): string {
  const email = c.email?.trim().toLowerCase();
  return email || `${c.accountId}|${c.customerId}`;
}

function bestLifecycle(members: CustomerSummary[]): CustomerLifecycle {
  return members.reduce<CustomerLifecycle>(
    (best, m) => (LIFECYCLE_RANK[m.lifecycle] > LIFECYCLE_RANK[best] ? m.lifecycle : best), 'none');
}

function summarizePerson(key: string, members: CustomerSummary[]): PersonSummary {
  const paid: Record<string, number> = {};
  for (const m of members) for (const [cur, v] of Object.entries(m.paid)) paid[cur] = (paid[cur] ?? 0) + v;
  return {
    key,
    email: members.find((m) => m.email)?.email ?? null,
    name: members.find((m) => m.name)?.name ?? null,
    lifecycle: bestLifecycle(members),
    accountCount: new Set(members.map((m) => m.accountId)).size,
    liveSubscriptions: members.reduce((n, m) => n + m.subscriptionStatuses.filter((s) => LIVE_STATUSES.has(s)).length, 0),
    paymentCount: members.reduce((n, m) => n + m.paymentCount, 0),
    paid,
  };
}

function groupByPerson(customers: CustomerSummary[]): Map<string, CustomerSummary[]> {
  const groups = new Map<string, CustomerSummary[]>();
  for (const c of customers) {
    const k = personKey(c);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return groups;
}

function matches(members: CustomerSummary[], key: string, q: string): boolean {
  const needle = q.toLowerCase();
  return key.toLowerCase().includes(needle) || members.some((m) =>
    [m.name, m.email, m.customerId, m.accountId].some((v) => v?.toLowerCase().includes(needle)));
}

export function listPeople(
  db: Database.Database, orgId: string, f: { q?: string; limit?: number; offset?: number },
): { people: PersonSummary[]; total: number } {
  const groups = groupByPerson(summarizeCustomers(db, orgId, {}));
  const people = [...groups.entries()]
    .filter(([key, members]) => !f.q || matches(members, key, f.q))
    .map(([key, members]) => summarizePerson(key, members))
    .sort((a, b) => b.paymentCount - a.paymentCount || (a.email ?? a.key).localeCompare(b.email ?? b.key));
  const offset = f.offset ?? 0;
  return { people: people.slice(offset, offset + (f.limit ?? DEFAULT_PAGE)), total: people.length };
}

function productNames(db: Database.Database, orgId: string): Map<string, string> {
  const rows = db.prepare(`
    SELECT account_id, stripe_id, json_extract(raw, '$.name') AS name FROM stripe_mirror_objects
    WHERE org_id = ? AND resource = 'products' AND deleted_at IS NULL`)
    .all(orgId) as { account_id: string; stripe_id: string; name: string | null }[];
  return new Map(rows.filter((r) => r.name).map((r) => [`${r.account_id}|${r.stripe_id}`, r.name as string]));
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function toItem(raw: Record<string, unknown>, accountId: string, names: Map<string, string>): SubscriptionItem {
  const price = (raw.price ?? {}) as Record<string, unknown>;
  const recurring = (price.recurring ?? {}) as Record<string, unknown>;
  const product = typeof price.product === 'string' ? price.product : text((price.product as { id?: string } | undefined)?.id);
  return {
    priceId: text(price.id), productId: product,
    productName: product ? names.get(`${accountId}|${product}`) ?? null : null,
    nickname: text(price.nickname), unitAmount: num(price.unit_amount), currency: text(price.currency),
    interval: text(recurring.interval), intervalCount: num(recurring.interval_count), quantity: num(raw.quantity),
  };
}

function toSubscription(
  raw: Record<string, unknown>, member: CustomerSummary, names: Map<string, string>,
): SubscriptionDetail {
  const items = ((raw.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])
    .map((i) => toItem(i, member.accountId, names));
  return {
    id: String(raw.id), accountId: member.accountId, accountName: member.accountName, customerId: member.customerId,
    status: String(raw.status ?? 'unknown'), created: num(raw.created), trialEnd: num(raw.trial_end),
    currentPeriodEnd: num(raw.current_period_end), cancelAtPeriodEnd: raw.cancel_at_period_end === true,
    cancelAt: num(raw.cancel_at), canceledAt: num(raw.canceled_at), endedAt: num(raw.ended_at), items,
  };
}

function subscriptionsFor(
  db: Database.Database, orgId: string, member: CustomerSummary, names: Map<string, string>,
): SubscriptionDetail[] {
  const rows = db.prepare(`
    SELECT raw FROM stripe_mirror_objects
    WHERE org_id = ? AND account_id = ? AND resource = 'subscriptions' AND customer_id = ? AND deleted_at IS NULL`)
    .all(orgId, member.accountId, member.customerId) as { raw: string }[];
  return rows.map((r) => toSubscription(JSON.parse(r.raw) as Record<string, unknown>, member, names));
}

function findMembers(all: CustomerSummary[], ref: PersonRef): CustomerSummary[] {
  const email = ref.email?.trim().toLowerCase();
  if (email) return all.filter((c) => c.email?.trim().toLowerCase() === email);
  return all.filter((c) => c.accountId === ref.accountId && c.customerId === ref.customerId);
}

/** Full cross-account profile, or null when no mirrored customer matches. */
export function getPersonProfile(db: Database.Database, orgId: string, ref: PersonRef): PersonProfile | null {
  const customers = findMembers(summarizeCustomers(db, orgId, {}), ref);
  if (customers.length === 0) return null;
  const names = productNames(db, orgId);
  const subscriptions = customers.flatMap((c) => subscriptionsFor(db, orgId, c, names))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const payments = customers.flatMap((c) =>
    listCustomerPayments(db, orgId, c.accountId, c.customerId).payments.map((p) => ({
      ...p, accountId: c.accountId, accountName: c.accountName, customerId: c.customerId,
    }))).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return { person: summarizePerson(personKey(customers[0]), customers), customers, subscriptions, payments };
}
