import React, { useState, useEffect, useCallback } from 'react';
import { Transaction } from '../types';
import {
  getTransactions,
  getRevenueData,
  getStripeOrgConfig,
  getTransferPricingData,
  getCompanyProfile,
} from '../services/storageService';
import {
  getBaseCurrency,
  formatAmountInDisplay,
  getAmountInBase,
  getTodayUsdToInrRate,
} from '../services/currencyService';
import { useDisplayCurrency } from '../contexts/DisplayCurrencyContext';
import { computeInvestorPitchMetrics } from '../services/investorPitchMetricsService';
import {
  computeBalanceFromRevenueTransactions,
  fetchStripePayoutsOnly,
  type StripePayoutItem,
  type RevenueBalanceResult,
} from '../services/stripeSyncService';

const BalanceOverview: React.FC = () => {
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();
  const usdToInr = getTodayUsdToInrRate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [revenueTransactions, setRevenueTransactions] = useState<Transaction[]>([]);
  const [stripePayouts, setStripePayouts] = useState<StripePayoutItem[]>([]);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const loadData = () => {
    setTransactions(getTransactions());
    setRevenueTransactions(getRevenueData().transactions);
  };

  const revenueBalance = React.useMemo((): RevenueBalanceResult | null => {
    if (!getStripeOrgConfig().apiKey?.startsWith('sk_')) return null;
    return computeBalanceFromRevenueTransactions();
  }, [revenueTransactions]);

  const balanceAccountsWithPayouts = React.useMemo(() => {
    if (!revenueBalance) return [];
    const payoutsByAccount = new Map<string | null, StripePayoutItem[]>();
    stripePayouts.forEach((p) => {
      const key = p.accountId ?? null;
      if (!payoutsByAccount.has(key)) payoutsByAccount.set(key, []);
      payoutsByAccount.get(key)!.push(p);
    });
    return revenueBalance.accounts.map((acc) => ({
      ...acc,
      payouts: (payoutsByAccount.get(acc.accountId ?? null) || []).sort((a, b) =>
        (a.arrivalDate || '').localeCompare(b.arrivalDate || '')
      ),
    }));
  }, [revenueBalance, stripePayouts]);

  const loadStripePayouts = useCallback(async () => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_')) {
      setStripePayouts([]);
      return;
    }
    setStripeLoading(true);
    setStripeError(null);
    try {
      const result = await fetchStripePayoutsOnly();
      setStripePayouts(result.payouts ?? []);
      if (result.error) setStripeError(result.error);
    } catch (err: any) {
      setStripeError(err?.message || 'Failed to fetch payouts');
      setStripePayouts([]);
    } finally {
      setStripeLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    window.addEventListener('suez_data_updated', loadData);
    return () => window.removeEventListener('suez_data_updated', loadData);
  }, []);

  useEffect(() => {
    loadStripePayouts();
  }, [loadStripePayouts]);

  const pitchMetrics = React.useMemo(
    () =>
      computeInvestorPitchMetrics(
        revenueTransactions,
        getStripeOrgConfig().accounts,
        getRevenueData().lastSyncDate,
        transactions
      ),
    [revenueTransactions, transactions]
  );

  const completedLedger = transactions.filter(
    (t) => t.status !== 'Failed' && t.status !== 'Refunded'
  );
  const totalIncome = completedLedger.reduce(
    (acc, t) => acc + (t.type === 'Income' ? getAmountInBase(t, baseCurrency) : 0),
    0
  );
  const totalExpense = completedLedger.reduce(
    (acc, t) =>
      acc +
      (t.type === 'Expense' || t.type === 'Purchase' ? getAmountInBase(t, baseCurrency) : 0),
    0
  );
  const currentBalance = totalIncome - totalExpense;

  const tp = getTransferPricingData();
  const usProfit = (tp.usRevenue - tp.usExpenses) * (tp.margin / 100);
  const usaTaxRate = 0.21;
  const usaTaxUsd = Math.max(0, usProfit * usaTaxRate);
  const usaTaxLiabilityInBase =
    baseCurrency === 'INR' ? usaTaxUsd * usdToInr : usaTaxUsd;

  const completedRevenue = revenueTransactions.filter(
    (t) => t.status === 'Completed' && t.type === 'Income'
  );
  const grossRevenueUsd =
    baseCurrency === 'USD'
      ? pitchMetrics.grossRevenue
      : pitchMetrics.grossRevenue / usdToInr;
  const stripeFeePct = 0.029;
  const stripeFeeCents = 30;
  const estimatedStripeFeesUsd =
    grossRevenueUsd * stripeFeePct + completedRevenue.length * (stripeFeeCents / 100);
  const stripeDeductionsInBase =
    baseCurrency === 'INR' ? estimatedStripeFeesUsd * usdToInr : estimatedStripeFeesUsd;

  const stripeAvailableInBase =
    revenueBalance != null ? revenueBalance.balance.availableBase : null;
  const stripePendingInBase =
    revenueBalance != null ? revenueBalance.balance.pendingBase : null;
  const orgName = getCompanyProfile()?.projectName || 'Organisation';
  const hasStripe = getStripeOrgConfig().apiKey?.startsWith('sk_');
  const showBalanceFromPayments = hasStripe && revenueBalance != null;

  const cards = [
    ...(showBalanceFromPayments
      ? [
          {
            label: 'Available to withdraw',
            value: stripeAvailableInBase!,
            sub: 'From received payments (completed)',
            accent: 'emerald' as const,
          },
          {
            label: 'Upcoming balance',
            value: stripePendingInBase!,
            sub: 'From received payments (pending)',
            accent: 'violet' as const,
          },
        ]
      : []),
    {
      label: 'Current balance',
      value: currentBalance,
      sub: 'Ledger net: Income − Expenses',
      accent: 'emerald' as const,
    },
    {
      label: 'Gross revenue',
      value: pitchMetrics.grossRevenue,
      sub: 'Total Stripe revenue (before refunds)',
      accent: 'indigo' as const,
    },
    {
      label: 'Net revenue',
      value: pitchMetrics.netRevenue,
      sub: 'After refunds',
      accent: 'indigo' as const,
    },
    {
      label: 'Stripe deductions',
      value: stripeDeductionsInBase,
      sub: `Est. fees (2.9% + 30¢/txn), ${completedRevenue.length} txns`,
      accent: 'amber' as const,
    },
    {
      label: 'USA tax liability',
      value: usaTaxLiabilityInBase,
      sub: `Est. US federal (21%) on US profit • $${usProfit.toFixed(0)} profit`,
      accent: 'rose' as const,
    },
  ];

  const accentBorder: Record<string, string> = {
    emerald: 'border-t-emerald-500',
    violet: 'border-t-violet-500',
    indigo: 'border-t-indigo-500',
    amber: 'border-t-amber-500',
    rose: 'border-t-rose-500',
  };

  const payoutAmountInBase = (p: StripePayoutItem) => {
    const usd = p.amountCents / 100;
    return baseCurrency === 'INR' ? usd * usdToInr : usd;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
            Balance & revenue
          </h2>
          <p className="text-slate-500 mt-1 font-medium">
            Current balance, revenue, Stripe deductions, and USA tax for {orgName}.
          </p>
        </div>
        {hasStripe && (
          <button
            type="button"
            onClick={() => { loadData(); loadStripePayouts(); }}
            disabled={stripeLoading}
            className="px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 self-start"
          >
            {stripeLoading ? (
              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : null}
            {stripeLoading ? 'Refreshing…' : 'Refresh payouts'}
          </button>
        )}
      </header>

      {stripeError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-800 text-sm font-medium">
          Stripe: {stripeError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c, i) => (
          <div
            key={i}
            className={`bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-t-4 ${accentBorder[c.accent]}`}
          >
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              {c.label}
            </p>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">
              {formatAmountInDisplay(c.value, baseCurrency, displayCurrency)}
            </h3>
            <p className="text-[10px] text-slate-500 mt-2">{c.sub}</p>
          </div>
        ))}
      </div>

      {hasStripe && balanceAccountsWithPayouts.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">
            Balance by account
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {balanceAccountsWithPayouts.map((acc) => (
              <div
                key={acc.accountId ?? 'platform'}
                className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
              >
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 truncate" title={acc.accountName}>
                  {acc.accountName}
                </p>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Available (completed)</p>
                    <p className="text-xl font-black text-emerald-600 tracking-tight">
                      {formatAmountInDisplay(acc.availableBase, baseCurrency, displayCurrency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Pending</p>
                    <p className="text-xl font-black text-violet-600 tracking-tight">
                      {formatAmountInDisplay(acc.pendingBase, baseCurrency, displayCurrency)}
                    </p>
                  </div>
                </div>
                {acc.payouts.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Upcoming payouts</p>
                    <ul className="space-y-1.5">
                      {acc.payouts.slice(0, 3).map((p) => (
                        <li key={p.id} className="flex justify-between text-xs">
                          <span className="text-slate-500">
                            {p.arrivalDate
                              ? new Date(p.arrivalDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                              : '—'}
                          </span>
                          <span className="font-bold text-slate-900">
                            {formatAmountInDisplay(baseCurrency === 'INR' ? (p.amountCents / 100) * usdToInr : p.amountCents / 100, baseCurrency, displayCurrency)}
                          </span>
                        </li>
                      ))}
                      {acc.payouts.length > 3 && (
                        <li className="text-[10px] text-slate-400 font-bold">+{acc.payouts.length - 3} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">
            Upcoming payouts
          </h3>
          {hasStripe && stripeLoading && (
            <span className="text-[10px] font-bold text-slate-400 uppercase">Loading…</span>
          )}
        </div>
        {!hasStripe ? (
          <p className="text-slate-500 text-sm">
            Connect Stripe in Revenue & Ingestion to see available balance and scheduled payouts.
          </p>
        ) : stripePayouts.length === 0 ? (
          <p className="text-slate-500 text-sm">
            No pending payouts. Funds shown as “Available to withdraw” can be paid out from your
            Stripe Dashboard.
          </p>
        ) : (
          <ul className="space-y-3">
            {stripePayouts.map((p) => (
              <li
                key={p.id}
                className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded-xl border border-slate-100"
              >
                <span className="text-xs font-bold text-slate-700">
                  Payout · {p.accountName}
                </span>
                <span className="text-xs font-black text-slate-900">
                  {formatAmountInDisplay(payoutAmountInBase(p), baseCurrency, displayCurrency)}
                  {' · '}
                  {p.arrivalDate
                    ? new Date(p.arrivalDate + 'T12:00:00').toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Summary
          </p>
          <p className="text-sm text-slate-700">
            Available to withdraw and upcoming balance are built from received payments (synced
            revenue). Current balance is from your global ledger. Gross and net revenue come from
            synced Stripe revenue. Stripe deductions are estimated from standard card fees. USA
            tax liability is an estimate based on Transfer Pricing and a 21% federal rate on US profit.
          </p>
        </div>
        <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
          <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-2">
            Data sources
          </p>
          <ul className="text-xs text-indigo-900 space-y-1">
            <li>• Available / upcoming balance: From received payments (Revenue sync)</li>
            <li>• Ledger balance: General ledger (Accounting / Finance)</li>
            <li>• Revenue: Revenue & Ingestion (Stripe sync)</li>
            <li>• USA tax: Transfer Pricing engine (US revenue & margin)</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default BalanceOverview;
