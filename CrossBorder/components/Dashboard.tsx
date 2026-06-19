
import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { ComplianceStatus, Transaction, RevenueCategory } from '../types';
import {
  getTransactions, getRevenueData, getCompanyProfile,
  getStripeOrgConfig, getUIState, setUIState, StorageKeys,
  getTransferPricingData, getPendingTransactions, getFilingTasks,
} from '../services/storageService';
import {
  getBaseCurrency, formatAmount, formatAmountInDisplay,
  getAmountInBase, toDisplayCurrency,
} from '../services/currencyService';
import type { BaseCurrency } from '../services/currencyService';
import { getLastSyncStatus, runStripeSyncForAllAccounts } from '../services/stripeSyncService';
import { computeInvestorPitchMetrics } from '../services/investorPitchMetricsService';
import { useDisplayCurrency } from '../contexts/DisplayCurrencyContext';

interface DashboardProps {
  stripeApiKey: string;
  onConnectClick: () => void;
}

const PIE_COLORS = ['#059669', '#1246D6', '#dc2626'];

type TrendPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function getBucketKey(dateStr: string, period: TrendPeriod): string {
  const d = new Date(dateStr + 'T12:00:00');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (period === 'daily')   return `${y}-${m}-${day}`;
  if (period === 'monthly') return `${y}-${m}`;
  if (period === 'yearly')  return String(y);
  const weekday = d.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  const my = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const md = String(monday.getDate()).padStart(2, '0');
  return `${my}-${mm}-${md}`;
}

