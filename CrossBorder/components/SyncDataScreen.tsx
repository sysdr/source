/**
 * SyncDataScreen – Stripe data sync management & revenue analytics.
 *
 * Design: CrossBorder Design System v3.0
 *   .card          — elevated white panel (replaces inline bg-white/rounded/border)
 *   .kpi-card      — metric tile with label + mono value
 *   .badge         — status pill
 *   .btn / .btn-sm — primary / secondary action buttons
 *   .data-table    — consistent thead/tbody/tr styling
 *   CSS tokens     — var(--brand-*), var(--india-*), var(--us-*), var(--surface-*)
 */

import React, { useState, useEffect } from 'react';
import {
  getRevenueData,
  setRevenueData,
  getStripeOrgConfig,
  getUIState,
  setUIState,
  StorageKeys,
  getActiveOrgId,
  reloadLedgerFromSqlite,
  wipeAllBrowserStorageAndRemoteKv,
} from '../services/storageService';
import { api } from '../services/apiClient';
import {
  runStripeSyncForAllAccounts,
  runStripeSyncForAccount,
  getLastSyncStatus,
  clearStripeSyncCursors,
  computeStripeActualsFromRevenue,
} from '../services/stripeSyncService';
import { formatAmountInDisplay, getBaseCurrency, getAmountInBase } from '../services/currencyService';
import { useDisplayCurrency } from '../contexts/DisplayCurrencyContext';
import { Transaction } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

interface AccountSyncStatus {
  id: string | null;
  name: string;
  dataAvailableSince: string | null;
  transactionCount: number;
  totalAmount: number;
  lastSyncedAt: string | null;
  status: 'synced' | 'pending' | 'never';
  connection: 'connected' | 'not_connected';
  datesWithData: Set<string>;
}

interface DateWiseStatus {
  date: string;
  status: 'synced' | 'pending' | 'partial';
  accountsWithData: number;
  totalAccounts: number;
  amount: number;
}

type RevenuePeriod = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
type ActiveTab = 'sync' | 'revenue';

// ── Small helper components ───────────────────────────────────────────────────

const Spinner: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <span
    className="spinner"
    style={{ width: size, height: size, flexShrink: 0 }}
    aria-hidden="true"
  />
);

const StatusBadge: React.FC<{ status: 'synced' | 'pending' | 'partial' | 'never' }> = ({
  status,
}) => {
  const cls =
    status === 'synced'
      ? 'badge badge-success'
      : status === 'partial'
        ? 'badge badge-warning'
        : 'badge badge-neutral';
  const label = status === 'never' ? 'pending' : status;
  return <span className={cls}>{label}</span>;
};

const ConnectionBadge: React.FC<{ state: 'connected' | 'not_connected' }> = ({ state }) => {
  if (state === 'connected') return <span className="badge badge-success">connected</span>;
  return <span className="badge badge-warning">not connected</span>;
};

