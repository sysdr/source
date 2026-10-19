import type Database from 'better-sqlite3';
import { classifyCustomer } from './lifecycle.js';
import type { CustomerLifecycle } from './types.js';

export interface CustomerFilters {
  /** Substring of an account id (acct_…) or account name. */
  account?: string;
  lifecycle?: CustomerLifecycle | 'all';
  /** Substring of customer id, name or email. */
  q?: string;
  limit: number;
  offset: number;
}

export interface CustomerSummary {
  accountId: string;
  accountName: string;
  customerId: string;
  name: string | null;
  email: string | null;
  created: number | null;
  lifecycle: CustomerLifecycle;
  subscriptionStatuses: string[];
  scheduleStatuses: string[];
  paymentCount: number;
  /** Succeeded charges net of refunds, minor units, keyed by lowercase currency. */
  paid: Record<string, number>;
}

export interface CustomerPage {
  customers: CustomerSummary[];
  total: number;
  lifecycleCounts: Record<CustomerLifecycle | 'all', number>;
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

interface CustomerRow {
  account_id: string; account_name: string | null; stripe_id: string;
  created: number | null; name: string | null; email: string | null;
}

function selectCustomers(db: Database.Database, orgId: string, f: Pick<CustomerFilters, 'account' | 'q'>): CustomerRow[] {
  const where = ["o.org_id = ?", "o.resource = 'customers'", 'o.deleted_at IS NULL'];
  const args: string[] = [orgId];
  if (f.account) {
    where.push("(o.account_id LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\')");
    args.push(likePattern(f.account), likePattern(f.account));
  }
  if (f.q) {
    const p = likePattern(f.q);
    where.push(`(o.stripe_id LIKE ? ESCAPE '\\' OR json_extract(o.raw,'$.name') LIKE ? ESCAPE '\\'
      OR json_extract(o.raw,'$.email') LIKE ? ESCAPE '\\')`);
    args.push(p, p, p);
  }
  return db.prepare(`
    SELECT o.account_id, a.name AS account_name, o.stripe_id, o.created,
           json_extract(o.raw,'$.name') AS name, json_extract(o.raw,'$.email') AS email
    FROM stripe_mirror_objects o
    LEFT JOIN stripe_mirror_accounts a ON a.org_id = o.org_id AND a.account_id = o.account_id
    WHERE ${where.join(' AND ')} ORDER BY o.created DESC, o.stripe_id`).all(...args) as CustomerRow[];
}

const key = (accountId: string, customerId: string): string => `${accountId}|${customerId}`;

function statusesByCustomer(db: Database.Database, orgId: string, resource: string): Map<string, string[]> {
  const rows = db.prepare(`
    SELECT account_id, customer_id, status FROM stripe_mirror_objects
    WHERE org_id = ? AND resource = ? AND deleted_at IS NULL AND customer_id IS NOT NULL`)
    .all(orgId, resource) as { account_id: string; customer_id: string; status: string | null }[];
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const k = key(r.account_id, r.customer_id);
    out.set(k, [...(out.get(k) ?? []), r.status ?? 'unknown']);
  }
  return out;
}

interface ChargeAgg { count: number; paid: Record<string, number> }

function chargeAggregates(db: Database.Database, orgId: string): Map<string, ChargeAgg> {
  const rows = db.prepare(`
    SELECT account_id, customer_id, currency,
           SUM(status = 'succeeded') AS ok_count,
           SUM(CASE WHEN status = 'succeeded'
                    THEN amount - COALESCE(json_extract(raw,'$.amount_refunded'), 0) ELSE 0 END) AS net
    FROM stripe_mirror_objects
    WHERE org_id = ? AND resource = 'charges' AND deleted_at IS NULL AND customer_id IS NOT NULL
    GROUP BY account_id, customer_id, currency`)
    .all(orgId) as { account_id: string; customer_id: string; currency: string | null; ok_count: number; net: number }[];
  const out = new Map<string, ChargeAgg>();
  for (const r of rows) {
    const k = key(r.account_id, r.customer_id);
    const agg = out.get(k) ?? { count: 0, paid: {} };
    agg.count += r.ok_count;
    if (r.currency) agg.paid[r.currency] = (agg.paid[r.currency] ?? 0) + r.net;
    out.set(k, agg);
  }
  return out;
}