function getBucketLabel(bucketKey: string, period: TrendPeriod): string {
  if (period === 'yearly') return bucketKey;
  if (period === 'monthly') {
    const [, m] = bucketKey.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(m, 10) - 1]} ${bucketKey.slice(0, 4)}`;
  }
  if (period === 'daily' || period === 'weekly') {
    const parts = bucketKey.split('-').map((x) => parseInt(x, 10));
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const label  = `${parts[2]} ${months[parts[1] - 1]}`;
    return period === 'weekly' ? `W ${label}` : label;
  }
  return bucketKey;
}

function aggregateRevenueByPeriod(
  transactions: Transaction[],
  period: TrendPeriod,
  accountScope: 'combined' | 'platform' | string,
  baseCurrency: BaseCurrency,
): { name: string; value: number; bucket: string }[] {
  const filtered =
    accountScope === 'combined'  ? transactions
    : accountScope === 'platform'? transactions.filter((t) => !t.stripeAccountId || t.stripeAccountId === '')
    :                              transactions.filter((t) => t.stripeAccountId === accountScope);
  const buckets: Record<string, number> = {};
  for (const tx of filtered) {
    const key = getBucketKey(tx.date, period);
    buckets[key] = (buckets[key] || 0) + getAmountInBase(tx, baseCurrency);
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => ({ name: getBucketLabel(bucket, period), value, bucket }));
}

/* ─── Inline SVG ─────────────────────────────────────────────────────────── */
const Ico: React.FC<{ d: string | string[]; size?: number; style?: React.CSSProperties }> = ({ d, size = 16, style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

/* ─── Small trend arrow ──────────────────────────────────────────────────── */
const TrendBadge: React.FC<{ value: number; suffix?: string }> = ({ value, suffix = '%' }) => {
  if (value === 0) return <span className="kpi-trend flat">→ 0{suffix}</span>;
  return (
    <span className={`kpi-trend ${value > 0 ? 'up' : 'down'}`}>
      {value > 0 ? '↑' : '↓'} {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
};

/* ─── Pill toggle ────────────────────────────────────────────────────────── */
const PillBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}> = ({ active, onClick, children, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    style={{
      padding: '4px 12px',
      borderRadius: 'var(--r-full)',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.03em',
      textTransform: 'uppercase' as const,
      cursor: 'pointer',
      border: active ? '1px solid var(--accent-border)' : '1px solid var(--n-200)',
      background: active ? 'var(--accent-muted)' : 'var(--surface-base)',
      color: active ? 'var(--accent-text)' : 'var(--n-500)',
      transition: 'all 150ms ease',
      whiteSpace: 'nowrap' as const,
      maxWidth: 160,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {children}
  </button>
);

/* ─── Section wrapper ────────────────────────────────────────────────────── */
const Section: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <section>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--n-500)', margin: 0 }}>
        {title}
      </h2>
      {action}
    </div>
    {children}
  </section>
);

/* ═══════════════════════════════════════════════════════════════════════════
   Dashboard Component
═══════════════════════════════════════════════════════════════════════════ */
const Dashboard: React.FC<DashboardProps> = ({ stripeApiKey, onConnectClick }) => {
  const hasSyncedData         = stripeApiKey.startsWith('sk_');
  const baseCurrency          = getBaseCurrency();
  const { displayCurrency }   = useDisplayCurrency();
  const fmt = (amount: number, inBase: boolean) =>
    formatAmountInDisplay(amount, inBase ? baseCurrency : 'USD', displayCurrency);
  const currencySymbol = displayCurrency === 'INR' ? '₹' : '$';

  /* ── State ──────────────────────────────────────────────────────────── */
  const [transactions,        setTransactions]        = useState<Transaction[]>([]);
  const [revenueTransactions, setRevenueTransactions] = useState<Transaction[]>([]);
  const [syncStatus,          setSyncStatus]          = useState(getLastSyncStatus());
  const [isSyncing,           setIsSyncing]           = useState(false);
  const [syncError,           setSyncError]           = useState<string | null>(null);
  const [trendPeriod, setTrendPeriodState]            = useState<TrendPeriod>(
    () => getUIState(StorageKeys.UI_DASHBOARD_TREND_PERIOD, 'monthly' as TrendPeriod)
  );
  const [trendAccount, setTrendAccountState]          = useState<'combined' | 'platform' | string>(
    () => getUIState(StorageKeys.UI_DASHBOARD_TREND_ACCOUNT, 'combined')
  );

  const setTrendPeriod  = (v: TrendPeriod) => { setTrendPeriodState(v);  setUIState(StorageKeys.UI_DASHBOARD_TREND_PERIOD,  v); };
  const setTrendAccount = (v: string)      => { setTrendAccountState(v); setUIState(StorageKeys.UI_DASHBOARD_TREND_ACCOUNT, v); };

  /* ── Data load ──────────────────────────────────────────────────────── */
  const loadData = () => {
    setTransactions(getTransactions());
    setRevenueTransactions(getRevenueData().transactions);
    setSyncStatus(getLastSyncStatus());
  };

  useEffect(() => {
    loadData();
    window.addEventListener('suez_data_updated', loadData);
    return () => window.removeEventListener('suez_data_updated', loadData);
  }, []);

  /* ── Sync ───────────────────────────────────────────────────────────── */
  const handleManualSync = async () => {
    const config = getStripeOrgConfig();
    if (!config.apiKey?.startsWith('sk_')) { onConnectClick(); return; }
    setIsSyncing(true);
    setSyncError(null);
    try {
      const result = await runStripeSyncForAllAccounts();
      setSyncStatus(getLastSyncStatus());
      if (!result.success && result.error) setSyncError(result.error);
      loadData();
    } finally {
      setIsSyncing(false);
    }
  };

  /* ── Computed values ────────────────────────────────────────────────── */
  const completedTransactions = transactions.filter(
    (t) => t.status !== 'Failed' && t.status !== 'Refunded' && t.status !== 'Pending'
  );
  const totalIncome  = completedTransactions.reduce((s, t) => s + (t.type === 'Income' ? getAmountInBase(t, baseCurrency) : 0), 0);
  const totalExpense = completedTransactions.reduce((s, t) => s + ((t.type === 'Expense' || t.type === 'Purchase') ? getAmountInBase(t, baseCurrency) : 0), 0);
  const netWealth    = totalIncome - totalExpense;

  const pitchMetrics = React.useMemo(
    () => computeInvestorPitchMetrics(
      revenueTransactions,
      getStripeOrgConfig().accounts,
      getRevenueData().lastSyncDate,
      transactions,
    ),
    [revenueTransactions, transactions],
  );

  const completedRevenue = revenueTransactions.filter((t) => t.status === 'Completed');

  const revenueByClassification = completedRevenue.reduce(
    (acc, curr) => {
      const amt = getAmountInBase(curr, baseCurrency);
      if      (curr.classification === RevenueCategory.EXPORT)      acc.export   += amt;
      else if (curr.classification === RevenueCategory.DOMESTIC_MOR) acc.domestic += amt;
      else if (curr.classification === RevenueCategory.OIDAR_RISK)  acc.risk     += amt;
      return acc;
    },
    { export: 0, domestic: 0, risk: 0 },
  );

  const monthlyRevenue = completedRevenue.reduce<Record<string, number>>((acc, tx) => {
    const month = tx.date.slice(0, 7);
    acc[month] = (acc[month] || 0) + getAmountInBase(tx, baseCurrency);
    return acc;
  }, {});

  const monthlyData = Object.entries(monthlyRevenue)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => ({ name: getBucketLabel(bucket, 'monthly'), value }));

  const stripeAccounts     = getStripeOrgConfig().accounts;
  const hasPlatformRevenue = completedRevenue.some((t) => !t.stripeAccountId || t.stripeAccountId === '');

  const trendChartData = React.useMemo(
    () => aggregateRevenueByPeriod(completedRevenue, trendPeriod, trendAccount, baseCurrency),
    [completedRevenue, trendPeriod, trendAccount, baseCurrency],
  );

  const pieData = [
    { name: 'Export (US/Global)', value: revenueByClassification.export,   color: PIE_COLORS[0] },
    { name: 'Domestic (MoR)',     value: revenueByClassification.domestic, color: PIE_COLORS[1] },
    { name: 'OIDAR Risk',         value: revenueByClassification.risk,     color: PIE_COLORS[2] },
  ].filter((d) => d.value > 0);

  const wealthByMonth = React.useMemo(() => {
    const byMonth: Record<string, number> = {};
    for (const t of completedTransactions) {
      const month = t.date.slice(0, 7);
      const amt   = getAmountInBase(t, baseCurrency);
      if      (t.type === 'Income')                                byMonth[month] = (byMonth[month] || 0) + amt;
      else if (t.type === 'Expense' || t.type === 'Purchase')     byMonth[month] = (byMonth[month] || 0) - amt;
    }
    const sorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b));
    let cum = 0;
    return sorted.map(([bucket, delta]) => {
      cum += delta;
      return { name: getBucketLabel(bucket, 'monthly'), wealth: cum };
    });
  }, [completedTransactions, baseCurrency]);

  const chartData = wealthByMonth;

  const complianceItems = React.useMemo(() => {
    const tp      = getTransferPricingData();
    const pending = getPendingTransactions();
    // Derive LUT expiry from filing calendar tasks (GST LUT), fallback to FY end
    const nowDate    = new Date();
    const fyEnd      = nowDate.getMonth() >= 3
      ? new Date(nowDate.getFullYear() + 1, 2, 31) // Mar 31 next year
      : new Date(nowDate.getFullYear(), 2, 31);     // Mar 31 this year
    const lutTask    = getFilingTasks().find(t => t.type === 'GST LUT' || t.type?.toLowerCase().includes('lut'));
    const lutExpiry  = lutTask?.dueDate
      ? new Date(lutTask.dueDate).toISOString().split('T')[0]
      : fyEnd.toISOString().split('T')[0];
    const lutOk      = new Date(lutExpiry) > nowDate;
    const lutDaysLeft = Math.ceil((new Date(lutExpiry).getTime() - nowDate.getTime()) / 86_400_000);
    const lutSub     = lutOk
      ? (lutDaysLeft <= 30 ? `Expires in ${lutDaysLeft} days — renew now` : `Valid until ${lutExpiry}`)
      : 'Expired — file renewal immediately';
    const lutStatus  = lutOk
      ? (lutDaysLeft <= 30 ? ComplianceStatus.WARNING : ComplianceStatus.COMPLIANT)
      : ComplianceStatus.CRITICAL;
    // Form 5472: required when there are related-party US transactions → WARNING means action needed
    const form5472Ok = tp && (tp.usRevenue > 0 || tp.usExpenses > 0);
    // ODI: flag for manual review — cannot auto-verify FEMA compliance
    const odiTasks   = getFilingTasks().filter(t => t.type?.toLowerCase().includes('odi') || t.type?.toLowerCase().includes('fema'));
    const odiOverdue = odiTasks.some(t => t.status === 'Overdue');
    const odiPending = odiTasks.some(t => t.status === 'Pending');
    return [
      { label: 'GST LUT',           status: lutStatus, sub: lutSub },
      { label: 'Form 5472',         status: form5472Ok ? ComplianceStatus.WARNING : ComplianceStatus.COMPLIANT, sub: form5472Ok ? 'Related-party activity — file by Apr 15' : 'No related-party activity' },
      { label: 'ODI / FEMA',        status: odiOverdue ? ComplianceStatus.CRITICAL : odiPending ? ComplianceStatus.WARNING : ComplianceStatus.COMPLIANT, sub: odiOverdue ? 'APR overdue — file immediately' : odiPending ? 'Annual return due — check deadline' : 'No overdue ODI filings in calendar' },
      { label: 'Pending Approvals', status: pending.length > 0 ? ComplianceStatus.WARNING : ComplianceStatus.COMPLIANT, sub: pending.length > 0 ? `${pending.length} item(s) awaiting` : 'All clear' },
    ];
  }, [transactions, revenueTransactions]);

  // FY label computed dynamically
  const now = new Date();
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const currentFY = `FY ${fyYear}–${String(fyYear + 1).slice(-2)}`;

  // Filing deadlines: read from FilingCalendar store
  const today = new Date();
  const storedFilingTasks = getFilingTasks();
  const pendingOrOverdueTasks = storedFilingTasks
    .filter((t) => t.status === 'Pending' || t.status === 'Overdue')
    .map((t) => ({
      name: t.type,
      period: t.period,
      due: new Date(t.dueDate),
      status: t.status === 'Overdue' ? 'overdue' : t.status === 'Pending' ? 'pending' : 'in-progress',
      daysLeft: Math.ceil((new Date(t.dueDate).getTime() - today.getTime()) / 86_400_000),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);
  const filings = pendingOrOverdueTasks;

  const companyProfile = getCompanyProfile();

  const exportReportCSV = () => {
    const rows = [
      ['Date','Description','Amount','Currency','Classification','Source','Account'].join(','),
      ...revenueTransactions.map((t) =>
        [t.date, `"${(t.description || '').replace(/"/g,'""')}"`, t.amount, t.currency, t.classification||'', t.source, t.stripeAccountId||''].join(',')
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `Revenue_Analytics_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── Tooltip formatter ──────────────────────────────────────────────── */
  const tickFmt = (v: number) => {
    const d = toDisplayCurrency(v, baseCurrency, displayCurrency);
    return currencySymbol + (d >= 1e5 ? (d/1e5).toFixed(1)+'L' : (d/1000).toFixed(0)+'K');
  };

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════ */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, animation: 'fadeIn 200ms ease forwards' }}>

      {/* ── Page Title Row ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">
            {companyProfile?.projectName || 'CrossBorder Dashboard'}
          </h1>
          <p className="page-subtitle">
            Consolidated financial intelligence · {companyProfile?.parent?.name || 'Indian LLP'} + {companyProfile?.subsidiary?.name || 'US Corp'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          {/* Sync status badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '6px 12px', borderRadius: 'var(--r-md)',
            border: '1px solid var(--n-150)', background: 'var(--surface-base)',
            fontSize: 12, color: 'var(--n-500)',
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: syncStatus.lastSyncAt ? 'var(--success)' : 'var(--n-300)',
              boxShadow: syncStatus.lastSyncAt ? '0 0 6px rgba(5,150,105,0.5)' : 'none',
            }} />
            <span style={{ fontWeight: 500 }}>
              {syncStatus.lastSyncAt
                ? new Date(syncStatus.lastSyncAt).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
                : 'Not synced'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing || !hasSyncedData}
            className="btn btn-primary btn-sm"
            style={{ gap: 6 }}
          >
            {isSyncing
              ? <div className="spinner spinner-sm" style={{ borderTopColor:'#fff', borderColor:'rgba(255,255,255,0.3)' }} />
              : <Ico d="M13 3.5A6 6 0 112.5 8M2 3.5V8H6.5" size={13} />
            }
            {isSyncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* ── Sync error alert ───────────────────────────────────────────── */}
      {syncError && (
        <div className="alert danger" style={{ fontSize: 13 }}>
          <Ico d="M8 5v3M8 11v1" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div><strong>Sync failed:</strong> {syncError}</div>
        </div>
      )}

      {/* ── Entity Health Strip ────────────────────────────────────────── */}
      <Section title="Entity Status">
        <div className="grid-2">
          {/* India LLP */}
          <div className="entity-card india">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span className="badge india-tag" style={{ fontSize: 11 }}>🇮🇳 India · LLP</span>
              <span className="badge success" style={{ marginLeft: 'auto' }}>Active</span>
            </div>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--n-900)', fontFamily:'var(--font-mono)', letterSpacing:'-0.02em', marginBottom: 4 }}>
              {fmt(totalIncome, true)}
            </p>
            <p style={{ fontSize: 11, color: 'var(--n-400)', fontWeight: 500, marginBottom: 12 }}>Total income (base currency)</p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--n-400)', marginBottom: 2 }}>GSTIN</div>
                <div style={{ fontSize: 12, fontWeight: 600, color:'var(--n-700)', fontFamily:'var(--font-mono)' }}>
                  {companyProfile?.parent?.taxId || '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--n-400)', marginBottom: 2 }}>State</div>
                <div style={{ fontSize: 12, fontWeight: 600, color:'var(--n-700)' }}>
                  {companyProfile?.parent?.state || 'Maharashtra'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--n-400)', marginBottom: 2 }}>GST LUT</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: new Date('2026-03-31') > today ? 'var(--success-text)' : 'var(--danger-text)' }}>
                  {new Date('2026-03-31') > today ? 'Valid until Mar 31' : 'Expired'}
                </div>
              </div>
            </div>
          </div>

          {/* US Corp */}
          <div className="entity-card us">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span className="badge us-tag" style={{ fontSize: 11 }}>🇺🇸 United States · Corp</span>
              <span className="badge success" style={{ marginLeft: 'auto' }}>Active</span>
            </div>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--n-900)', fontFamily:'var(--font-mono)', letterSpacing:'-0.02em', marginBottom: 4 }}>
              {fmt(pitchMetrics.grossRevenue, true)}
            </p>
            <p style={{ fontSize: 11, color: 'var(--n-400)', fontWeight: 500, marginBottom: 12 }}>Gross Stripe revenue</p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--n-400)', marginBottom: 2 }}>EIN / State</div>
                <div style={{ fontSize: 12, fontWeight: 600, color:'var(--n-700)', fontFamily:'var(--font-mono)' }}>
                  {companyProfile?.subsidiary?.taxId || '—'} · {companyProfile?.subsidiary?.state || 'Delaware'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--n-400)', marginBottom: 2 }}>Form 5472</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning-text)' }}>
                  Due Apr 15, 2026
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── KPI Command Strip ──────────────────────────────────────────── */}
      <Section title="Key Performance Indicators">
        <div className="grid-kpi">
          {/* Gross Revenue */}
          <div className="kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <p className="kpi-label">Gross Revenue</p>
              <div className="kpi-icon" style={{ background: 'var(--success-bg)' }}>
                <Ico d="M2 12l4-4 3 3 5-7" size={16} style={{ color: 'var(--success)' }} />
              </div>
            </div>
            <p className="kpi-value">{fmt(pitchMetrics.grossRevenue, true)}</p>
            <p className="kpi-subvalue">After refunds: {fmt(pitchMetrics.netRevenue, true)}</p>
            <TrendBadge value={pitchMetrics.revenueGrowthPct} />
          </div>

          {/* Gross Profit */}
          <div className="kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <p className="kpi-label">Gross Profit</p>
              <div className="kpi-icon" style={{ background: 'var(--accent-muted)' }}>
                <Ico d={['M2 14V8l6-6 6 6v6H2z', 'M6 14V10h4v4']} size={16} style={{ color: 'var(--accent)' }} />
              </div>
            </div>
            <p className="kpi-value">{fmt(pitchMetrics.grossProfit, true)}</p>
            <p className="kpi-subvalue">Revenue minus purchases</p>
          </div>

          {/* Net Profit */}
          <div className="kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <p className="kpi-label">Net Profit</p>
              <div className="kpi-icon" style={{ background: pitchMetrics.netProfit >= 0 ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
                <Ico d="M8 2v12M5 5h4.5a2 2 0 010 4H5" size={16} style={{ color: pitchMetrics.netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }} />
              </div>
            </div>
            <p className="kpi-value" style={{ color: pitchMetrics.netProfit < 0 ? 'var(--danger)' : undefined }}>
              {fmt(pitchMetrics.netProfit, true)}
            </p>
            <p className="kpi-subvalue">Revenue minus all expenses</p>
          </div>

          {/* Global Net Wealth */}
          <div className="kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <p className="kpi-label">Net Wealth</p>
              <div className="kpi-icon" style={{ background: 'var(--india-50)' }}>
                <Ico d={['M8 2a6 6 0 100 12A6 6 0 008 2z', 'M2 8h12']} size={16} style={{ color: 'var(--india-600)' }} />
              </div>
            </div>
            <p className="kpi-value">{fmt(netWealth, true)}</p>
            <p className="kpi-subvalue">Combined US & India assets</p>
          </div>

          {/* Paid Subscribers */}
          <div className="kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <p className="kpi-label">Paid Subscribers</p>
              <div className="kpi-icon" style={{ background: 'var(--n-100)' }}>
                <Ico d={['M8 2a3 3 0 100 6 3 3 0 000-6z', 'M2 14c0-3 2.7-5 6-5s6 2 6 5']} size={16} style={{ color: 'var(--n-500)' }} />
              </div>
            </div>
            <p className="kpi-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 26 }}>{pitchMetrics.paidSubscriberCount.toLocaleString()}</p>
            <p className="kpi-subvalue">Paying customers</p>
            <TrendBadge value={pitchMetrics.paidSubscriberGrowthPct} />
          </div>

          {/* Free Subscribers */}
          <div className="kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <p className="kpi-label">Free Subscribers</p>
              <div className="kpi-icon" style={{ background: 'var(--n-100)' }}>
                <Ico d={['M4 2h8l2 2v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z', 'M6 7h4M6 10h2']} size={16} style={{ color: 'var(--n-400)' }} />
              </div>
            </div>
            <p className="kpi-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 26 }}>{pitchMetrics.freeSubscriberCount.toLocaleString()}</p>
            <p className="kpi-subvalue">Free tier users</p>
            <TrendBadge value={pitchMetrics.freeSubscriberGrowthPct} />
          </div>
        </div>
      </Section>

      {/* ── Compliance & Filings ───────────────────────────────────────── */}
      <div className="grid-2">
        {/* Traffic Lights */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-header-title">Compliance Status</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {complianceItems.map((item, idx) => {
                const isGreen = item.status === ComplianceStatus.COMPLIANT;
                const isAmber = item.status === ComplianceStatus.WARNING;
                return (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 12px', borderRadius: 'var(--r-md)',
                    background: isGreen ? 'transparent' : isAmber ? 'var(--warning-bg)' : 'var(--danger-bg)',
                    border: `1px solid ${isGreen ? 'var(--n-100)' : isAmber ? 'var(--warning-border)' : 'var(--danger-border)'}`,
                  }}>
                    <span style={{
                      width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                      background: isGreen ? 'var(--success)' : isAmber ? 'var(--warning)' : 'var(--danger)',
                      boxShadow: `0 0 7px ${isGreen ? 'rgba(5,150,105,0.5)' : isAmber ? 'rgba(217,119,6,0.5)' : 'rgba(220,38,38,0.5)'}`,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n-800)' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--n-400)', marginTop: 1 }}>{item.sub}</div>
                    </div>
                    <span className={`compliance-pill ${isGreen ? 'green' : isAmber ? 'amber' : 'red'}`}>
                      {isGreen ? 'OK' : isAmber ? 'Review' : 'Action'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Filing Countdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-header-title">Upcoming Filing Deadlines</h3>
            <span className="badge neutral">{currentFY}</span>
          </div>
          <div className="card-body">
            {filings.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--n-400)', padding: '8px 0' }}>
                No filing tasks. Visit Filing Calendar to set up deadlines.
              </p>
            ) : (
              filings.map((f, idx) => {
                const critical = f.daysLeft <= 14;
                const warning  = f.daysLeft <= 45 && f.daysLeft > 14;
                return (
                  <div key={idx} className="filing-row">
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 44 }}>
                      <div className={`filing-days ${critical ? 'critical' : warning ? 'warning' : 'safe'}`}>
                        {f.daysLeft < 0 ? 'OVR' : f.daysLeft}
                      </div>
                      <div className="filing-days-unit">{f.daysLeft < 0 ? 'overdue' : 'days'}</div>
                    </div>
                    <div className="filing-info">
                      <div className="filing-name">{f.name}</div>
                      <div className="filing-period">{f.period} · Due {f.due.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</div>
                    </div>
                    <span className={`filing-status`}>
                      <span className={`filing-dot ${f.status}`} />
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Revenue Analytics ──────────────────────────────────────────── */}
      <Section title="Revenue Analytics">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Monthly bar chart */}
          {monthlyData.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-header-title">Monthly Revenue ({displayCurrency})</h3>
                <span className="badge neutral">{monthlyData.length} months</span>
              </div>
              <div className="card-body" style={{ padding: '12px 20px 16px' }}>
                <ResponsiveContainer width="100%" height={200} minWidth={0}>
                  <BarChart data={monthlyData} barSize={22}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      formatter={(v: number) => [fmt(v, true), 'Revenue']}
                      contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid var(--n-150)' }}
                    />
                    <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Revenue classification cards */}
          <div className="grid-3">
            <div className="kpi-card" style={{ borderTop: '3px solid var(--success)' }}>
              <p className="kpi-label">Export Revenue</p>
              <p className="kpi-value" style={{ fontSize: 20 }}>{formatAmountInDisplay(revenueByClassification.export, baseCurrency, displayCurrency)}</p>
              <p className="kpi-subvalue">GST 0% · US & Global customers</p>
              <span className="badge success" style={{ marginTop: 8 }}>GST Exempt</span>
            </div>
            <div className="kpi-card" style={{ borderTop: '3px solid var(--accent)' }}>
              <p className="kpi-label">Domestic (MoR)</p>
              <p className="kpi-value" style={{ fontSize: 20 }}>{formatAmountInDisplay(revenueByClassification.domestic, baseCurrency, displayCurrency)}</p>
              <p className="kpi-subvalue">Tax handled by Merchant of Record</p>
              <span className="badge accent" style={{ marginTop: 8 }}>MoR Handled</span>
            </div>
            <div className="kpi-card" style={{ borderTop: `3px solid ${revenueByClassification.risk > 0 ? 'var(--danger)' : 'var(--n-300)'}` }}>
              <p className="kpi-label">OIDAR GST Exposure</p>
              <p className="kpi-value" style={{ fontSize: 20, color: revenueByClassification.risk > 0 ? 'var(--danger)' : undefined }}>
                {formatAmountInDisplay(revenueByClassification.risk, baseCurrency, displayCurrency)}
              </p>
              <p className="kpi-subvalue">18% GST liability if unregistered</p>
              <span className={`badge ${revenueByClassification.risk > 0 ? 'danger' : 'success'}`} style={{ marginTop: 8 }}>
                {revenueByClassification.risk > 0 ? 'Review Required' : 'No Exposure'}
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Revenue Trend ──────────────────────────────────────────────── */}
      <Section title="Revenue Trends">
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
            <h3 className="card-header-title" style={{ flex: '1 1 auto' }}>
              Revenue · {trendAccount === 'combined' ? 'All accounts' : trendAccount === 'platform' ? 'Platform' : (stripeAccounts.find((a) => a.id === trendAccount)?.name || trendAccount)} · {displayCurrency}
            </h3>

            {/* Period toggles */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--n-400)', marginRight: 2 }}>Period</span>
              {(['daily','weekly','monthly','yearly'] as const).map((p) => (
                <PillBtn key={p} active={trendPeriod === p} onClick={() => setTrendPeriod(p)}>{p}</PillBtn>
              ))}
            </div>

            {/* Scope toggles */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--n-400)', marginRight: 2 }}>Scope</span>
              <PillBtn active={trendAccount === 'combined'} onClick={() => setTrendAccount('combined')}>Combined</PillBtn>
              {hasPlatformRevenue && (
                <PillBtn active={trendAccount === 'platform'} onClick={() => setTrendAccount('platform')}>Platform</PillBtn>
              )}
              {stripeAccounts.map((acc) => (
                <PillBtn key={acc.id} active={trendAccount === acc.id} onClick={() => setTrendAccount(acc.id)} title={acc.name || acc.id}>
                  {(acc.name || acc.id).slice(0, 14)}{(acc.name || acc.id).length > 14 ? '…' : ''}
                </PillBtn>
              ))}
            </div>
          </div>

          <div className="card-body" style={{ padding: '12px 20px 16px' }}>
            {trendChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220} minWidth={0}>
                <AreaChart data={trendChartData}>
                  <defs>
                    <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(v: number) => [fmt(v, true), 'Revenue']}
                    labelFormatter={(l) => `Period: ${l}`}
                    contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid var(--n-150)' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#trendGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <Ico d="M2 12l4-4 3 3 5-7" size={22} />
                </div>
                <p className="empty-title">No data for this scope</p>
                <p className="empty-desc">Sync from Stripe or select Combined to see data across all accounts.</p>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Net Assets + Revenue Mix ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
        {/* Net Assets Progression */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-header-title">Net Assets Progression ({displayCurrency})</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--n-400)' }}>Live data</span>
            </div>
          </div>
          <div className="card-body" style={{ padding: '12px 20px 16px' }}>
            <ResponsiveContainer width="100%" height={220} minWidth={0}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="wealthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v: number) => [fmt(v, true), 'Net assets']}
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid var(--n-150)' }}
                />
                <Area type="monotone" dataKey="wealth" stroke="var(--accent)" strokeWidth={2.5} fill="url(#wealthGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue Mix pie */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-header-title">Revenue Mix</h3>
          </div>
          <div className="card-body">
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={150} minWidth={0}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={3} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v, true)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {pieData.map((d) => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--n-600)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--n-800)', flexShrink: 0 }}>{fmt(d.value, true)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state" style={{ padding: '24px 8px' }}>
                <p className="empty-desc">Sync revenue to see breakdown.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Future Projections ─────────────────────────────────────────── */}
      {pitchMetrics.futureProjections.length > 0 && (
        <Section title="Forward Projections (6 Months)">
          <div className="card">
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
                {pitchMetrics.futureProjections.map((proj) => (
                  <div key={proj.month} className="card-inset" style={{ padding: '12px 14px' }}>
                    <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--n-400)', marginBottom: 6 }}>{proj.label}</p>
                    <p style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--n-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmt(proj.projectedRevenue, true)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ── Reporting & Export ─────────────────────────────────────────── */}
      <Section title="Reporting & Export">
        <div className="card">
          <div className="card-header">
            <h3 className="card-header-title">Export Data</h3>
            <button
              type="button"
              onClick={exportReportCSV}
              disabled={revenueTransactions.length === 0}
              className="btn btn-secondary btn-sm"
              style={{ gap: 6 }}
            >
              <Ico d={['M8 2v10', 'M4 8l4 4 4-4', 'M2 13v1a1 1 0 001 1h10a1 1 0 001-1v-1']} size={13} />
              Export CSV
            </button>
          </div>
          <div className="card-body">
            <div className="grid-2" style={{ gap: 12 }}>
              {/* Stripe summary */}
              <div className="card-inset" style={{ padding: '14px 16px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--n-500)', marginBottom: 6 }}>
                  Stripe Revenue Summary
                </p>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--n-800)', marginBottom: 4 }}>
                  {completedRevenue.length.toLocaleString()} transactions · Total:{' '}
                  {fmt(completedRevenue.reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0), true)}
                </p>
                <p style={{ fontSize: 11, color: 'var(--n-400)' }}>
                  Stored locally in browser. Daily auto-sync keeps it fresh.
                </p>
              </div>

              {/* Sync info */}
              <div style={{ padding: '14px 16px', borderRadius: 'var(--r-md)', background: 'var(--accent-muted)', border: '1px solid var(--accent-border)' }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent-text)', marginBottom: 6 }}>
                  Sync Schedule
                </p>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-text)', marginBottom: 4 }}>
                  {syncStatus.lastSyncAt
                    ? new Date(syncStatus.lastSyncAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                    : 'No sync yet.'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--brand-700)' }}>
                  Auto-sync runs daily. Use Sync Now for an immediate refresh.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

    </div>
  );
};

export default Dashboard;
