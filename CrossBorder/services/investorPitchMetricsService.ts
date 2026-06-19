/**
 * Investor Pitch Metrics Service
 * Computes VC-ready metrics from Stripe-synced revenue data.
 * Persists computed metrics so storage only updates when the result changes.
 */

import { Transaction } from '../types';
import { getBaseCurrency, getAmountInBase } from './currencyService';
import type { BaseCurrency } from './currencyService';
import { get as psGet, setIfChanged, PersistentKeys } from './persistentStorage';
import { getActiveOrgId } from './storageService';

export interface FutureProjection {
  month: string;
  label: string;
  projectedRevenue: number;
  projectedMrr: number;
}

export interface InvestorPitchMetrics {
  totalRevenue: number;
  grossRevenue: number;
  netRevenue: number;
  grossProfit: number;
  netProfit: number;
  mrr: number;
  arr: number;
  subscriptionRevenue: number;
  oneTimeRevenue: number;
  revenueGrowthPct: number;
  customerCount: number;
  transactionCount: number;
  avgRevenuePerCustomer: number;
  paidSubscriberCount: number;
  paidSubscriberGrowthPct: number;
  freeSubscriberCount: number;
  freeSubscriberGrowthPct: number;
  futureProjections: FutureProjection[];
  revenueByAccount: { accountId: string; accountName: string; revenue: number; transactionCount: number }[];
  dailyRevenue: { date: string; revenue: number; transactions: number }[];
  monthlyRevenue: { month: string; revenue: number; mrr: number; transactions: number; customerCount: number }[];
  topMonths: { month: string; revenue: number }[];
  currency: BaseCurrency;
  lastSyncAt: string | null;
  dataRange: { start: string; end: string };
}

function getAccountDisplayName(accountId: string | undefined, accounts: { id: string; name?: string }[]): string {
  if (!accountId) return 'Platform';
  const acc = accounts.find((a) => a.id === accountId);
  return acc?.name || (accountId.length > 12 ? `${accountId.slice(0, 8)}...` : accountId);
}