const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}> = ({ title, subtitle, action }) => (
  <div
    style={{
      display: 'flex',
      alignItems: action ? 'center' : undefined,
      justifyContent: 'space-between',
      padding: '16px 24px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface-raised)',
      gap: 12,
    }}
  >
    <div>
      <h3
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-primary)',
        }}
      >
        {title}
      </h3>
      {subtitle && (
        <p
          style={{
            margin: '2px 0 0',
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
    {action}
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const SyncDataScreen: React.FC = () => {
  const config = getStripeOrgConfig();
  const revenue = getRevenueData();
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();

  // getAmountInBase expects originalCurrency?: 'INR' | 'USD' but Transaction has string — safe cast helper
  type AmtInput = Parameters<typeof getAmountInBase>[0];
  const txAmt = (t: Transaction): AmtInput => ({
    amount: t.amount,
    currency: t.currency,
    originalAmount: t.originalAmount,
    originalCurrency: t.originalCurrency as 'INR' | 'USD' | undefined,
  });

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [syncSchedule, setSyncSchedule] = useState(getLastSyncStatus());
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [isServerSyncing, setIsServerSyncing] = useState(false);
  const [startDate, setStartDate] = useState(revenue.startDate);
  const [endDate, setEndDate] = useState(revenue.endDate);

  const [activeTab, setActiveTabState] = useState<ActiveTab>(
    () => getUIState(StorageKeys.UI_SYNC_TAB, 'sync' as ActiveTab),
  );
  const [revenuePeriod, setRevenuePeriodState] = useState<RevenuePeriod>(
    () => getUIState(StorageKeys.UI_SYNC_REVENUE_PERIOD, 'monthly' as RevenuePeriod),
  );

  const setActiveTab = (v: ActiveTab) => {
    setActiveTabState(v);
    setUIState(StorageKeys.UI_SYNC_TAB, v);
  };
  const setRevenuePeriod = (v: RevenuePeriod) => {
    setRevenuePeriodState(v);
    setUIState(StorageKeys.UI_SYNC_REVENUE_PERIOD, v);
  };

  const [customFrom, setCustomFrom] = useState(revenue.startDate);
  const [customTo, setCustomTo] = useState(revenue.endDate);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

  const loadData = React.useCallback(() => {
    const rev = getRevenueData();
    setTransactions(rev.transactions);
    setSyncSchedule(getLastSyncStatus());
    setStartDate(rev.startDate);
    setEndDate(rev.endDate);
  }, []);

  useEffect(() => {
    loadData();
    let debounceTimer: ReturnType<typeof setTimeout>;
    const debouncedLoad = () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadData, 150); };
    window.addEventListener('suez_data_updated', debouncedLoad);
    return () => { window.removeEventListener('suez_data_updated', debouncedLoad); clearTimeout(debounceTimer); };
  }, [loadData]);

  useEffect(() => {
    setSelectedPeriod(null);
  }, [revenuePeriod]);

  // ── Account list ──────────────────────────────────────────────────────────

  const accounts = config.accounts;
  const isStandardAccount = config.accountsSource === 'standard';
  /** Matches `runStripeSyncForAllAccounts` / `toFetch`: Connect & org API keys never sync platform-only. */
  const isOrgApiKey = Boolean(config.apiKey?.startsWith('sk_org_'));
  const isConnectScope = config.accountsSource === 'connect' || isOrgApiKey;
  const displayAccounts: { id: string | null; name: string }[] = isStandardAccount
    ? [{ id: null, name: 'Platform' }]
    : accounts.length > 0
      ? isConnectScope
        ? accounts.map((a) => ({ id: a.id, name: a.name || a.id.slice(0, 12) + '...' }))
        : [{ id: null, name: 'Platform' }, ...accounts.map((a) => ({ id: a.id, name: a.name || a.id.slice(0, 12) + '...' }))]
      : [{ id: null, name: 'Platform' }];

  const accountStatuses: AccountSyncStatus[] = React.useMemo(() => displayAccounts.map((acc) => {
    const accTxns = transactions.filter((t) => (t.stripeAccountId || null) === acc.id);
    const dates = new Set<string>(accTxns.map((t) => t.date));
    const earliest =
      accTxns.length > 0
        ? accTxns.reduce((min, t) => (t.date < min ? t.date : min), accTxns[0].date)
        : null;
    const lastSynced =
      accTxns.length > 0
        ? accTxns.reduce(
            (max, t) => (t.lastSyncedAt && t.lastSyncedAt > max ? t.lastSyncedAt : max),
            accTxns[0].lastSyncedAt || '',
          )
        : null;
    const total = accTxns
      .filter((t) => t.status === 'Completed')
      .reduce((s, t) => s + getAmountInBase(txAmt(t), baseCurrency), 0);
    return {
      id: acc.id,
      name: acc.name,
      dataAvailableSince: earliest,
      transactionCount: accTxns.length,
      totalAmount: total,
      lastSyncedAt: lastSynced || syncSchedule.lastSyncAt,
      status: accTxns.length > 0 ? 'synced' : 'pending',
      connection: accTxns.length > 0 ? 'connected' : 'not_connected',
      datesWithData: dates,
    };
  }), [displayAccounts, transactions, baseCurrency, syncSchedule.lastSyncAt]);
  const notConnectedAccounts = accountStatuses.filter((a) => a.connection === 'not_connected');

  // ── Month range helper ────────────────────────────────────────────────────

  const getMonthsInRange = (): string[] => {
    const months: string[] = [];
    const sy = parseInt(startDate.slice(0, 4), 10);
    const sm = parseInt(startDate.slice(5, 7), 10);
    const ey = parseInt(endDate.slice(0, 4), 10);
    const em = parseInt(endDate.slice(5, 7), 10);
    for (let y = sy; y <= ey; y++) {
      const mStart = y === sy ? sm : 1;
      const mEnd = y === ey ? em : 12;
      for (let m = mStart; m <= mEnd; m++) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
      }
    }
    return months;
  };

  const dateWiseStatus: DateWiseStatus[] = getMonthsInRange().map((month) => {
    const monthTxns = transactions.filter((t) => t.date.startsWith(month));
    const accountsWithData = new Set(monthTxns.map((t) => t.stripeAccountId || null)).size;
    const amount = monthTxns
      .filter((t) => t.status === 'Completed')
      .reduce((s, t) => s + getAmountInBase(txAmt(t), baseCurrency), 0);
    const status =
      accountsWithData === displayAccounts.length
        ? 'synced'
        : accountsWithData > 0
          ? 'partial'
          : 'pending';
    return { date: month, status, accountsWithData, totalAccounts: displayAccounts.length, amount };
  });

  // ── Sync handlers ─────────────────────────────────────────────────────────

  const handleSyncAll = async (forceFullSync = false) => {
    if (isSyncingAll || syncingAccountId !== null) return; // guard concurrent syncs
    if (!config.apiKey?.startsWith('sk_')) {
      setError('Configure Stripe in Revenue & Ingestion first.');
      return;
    }
    setIsSyncingAll(true);
    setError(null);
    setSyncStatusMsg(null);
    try {
      const result = await runStripeSyncForAllAccounts({
        onStatus: setSyncStatusMsg,
        forceFullSync,
      });
      if (!result.success && result.error) setError(result.error);
      loadData();
    } finally {
      setIsSyncingAll(false);
      setSyncStatusMsg(null);
    }
  };

  const handleFullSyncAll = () => {
    clearStripeSyncCursors();
    handleSyncAll(true);
  };

  /** Pull every charge Stripe exposes from account inception (~2010) through today into revenue + SQLite. */
  const handleSyncEntireStripeHistory = async () => {
    if (isSyncingAll || syncingAccountId !== null) return;
    if (!config.apiKey?.startsWith('sk_')) {
      setError('Configure Stripe in Revenue & Ingestion first.');
      return;
    }
    setIsSyncingAll(true);
    setError(null);
    setSyncStatusMsg(null);
    try {
      const result = await runStripeSyncForAllAccounts({
        onStatus: setSyncStatusMsg,
        entireHistory: true,
      });
      if (!result.success && result.error) setError(result.error);
      loadData();
    } finally {
      setIsSyncingAll(false);
      setSyncStatusMsg(null);
    }
  };

  /**
   * Purge Stripe rows in SQLite, re-import from Stripe on the server (full history),
   * then replace browser ledger/revenue from the database. Avoids stale or partial browser mapping.
   */
  const handleServerStripeToSqlite = async () => {
    if (isSyncingAll || syncingAccountId !== null || isServerSyncing) return;
    if (!config.apiKey?.startsWith('sk_')) {
      setError('Configure Stripe in Revenue & Ingestion first.');
      return;
    }
    setIsServerSyncing(true);
    setError(null);
    try {
      const orgId = getActiveOrgId() ?? 'default';
      const result = await api.stripeSqliteSync({
        orgId,
        baseCurrency,
        stripeOrgConfig: {
          apiKey: config.apiKey,
          accounts: config.accounts,
          accountsSource: config.accountsSource,
          stripeContextAccountId: config.stripeContextAccountId,
        },
        entireHistory: true,
        purge: 'stripe',
      });
      if (!result.ok && result.error) {
        setError(result.error);
        return;
      }
      clearStripeSyncCursors();
      await reloadLedgerFromSqlite(orgId);
      loadData();
    } catch (e) {
      setError((e as Error).message || 'Server Stripe sync failed');
    } finally {
      setIsServerSyncing(false);
    }
  };

  const handleNuclearBrowserWipe = () => {
    if (!window.confirm(
      'Clear ALL browser storage and the server key-value cache? SQLite transaction tables are NOT deleted. The app will reload.',
    )) return;
    wipeAllBrowserStorageAndRemoteKv();
    window.location.reload();
  };

  const handleSyncAccount = async (accountId: string | null) => {
    if (isSyncingAll || syncingAccountId !== null) return; // guard concurrent syncs
    if (!config.apiKey?.startsWith('sk_')) {
      setError('Configure Stripe in Revenue & Ingestion first.');
      return;
    }
    setSyncingAccountId(accountId ?? 'platform');
    setError(null);
    try {
      const result = await runStripeSyncForAccount(accountId);
      if (!result.success && result.error) setError(result.error);
      loadData();
    } finally {
      setSyncingAccountId(null);
    }
  };

  const hasStripe = Boolean(config.apiKey?.startsWith('sk_'));
  const isAnySync = isSyncingAll || syncingAccountId !== null || isServerSyncing;

  // ── Revenue analytics ─────────────────────────────────────────────────────

  type RevenueRow = { period: string; amount: number; count: number };

  const completedTxns = transactions.filter((t) => t.status === 'Completed');

  const getRevenueByPeriod = (): RevenueRow[] => {
    const filtered = completedTxns.filter((t) =>
      revenuePeriod === 'custom'
        ? t.date >= customFrom && t.date <= customTo
        : t.date >= startDate && t.date <= endDate,
    );

    const bucket = <K extends string>(
      keyFn: (t: Transaction) => K,
      labelFn?: (k: K) => string,
    ): RevenueRow[] => {
      const map: Record<string, { amount: number; count: number }> = {};
      filtered.forEach((t) => {
        const k = keyFn(t);
        if (!map[k]) map[k] = { amount: 0, count: 0 };
        map[k].amount += getAmountInBase(txAmt(t), baseCurrency);
        map[k].count += 1;
      });
      return Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({ period: labelFn ? labelFn(k as K) : k, amount: v.amount, count: v.count }));
    };

    if (revenuePeriod === 'daily') return bucket((t) => t.date);

    if (revenuePeriod === 'weekly')
      return bucket(
        (t) => {
          const d = new Date(t.date + 'T12:00:00');
          const s = new Date(d);
          s.setDate(d.getDate() - d.getDay());
          return s.toISOString().slice(0, 10);
        },
        (k) => `Week of ${k}`,
      );

    if (revenuePeriod === 'monthly') return bucket((t) => t.date.slice(0, 7));

    if (revenuePeriod === 'yearly') return bucket((t) => t.date.slice(0, 4));

    if (revenuePeriod === 'custom') {
      const total = filtered.reduce((s, t) => s + getAmountInBase(txAmt(t), baseCurrency), 0);
      return [{ period: `${customFrom} → ${customTo}`, amount: total, count: filtered.length }];
    }
    return [];
  };

  const revenueRows = getRevenueByPeriod();
  const revenueTotal = revenueRows.reduce((s, r) => s + r.amount, 0);

  const stripeTransactionsInRange = transactions.filter(
    (t) => t.source === 'Stripe' && t.date >= startDate && t.date <= endDate,
  );
  const stripeActuals = computeStripeActualsFromRevenue(stripeTransactionsInRange);
  const monthsInRange = getMonthsInRange().length;
  const stripeMRR = monthsInRange > 0 ? stripeActuals.totalRevenue / monthsInRange : 0;
  const stripeARR = stripeMRR * 12;

  const getTransactionsForPeriod = (period: string): Transaction[] => {
    if (revenuePeriod === 'daily') return completedTxns.filter((t) => t.date === period);
    if (revenuePeriod === 'weekly') {
      const weekStart = period.replace('Week of ', '');
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 6);
      const endStr = end.toISOString().slice(0, 10);
      return completedTxns.filter((t) => t.date >= weekStart && t.date <= endStr);
    }
    if (revenuePeriod === 'monthly') return completedTxns.filter((t) => t.date.startsWith(period));
    if (revenuePeriod === 'yearly') return completedTxns.filter((t) => t.date.startsWith(period));
    if (revenuePeriod === 'custom') {
      const [from, , to] = period.split(' ');
      return completedTxns.filter((t) => t.date >= from && t.date <= to);
    }
    return [];
  };

  const getAccountBreakdownForPeriod = (
    period: string,
  ): { accountId: string | null; accountName: string; amount: number; count: number }[] => {
    const txns = getTransactionsForPeriod(period);
    const byAccount: Record<string, { amount: number; count: number }> = {};
    txns.forEach((t) => {
      const key = t.stripeAccountId ?? '__platform__';
      if (!byAccount[key]) byAccount[key] = { amount: 0, count: 0 };
      byAccount[key].amount += getAmountInBase(txAmt(t), baseCurrency);
      byAccount[key].count += 1;
    });
    return Object.entries(byAccount).map(([key, { amount, count }]) => {
      const accId = key === '__platform__' ? null : key;
      const acc = displayAccounts.find((a) => (a.id ?? '__platform__') === key);
      return {
        accountId: accId,
        accountName: acc?.name ?? (accId ? accId.slice(0, 12) + '...' : 'Platform'),
        amount,
        count,
      };
    });
  };

  // ── Formatting helpers ────────────────────────────────────────────────────

  const fmtAmt = (n: number) => formatAmountInDisplay(n, baseCurrency, displayCurrency);
  const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Data Sync
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Manage Stripe sync state · view data availability by account & period
          </p>
        </div>

        {/* Date range + action buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {/* Date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const v = e.target.value;
                setStartDate(v);
                setRevenueData({ ...getRevenueData(), startDate: v });
              }}
              style={{ border: 'none', background: 'transparent', fontSize: 12, fontWeight: 700, outline: 'none', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>—</span>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                const v = e.target.value;
                setEndDate(v);
                setRevenueData({ ...getRevenueData(), endDate: v });
              }}
              style={{ border: 'none', background: 'transparent', fontSize: 12, fontWeight: 700, outline: 'none', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            />
          </div>

          {/* Sync new */}
          <button
            className="btn"
            onClick={() => handleSyncAll(false)}
            disabled={isAnySync || !hasStripe}
            style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}
            title="Fetch only new charges since last sync"
          >
            {isSyncingAll && <Spinner />}
            {isSyncingAll ? (syncStatusMsg || 'Syncing…') : 'Sync new'}
          </button>

          {/* Full refresh */}
          <button
            className="btn"
            onClick={handleFullSyncAll}
            disabled={isAnySync || !hasStripe}
            title="Re-fetch charges in the selected From–To window (clears cursors)"
            style={{ background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            Full refresh
          </button>

          {/* All Stripe history → DB */}
          <button
            className="btn"
            onClick={handleSyncEntireStripeHistory}
            disabled={isAnySync || !hasStripe}
            title="Fetch all charges from Stripe (from ~2010) through today; merges into ledger and SQLite"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--brand-500)' }}
          >
            {isSyncingAll ? (syncStatusMsg || 'Syncing…') : 'All-time Stripe'}
          </button>
        </div>
      </header>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--error-bg, #fef2f2)', border: '1px solid var(--error-border, #fecaca)', borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--error-text, #991b1b)', fontWeight: 500 }}>
          {error}
        </div>
      )}

      {hasStripe && (
        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid var(--brand-600)' }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
            Direct SQLite import (fixes missing / inconsistent Stripe rows)
          </p>
          <p style={{ margin: '8px 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
            Deletes existing Stripe rows in the database, re-fetches all charges on the API server (Frankfurter FX, same shape as the app), writes into SQLite, then reloads this tab from the server. Ensure the API is running. If you set{' '}
            <code style={{ fontSize: 11 }}>SUEZ_API_KEY</code> on the server, add <code style={{ fontSize: 11 }}>VITE_SUEZ_API_KEY</code> with the same value in <code style={{ fontSize: 11 }}>.env</code>.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={handleServerStripeToSqlite}
              disabled={isAnySync || !hasStripe}
              style={{ background: 'var(--brand-600)', color: '#fff' }}
            >
              {isServerSyncing ? 'Importing…' : 'Stripe → SQLite (server) & reload'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleNuclearBrowserWipe}
              disabled={isAnySync}
              style={{ background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              title="Clears localStorage, sessionStorage, FX hash cache, and server KV store; reloads. SQLite domain tables (transactions) are kept."
            >
              Clear browser cache &amp; KV
            </button>
          </div>
        </div>
      )}

      {/* ── No Stripe notice ─────────────────────────────────────────────── */}
      {!hasStripe && (
        <div className="card" style={{ padding: 24, borderLeft: '4px solid var(--india-500)' }}>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>
            Stripe not configured
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Go to Revenue &amp; Ingestion to add your Stripe API key, then return here to sync.
          </p>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-raised)', padding: 4, borderRadius: 'var(--r-md)', width: 'fit-content', border: '1px solid var(--border)' }}>
        {(['sync', 'revenue'] as ActiveTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '6px 16px',
              borderRadius: 'calc(var(--r-md) - 2px)',
              border: 'none',
              fontWeight: 700,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              transition: 'all 0.15s',
              background: activeTab === t ? 'var(--brand-600)' : 'transparent',
              color: activeTab === t ? '#fff' : 'var(--text-muted)',
            }}
          >
            {t === 'sync' ? 'Sync Status' : 'Revenue'}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          TAB: SYNC STATUS
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'sync' && (
        <>
          {/* ── Stripe metrics strip ─────────────────────────────────────── */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <SectionHeader
              title="Stripe Revenue Metrics"
              subtitle="For selected date range. MRR = net ÷ months in range · ARR = MRR × 12"
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1, padding: 1, background: 'var(--border)' }}>
              {[
                { label: 'Gross Revenue', value: fmtAmt(stripeActuals.totalCharges), accent: false },
                { label: 'Stripe Fees', value: fmtAmt(stripeActuals.totalCommissions), accent: false },
                { label: 'Net Revenue', value: fmtAmt(stripeActuals.totalRevenue), accent: true },
                { label: 'MRR', value: fmtAmt(stripeMRR), accent: false },
                { label: 'ARR', value: fmtAmt(stripeARR), accent: false },
                { label: 'Transactions', value: String(stripeActuals.transactionCount), accent: false },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  style={{
                    padding: '16px 20px',
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {kpi.label}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-mono)', color: kpi.accent ? 'var(--brand-600)' : 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                    {kpi.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Last sync status bar ─────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: syncSchedule.lastSyncAt ? 'var(--success, #10b981)' : 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Last sync:</span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {fmtDate(syncSchedule.lastSyncAt)}
            </span>
            {syncSchedule.nextScheduledAt && (
              <>
                <span style={{ color: 'var(--border)', margin: '0 4px' }}>·</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Next:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {fmtDate(syncSchedule.nextScheduledAt)}
                </span>
              </>
            )}
          </div>

          {/* ── Per-account sync status ──────────────────────────────────── */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <SectionHeader
              title="Account Sync Status"
              subtitle="Per-account transaction coverage and sync controls"
            />
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Connection</th>
                    <th>Data Available Since</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Transactions</th>
                    <th style={{ textAlign: 'right' }}>Total Revenue</th>
                    <th style={{ textAlign: 'right' }}>Last Synced</th>
                    <th style={{ width: 100 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {accountStatuses.map((acc) => {
                    const isSyncingThis = syncingAccountId === (acc.id ?? 'platform');
                    return (
                      <tr key={acc.id ?? 'platform'}>
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{acc.name}</div>
                          {acc.id && (
                            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                              {acc.id}
                            </div>
                          )}
                        </td>
                        <td>
                          <ConnectionBadge state={acc.connection} />
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>
                            {acc.dataAvailableSince || '—'}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={acc.status} />
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {acc.transactionCount.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {fmtAmt(acc.totalAmount)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                          {fmtDate(acc.lastSyncedAt)}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm"
                            onClick={() => handleSyncAccount(acc.id)}
                            disabled={isAnySync || !hasStripe}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                          >
                            {isSyncingThis && <Spinner size={11} />}
                            {isSyncingThis ? 'Syncing…' : 'Fetch'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {notConnectedAccounts.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', background: 'var(--surface-raised)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  Not connected accounts ({notConnectedAccounts.length})
                </span>
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {notConnectedAccounts.map((acc) => (
                    <span key={`nc-${acc.id ?? 'platform'}`} className="badge badge-warning">
                      {acc.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Monthly coverage grid ────────────────────────────────────── */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <SectionHeader
              title="Monthly Coverage"
              subtitle="Synced = every connected account has ≥1 charge that month · Partial = some accounts · Pending = none (scope matches Stripe sync)"
            />
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Status</th>
                    <th>Accounts with Data</th>
                    <th style={{ textAlign: 'right' }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {dateWiseStatus.map((row) => (
                    <tr key={row.date}>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {row.date}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                        {row.accountsWithData} / {row.totalAccounts}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {row.amount > 0 ? fmtAmt(row.amount) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: REVENUE
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'revenue' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <SectionHeader
            title="Revenue by Period"
            subtitle="Aggregated completed Stripe transactions"
            action={
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {(['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setRevenuePeriod(p)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--r-sm)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'capitalize',
                      transition: 'all 0.12s',
                      background: revenuePeriod === p ? 'var(--brand-600)' : 'var(--surface-raised)',
                      color: revenuePeriod === p ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {p}
                  </button>
                ))}
                {revenuePeriod === 'custom' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="form-input"
                      style={{ padding: '4px 8px', width: 'auto', fontSize: 12 }}
                    />
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="form-input"
                      style={{ padding: '4px 8px', width: 'auto', fontSize: 12 }}
                    />
                  </div>
                )}
              </div>
            }
          />

          {/* Revenue table */}
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Transactions</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {revenueRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No revenue data for selected period.
                    </td>
                  </tr>
                ) : (
                  revenueRows.map((row) => {
                    const isSelected = selectedPeriod === row.period;
                    return (
                      <React.Fragment key={row.period}>
                        <tr
                          onClick={() => setSelectedPeriod(isSelected ? null : row.period)}
                          style={{ cursor: 'pointer', background: isSelected ? 'var(--brand-50, #eef2ff)' : undefined }}
                        >
                          <td style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                              {isSelected ? '▼' : '▶'}
                            </span>
                            {row.period}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {row.count.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            {fmtAmt(row.amount)}
                          </td>
                        </tr>
                        {/* Account drill-down */}
                        {isSelected && (
                          <tr style={{ background: 'var(--surface-raised)' }}>
                            <td colSpan={3} style={{ padding: '0 24px 16px' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '12px 0 8px' }}>
                                By account — {row.period}
                              </div>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>Account</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>Txns</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>Revenue</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {getAccountBreakdownForPeriod(row.period).map((acc) => (
                                    <tr key={acc.accountId ?? 'platform'}>
                                      <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--text-primary)' }}>{acc.accountName}</td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{acc.count}</td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmtAmt(acc.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Revenue total footer */}
          {revenueRows.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                Total ({revenueRows.length} period{revenueRows.length !== 1 ? 's' : ''})
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 16, color: 'var(--brand-600)' }}>
                {fmtAmt(revenueTotal)}
              </span>
            </div>
          )}

          {/* Stripe reconciliation panel */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px', background: 'var(--surface-raised)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4 }}>
              Original Currency Reconciliation
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Totals in original charge currency (net of refunds). Compare against Stripe Dashboard → Payments.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {(() => {
                const byCur = completedTxns
                  .filter(
                    (t) =>
                      t.date >= startDate &&
                      t.date <= endDate &&
                      t.originalAmount != null &&
                      t.originalCurrency,
                  )
                  .reduce<Record<string, number>>((acc, t) => {
                    const cur = t.originalCurrency || 'USD';
                    acc[cur] = (acc[cur] || 0) + (t.originalAmount || 0);
                    return acc;
                  }, {});
                const entries = Object.entries(byCur);
                if (entries.length === 0)
                  return (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      No original-currency data for this range.
                    </span>
                  );
                return entries.map(([cur, amt]: [string, number]) => (
                  <div
                    key={cur}
                    style={{ padding: '8px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                      {cur}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
                      {`${cur === 'INR' ? '₹' : cur === 'USD' ? '$' : cur + ' '}${parseFloat(amt.toFixed(2)).toLocaleString()}`}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Info footer ──────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 20px', background: 'var(--brand-900, #1e1b4b)', borderRadius: 'var(--r-lg)', color: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, color: 'rgba(255,255,255,0.6)' }}>
          {activeTab === 'sync' ? 'Sync architecture' : 'Revenue aggregation'}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
          {activeTab === 'sync'
            ? 'Synced data persists in your browser. Incremental sync uses per-account cursors so only new charges are fetched. Full Refresh ignores cursors and re-fetches the entire date range. Auto-sync runs once every 24 h on app load.'
            : 'Revenue aggregates completed Stripe transactions from storage. FX conversion uses historical rates fetched from Frankfurter and cached locally. Use Original Currency Reconciliation to verify totals against the Stripe Dashboard.'}
        </p>
      </div>
    </div>
  );
};

export default SyncDataScreen;