/** Every matching customer with derived lifecycle and payment totals (unpaginated). */
export function summarizeCustomers(
  db: Database.Database, orgId: string, f: Pick<CustomerFilters, 'account' | 'q'>,
): CustomerSummary[] {
  const subs = statusesByCustomer(db, orgId, 'subscriptions');
  const schedules = statusesByCustomer(db, orgId, 'schedules');
  const charges = chargeAggregates(db, orgId);
  return selectCustomers(db, orgId, f).map((c) => {
    const k = key(c.account_id, c.stripe_id);
    const agg = charges.get(k) ?? { count: 0, paid: {} };
    const subscriptionStatuses = subs.get(k) ?? [];
    const scheduleStatuses = schedules.get(k) ?? [];
    return {
      accountId: c.account_id, accountName: c.account_name ?? c.account_id, customerId: c.stripe_id,
      name: c.name, email: c.email, created: c.created, subscriptionStatuses, scheduleStatuses,
      lifecycle: classifyCustomer({ subscriptionStatuses, scheduleStatuses, hasSucceededCharge: agg.count > 0 }),
      paymentCount: agg.count, paid: agg.paid,
    };
  });
}

export function listCustomers(db: Database.Database, orgId: string, f: CustomerFilters): CustomerPage {
  const all = summarizeCustomers(db, orgId, f);
  const lifecycleCounts = { all: all.length, current: 0, future: 0, past: 0, none: 0 };
  for (const c of all) lifecycleCounts[c.lifecycle]++;
  const filtered = f.lifecycle && f.lifecycle !== 'all' ? all.filter((c) => c.lifecycle === f.lifecycle) : all;
  return { customers: filtered.slice(f.offset, f.offset + f.limit), total: filtered.length, lifecycleCounts };
}

export interface PaymentRow {
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

export interface PaymentsResult {
  payments: PaymentRow[];
  /** Succeeded charges net of refunds, minor units, keyed by lowercase currency. */
  netPaid: Record<string, number>;
}

function toPayment(raw: Record<string, unknown>): PaymentRow {
  const method = raw.payment_method_details as { type?: string } | null | undefined;
  const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    id: String(raw.id), created: typeof raw.created === 'number' ? raw.created : null,
    amount: Number(raw.amount ?? 0), amountRefunded: Number(raw.amount_refunded ?? 0),
    currency: String(raw.currency ?? ''), status: String(raw.status ?? 'unknown'),
    refunded: raw.refunded === true, description: text(raw.description),
    invoiceId: text(raw.invoice), paymentMethodType: text(method?.type),
    receiptUrl: text(raw.receipt_url), failureMessage: text(raw.failure_message),
  };
}

export function listCustomerPayments(
  db: Database.Database, orgId: string, accountId: string, customerId: string,
): PaymentsResult {
  const rows = db.prepare(`
    SELECT raw FROM stripe_mirror_objects
    WHERE org_id = ? AND account_id = ? AND resource = 'charges' AND customer_id = ? AND deleted_at IS NULL
    ORDER BY created DESC, stripe_id`).all(orgId, accountId, customerId) as { raw: string }[];
  const payments = rows.map((r) => toPayment(JSON.parse(r.raw) as Record<string, unknown>));
  const netPaid: Record<string, number> = {};
  for (const p of payments) {
    if (p.status === 'succeeded') netPaid[p.currency] = (netPaid[p.currency] ?? 0) + p.amount - p.amountRefunded;
  }
  return { payments, netPaid };
}