export function computeInvestorPitchMetrics(
  transactions: Transaction[],
  accounts: { id: string; name?: string }[] = [],
  lastSyncAt: string | null = null,
  allLedgerTransactions: Transaction[] = []
): InvestorPitchMetrics {
  const currency = getBaseCurrency();
  const completed = transactions.filter((t) => t.status === 'Completed' && t.type === 'Income');

  const totalRevenue = completed.reduce((s, t) => s + t.amount, 0);
  const grossRevenue = totalRevenue;
  const netRevenue = totalRevenue;

  const subscriptionRevenue = completed.filter((t) =>
    (t.category || '').toLowerCase().includes('subscription') || (t.category || '') === 'Subscription'
  ).reduce((s, t) => s + t.amount, 0);
  const oneTimeRevenue = totalRevenue - subscriptionRevenue;

  // Unique customers (paid subscribers): approximate from description/email patterns
  const customerKeys = new Set(completed.map((t) => t.description?.split('(')[0]?.trim() || t.id).filter(Boolean));
  const customerCount = customerKeys.size || completed.length;
  const paidSubscriberCount = customerCount;

  const avgRevenuePerCustomer = customerCount > 0 ? totalRevenue / customerCount : 0;

  // Monthly breakdown with unique customers per month for subscriber growth
  const byMonth = completed.reduce<Record<string, { revenue: number; count: number; customers: Set<string> }>>((acc, t) => {
    const m = t.date.slice(0, 7);
    const key = t.description?.split('(')[0]?.trim() || t.id;
    if (!acc[m]) acc[m] = { revenue: 0, count: 0, customers: new Set() };
    acc[m].revenue += t.amount;
    acc[m].count += 1;
    if (key) acc[m].customers.add(key);
    return acc;
  }, {});

  const monthlyRevenue = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({
      month,
      revenue: d.revenue,
      mrr: d.revenue,
      transactions: d.count,
      customerCount: d.customers.size,
    }));

  // Paid subscriber growth: last month vs previous month unique customers
  let paidSubscriberGrowthPct = 0;
  if (monthlyRevenue.length >= 2) {
    const last = monthlyRevenue[monthlyRevenue.length - 1].customerCount;
    const prev = monthlyRevenue[monthlyRevenue.length - 2].customerCount;
    if (prev > 0) paidSubscriberGrowthPct = ((last - prev) / prev) * 100;
  }
  const freeSubscriberCount = 0; // Not available from Stripe charges; can be configured separately
  const freeSubscriberGrowthPct = 0;

  // Total expenses from ledger (Expense + Purchase, excluding Income)
  const completedLedger = (allLedgerTransactions || []).filter(
    (t) => t.status !== 'Failed' && t.status !== 'Refunded'
  );
  const totalExpenses = completedLedger.reduce((s, t) => {
    if (t.type === 'Expense' || t.type === 'Purchase') return s + getAmountInBase(t, currency);
    return s;
  }, 0);
  const totalPurchases = completedLedger.reduce((s, t) => {
    if (t.type === 'Purchase') return s + getAmountInBase(t, currency);
    return s;
  }, 0);
  const grossProfit = netRevenue - totalPurchases;
  const netProfit = netRevenue - totalExpenses;

  // MRR = most recent month's revenue (subscription-heavy) or avg of last 3 months
  const recentMonths = monthlyRevenue.slice(-3);
  const mrr =
    recentMonths.length > 0
      ? recentMonths.reduce((s, m) => s + m.revenue, 0) / recentMonths.length
      : subscriptionRevenue > 0
        ? subscriptionRevenue
        : totalRevenue / Math.max(1, monthlyRevenue.length);

  const arr = mrr * 12;

  // Revenue growth: compare last 2 months vs previous 2
  let revenueGrowthPct = 0;
  if (monthlyRevenue.length >= 4) {
    const recent = monthlyRevenue.slice(-2).reduce((s, m) => s + m.revenue, 0);
    const prior = monthlyRevenue.slice(-4, -2).reduce((s, m) => s + m.revenue, 0);
    if (prior > 0) revenueGrowthPct = ((recent - prior) / prior) * 100;
  } else if (monthlyRevenue.length >= 2) {
    const last = monthlyRevenue[monthlyRevenue.length - 1].revenue;
    const prev = monthlyRevenue[monthlyRevenue.length - 2].revenue;
    if (prev > 0) revenueGrowthPct = ((last - prev) / prev) * 100;
  }

  // Revenue by account
  const byAccount = completed.reduce<Record<string, { revenue: number; count: number }>>((acc, t) => {
    const id = t.stripeAccountId || 'platform';
    if (!acc[id]) acc[id] = { revenue: 0, count: 0 };
    acc[id].revenue += t.amount;
    acc[id].count += 1;
    return acc;
  }, {});

  const revenueByAccount = Object.entries(byAccount).map(([accountId, d]) => ({
    accountId,
    accountName: getAccountDisplayName(accountId === 'platform' ? undefined : accountId, accounts),
    revenue: d.revenue,
    transactionCount: d.count,
  }));

  // Daily revenue (last 30 days or all)
  const byDay = completed.reduce<Record<string, { revenue: number; count: number }>>((acc, t) => {
    const d = t.date;
    if (!acc[d]) acc[d] = { revenue: 0, count: 0 };
    acc[d].revenue += t.amount;
    acc[d].count += 1;
    return acc;
  }, {});

  const dailyRevenue = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-60) // last ~60 days
    .map(([date, d]) => ({ date, revenue: d.revenue, transactions: d.count }));

  const topMonths = [...monthlyRevenue].sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  // Future projections: next 6 months using MoM growth rate
  const growthMultiplier = 1 + revenueGrowthPct / 100;
  const lastMonthRevenue = monthlyRevenue.length > 0 ? monthlyRevenue[monthlyRevenue.length - 1].revenue : mrr;
  const futureProjections: FutureProjection[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    const monthStr = d.toISOString().slice(0, 7);
    const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const projectedRevenue = lastMonthRevenue * Math.pow(growthMultiplier, i);
    futureProjections.push({
      month: monthStr,
      label: monthLabel,
      projectedRevenue,
      projectedMrr: projectedRevenue,
    });
  }

  const dates = completed.map((t) => t.date).filter(Boolean);
  const dataRange = {
    start: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : '',
    end: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '',
  };

  return {
    totalRevenue,
    grossRevenue,
    netRevenue,
    grossProfit,
    netProfit,
    mrr,
    arr,
    subscriptionRevenue,
    oneTimeRevenue,
    revenueGrowthPct,
    customerCount,
    transactionCount: completed.length,
    avgRevenuePerCustomer,
    paidSubscriberCount,
    paidSubscriberGrowthPct,
    freeSubscriberCount,
    freeSubscriberGrowthPct,
    futureProjections,
    revenueByAccount,
    dailyRevenue,
    monthlyRevenue,
    topMonths,
    currency,
    lastSyncAt,
    dataRange,
  };
}

/** Persist computed metrics; only writes when the result has changed. */
export function persistInvestorMetrics(metrics: InvestorPitchMetrics): void {
  const orgId = getActiveOrgId();
  if (!orgId) return;
  setIfChanged(PersistentKeys.investorMetrics(orgId), metrics, { namespace: 'calculated' });
}

/** Read persisted investor metrics for the active org, if any. */
export function getPersistedInvestorMetrics(): InvestorPitchMetrics | null {
  const orgId = getActiveOrgId();
  if (!orgId) return null;
  return psGet<InvestorPitchMetrics>(PersistentKeys.investorMetrics(orgId));
}
