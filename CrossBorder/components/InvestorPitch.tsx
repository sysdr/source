/**
 * Investor Pitch Dashboard – VC-ready slide deck with real Stripe metrics.
 * Displays as presentation slides; supports PowerPoint download.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import pptxgen from 'pptxgenjs';
import { getRevenueData, getCompanyProfile, getStripeOrgConfig, getTransactions } from '../services/storageService';
import { getTodayUsdToInrRate } from '../services/currencyService';
import {
  computeInvestorPitchMetrics,
  persistInvestorMetrics,
  type InvestorPitchMetrics,
} from '../services/investorPitchMetricsService';

const SLIDE_COUNT = 9;

/** Investor Pitch always displays in USD */
const formatUsd = (amountUsd: number, compact = false) =>
  `$${amountUsd.toLocaleString('en-US', {
    maximumFractionDigits: 0,
    ...(compact && amountUsd >= 1000 ? { notation: 'compact' as const } : {}),
  })}`;

function toUsd(amount: number, currency: 'USD' | 'INR'): number {
  if (currency === 'USD') return amount;
  return amount / getTodayUsdToInrRate();
}

const InvestorPitch: React.FC = () => {
  const [slideIndex, setSlideIndex] = useState(0);
  const [metrics, setMetrics] = useState<InvestorPitchMetrics | null>(null);

  const loadData = useCallback(() => {
    const revenue = getRevenueData();
    const config = getStripeOrgConfig();
    const computed = computeInvestorPitchMetrics(
      revenue.transactions,
      config.accounts,
      revenue.lastSyncDate,
      getTransactions()
    );
    setMetrics(computed);
    persistInvestorMetrics(computed);
  }, []);

  useEffect(() => {
    loadData();
    window.addEventListener('suez_data_updated', loadData);
    return () => window.removeEventListener('suez_data_updated', loadData);
  }, [loadData]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        setSlideIndex((i) => Math.min(i + 1, SLIDE_COUNT - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSlideIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleDownloadPptx = async () => {
    if (!metrics) return;
    const pptx = new pptxgen();
    const fmt = (n: number) => formatUsd(toUsd(n, metrics.currency));
    const companyName = getCompanyProfile()?.projectName || 'Project Suez';

    pptx.author = companyName;
    pptx.title = `${companyName} – Investor Pitch`;
    pptx.subject = 'Investor Pitch Deck – Real Stripe Metrics';

    // Slide 1: Title
    const s1 = pptx.addSlide();
    s1.background = { color: '0f172a' };
    s1.addText(companyName, {
      x: 0.5,
      y: 1.5,
      w: 9,
      h: 1.2,
      fontSize: 44,
      bold: true,
      color: 'ffffff',
      align: 'center',
    });
    s1.addText('Investor Pitch Deck', {
      x: 0.5,
      y: 2.5,
      w: 9,
      h: 0.6,
      fontSize: 24,
      color: '94a3b8',
      align: 'center',
    });
    s1.addText(`Data as of ${new Date().toLocaleDateString()} • Real numbers from Stripe`, {
      x: 0.5,
      y: 3.2,
      w: 9,
      h: 0.4,
      fontSize: 12,
      color: '64748b',
      align: 'center',
    });

    // Slide 2: Key Metrics
    const s2 = pptx.addSlide();
    s2.background = { color: '0f172a' };
    s2.addText('Key Metrics', {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: 'ffffff',
    });
    s2.addText(`Gross Revenue: ${fmt(metrics.grossRevenue)}  •  Net Revenue: ${fmt(metrics.netRevenue)}  •  Gross Profit: ${fmt(metrics.grossProfit)}  •  Net Profit: ${fmt(metrics.netProfit)}`, {
      x: 0.5,
      y: 1,
      w: 9,
      h: 0.6,
      fontSize: 14,
      color: 'e2e8f0',
    });
    s2.addText(`MRR: ${fmt(metrics.mrr)}  •  ARR: ${fmt(metrics.arr)}  •  Total Revenue: ${fmt(metrics.totalRevenue)}`, {
      x: 0.5,
      y: 1.6,
      w: 9,
      h: 0.5,
      fontSize: 16,
      color: 'e2e8f0',
    });
    s2.addText(
      `Growth: ${metrics.revenueGrowthPct >= 0 ? '+' : ''}${metrics.revenueGrowthPct.toFixed(1)}% MoM  •  Paid subs: ${metrics.paidSubscriberCount} (${metrics.paidSubscriberGrowthPct >= 0 ? '+' : ''}${metrics.paidSubscriberGrowthPct.toFixed(1)}%)  •  Free: ${metrics.freeSubscriberCount}  •  Transactions: ${metrics.transactionCount}`,
      { x: 0.5, y: 2.1, w: 9, h: 0.5, fontSize: 12, color: '94a3b8' }
    );

    // Slide 3: Revenue Mix
    const s3 = pptx.addSlide();
    s3.background = { color: '0f172a' };
    s3.addText('Revenue Breakdown', {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: 'ffffff',
    });
    s3.addText(`Subscription: ${fmt(metrics.subscriptionRevenue)}  •  One-time: ${fmt(metrics.oneTimeRevenue)}`, {
      x: 0.5,
      y: 1,
      w: 9,
      h: 0.5,
      fontSize: 16,
      color: 'e2e8f0',
    });

    // Slide 4: Account-wise
    const s4 = pptx.addSlide();
    s4.background = { color: '0f172a' };
    s4.addText('Revenue by Account', {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: 'ffffff',
    });
    const accRows = [
      ['Account', 'Revenue', 'Transactions'],
      ...metrics.revenueByAccount.map((a) => [a.accountName, fmt(a.revenue), String(a.transactionCount)]),
    ];
    s4.addTable(accRows, {
      x: 0.5,
      y: 1.1,
      w: 9,
      colW: [3, 2.5, 2],
      fontSize: 12,
      color: 'e2e8f0',
      fill: { color: '1e293b' },
      align: 'left',
      border: { type: 'solid', pt: 0.5, color: '334155' },
    });

    // Slide 5: Monthly Trend
    const s5 = pptx.addSlide();
    s5.background = { color: '0f172a' };
    s5.addText('Monthly Revenue Trend', {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: 'ffffff',
    });
    const chartData = metrics.monthlyRevenue.map((m) => ({
      name: m.month,
      value: Math.round(m.revenue * 100) / 100,
    }));
    if (chartData.length > 0) {
      s5.addChart(pptx.ChartType.bar, chartData, {
        x: 0.5,
        y: 1.1,
        w: 9,
        h: 5,
        barDir: 'col',
        chartColors: ['6366f1'],
        showLegend: false,
        catAxisLabelColor: '94a3b8',
        valAxisLabelColor: '94a3b8',
      });
    }

    // Slide 6: Unit Economics
    const s6 = pptx.addSlide();
    s6.background = { color: '0f172a' };
    s6.addText('Unit Economics', {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: 'ffffff',
    });
    s6.addText(`Avg Revenue per Customer: ${fmt(metrics.avgRevenuePerCustomer)}`, {
      x: 0.5,
      y: 1.1,
      w: 9,
      h: 0.5,
      fontSize: 18,
      color: 'e2e8f0',
    });
    s6.addText(`Customer Count: ${metrics.customerCount}  •  Total Transactions: ${metrics.transactionCount}`, {
      x: 0.5,
      y: 1.6,
      w: 9,
      h: 0.5,
      fontSize: 14,
      color: '94a3b8',
    });
    s6.addText(`Data range: ${metrics.dataRange.start} → ${metrics.dataRange.end}`, {
      x: 0.5,
      y: 2.1,
      w: 9,
      h: 0.4,
      fontSize: 12,
      color: '64748b',
    });

    // Slide 7: Future Projections
    const s7proj = pptx.addSlide();
    s7proj.background = { color: '0f172a' };
    s7proj.addText('Future Projections', {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: 'ffffff',
    });
    s7proj.addText('Next 6 months (based on current MoM growth rate)', {
      x: 0.5,
      y: 0.9,
      w: 9,
      h: 0.4,
      fontSize: 14,
      color: '94a3b8',
    });
    if (metrics.futureProjections.length > 0) {
      const projRows = [
        ['Month', 'Projected Revenue'],
        ...metrics.futureProjections.map((p) => [p.label, fmt(p.projectedRevenue)]),
      ];
      s7proj.addTable(projRows, {
        x: 0.5,
        y: 1.5,
        w: 9,
        colW: [3, 4],
        fontSize: 12,
        color: 'e2e8f0',
        fill: { color: '1e293b' },
        align: 'left',
        border: { type: 'solid', pt: 0.5, color: '334155' },
      });
    }

    // Slide 8: Summary & Ask
    const s7 = pptx.addSlide();
    s7.background = { color: '0f172a' };
    s7.addText('Summary', {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: 'ffffff',
    });
    s7.addText(`• ${fmt(metrics.arr)} ARR with ${metrics.revenueGrowthPct >= 0 ? '+' : ''}${metrics.revenueGrowthPct.toFixed(1)}% MoM growth`, {
      x: 0.5,
      y: 1.1,
      w: 9,
      h: 0.5,
      fontSize: 16,
      color: 'e2e8f0',
    });
    s7.addText(`• ${metrics.customerCount} paying customers`, {
      x: 0.5,
      y: 1.6,
      w: 9,
      h: 0.5,
      fontSize: 16,
      color: 'e2e8f0',
    });
    s7.addText(`• Real-time metrics from Stripe • Cross-border financial OS`, {
      x: 0.5,
      y: 2.1,
      w: 9,
      h: 0.5,
      fontSize: 16,
      color: 'e2e8f0',
    });

    pptx.writeFile({ fileName: `${companyName.replace(/\s+/g, '_')}_Investor_Pitch_${new Date().toISOString().slice(0, 10)}.pptx` });
  };

  if (!metrics) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const fmt = (n: number, compact?: boolean) => formatUsd(toUsd(n, metrics.currency), compact);
  const companyName = getCompanyProfile()?.projectName || 'Project Suez';

  const slides = [
    // Slide 0: Title
    <div
      key={0}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/40 to-slate-950 border border-slate-800 shadow-2xl"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      <div className="relative z-10 text-center px-8">
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter uppercase mb-4">{companyName}</h1>
        <p className="text-xl md:text-2xl text-slate-400 font-bold tracking-widest uppercase">Investor Pitch Deck</p>
        <p className="text-sm text-slate-500 mt-6 font-medium">Real numbers from Stripe • {new Date().toLocaleDateString()}</p>
      </div>
    </div>,

    // Slide 1: Key Metrics
    <div
      key={1}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-2xl p-10"
    >
      <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-6">Key Metrics</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1 overflow-auto">
        {[
          { label: 'Gross Revenue', value: fmt(metrics.grossRevenue), sub: 'Total income', accent: 'emerald' },
          { label: 'Net Revenue', value: fmt(metrics.netRevenue), sub: 'After refunds', accent: 'emerald' },
          { label: 'Gross Profit', value: fmt(metrics.grossProfit), sub: 'Revenue − purchases', accent: 'indigo' },
          { label: 'Net Profit', value: fmt(metrics.netProfit), sub: 'Revenue − expenses', accent: 'violet' },
          { label: 'MRR', value: fmt(metrics.mrr), sub: 'Monthly Recurring Revenue', accent: 'emerald' },
          { label: 'ARR', value: fmt(metrics.arr), sub: 'Annual Recurring Revenue', accent: 'indigo' },
          {
            label: 'Revenue Growth',
            value: `${metrics.revenueGrowthPct >= 0 ? '+' : ''}${metrics.revenueGrowthPct.toFixed(1)}%`,
            sub: 'MoM',
            accent: metrics.revenueGrowthPct >= 0 ? 'emerald' : 'rose',
          },
          { label: 'Paid Subs', value: String(metrics.paidSubscriberCount), sub: `${metrics.paidSubscriberGrowthPct >= 0 ? '+' : ''}${metrics.paidSubscriberGrowthPct.toFixed(1)}% MoM`, accent: 'violet' },
          { label: 'Free Subs', value: String(metrics.freeSubscriberCount), sub: `${metrics.freeSubscriberGrowthPct >= 0 ? '+' : ''}${metrics.freeSubscriberGrowthPct.toFixed(1)}% MoM`, accent: 'indigo' },
        ].map((m, i) => (
          <div
            key={i}
            className="rounded-2xl p-4 bg-slate-800/80 border border-slate-700/50 hover:border-slate-600 transition-all"
          >
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{m.label}</p>
            <p className={`text-2xl font-black tracking-tight ${m.accent === 'emerald' ? 'text-emerald-400' : m.accent === 'indigo' ? 'text-indigo-400' : m.accent === 'violet' ? 'text-violet-400' : m.accent === 'rose' ? 'text-rose-400' : 'text-white'}`}>{m.value}</p>
            <p className="text-[10px] text-slate-500 mt-1 font-medium">{m.sub}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-6 mt-4 text-sm flex-shrink-0">
        <span className="text-slate-400 font-bold">Customers: <span className="text-white">{metrics.customerCount}</span></span>
        <span className="text-slate-400 font-bold">Transactions: <span className="text-white">{metrics.transactionCount}</span></span>
      </div>
    </div>,

    // Slide 2: Revenue Mix
    <div
      key={2}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-2xl p-10"
    >
      <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-6">Revenue Breakdown</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">
        <div className="flex flex-col justify-center gap-6">
          <div className="rounded-2xl p-6 bg-slate-800/80 border border-emerald-500/30">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Subscription Revenue</p>
            <p className="text-3xl font-black text-emerald-400">{fmt(metrics.subscriptionRevenue)}</p>
          </div>
          <div className="rounded-2xl p-6 bg-slate-800/80 border border-indigo-500/30">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">One-time Revenue</p>
            <p className="text-3xl font-black text-indigo-400">{fmt(metrics.oneTimeRevenue)}</p>
          </div>
        </div>
        <div className="flex items-center justify-center">
          {metrics.subscriptionRevenue + metrics.oneTimeRevenue > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Subscription', value: metrics.subscriptionRevenue, color: '#10b981' },
                    { name: 'One-time', value: metrics.oneTimeRevenue, color: '#6366f1' },
                  ].filter((d) => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {[
                    { value: metrics.subscriptionRevenue, color: '#10b981' },
                    { value: metrics.oneTimeRevenue, color: '#6366f1' },
                  ]
                    .filter((d) => d.value > 0)
                    .map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-500 text-sm font-medium">No revenue data yet. Sync from Stripe.</p>
          )}
        </div>
      </div>
    </div>,

    // Slide 3: Monthly Trend Chart
    <div
      key={3}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-2xl p-10"
    >
      <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-6">Monthly Revenue Trend</h2>
      <div className="flex-1 min-h-[280px]">
        {metrics.monthlyRevenue.length > 0 ? (
          <ResponsiveContainer width="100%" height={320} minWidth={0}>
            <AreaChart data={metrics.monthlyRevenue.map((m) => ({ ...m, name: m.month, revenue: toUsd(m.revenue, metrics.currency) }))}>
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={11} tickLine={false} tickFormatter={(v) => fmt(v, true)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px' }}
                formatter={(v: number) => fmt(v)}
                labelFormatter={(l) => `Month: ${l}`}
              />
              <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fill="url(#gradRevenue)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500">No monthly data. Sync from Stripe.</div>
        )}
      </div>
    </div>,

    // Slide 4: Revenue by Account
    <div
      key={4}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-2xl p-10"
    >
      <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-6">Revenue by Account</h2>
      <div className="flex-1 overflow-auto">
        {metrics.revenueByAccount.length > 0 ? (
          <div className="space-y-4">
            {metrics.revenueByAccount.map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/50"
              >
                <div>
                  <p className="font-bold text-white">{a.accountName}</p>
                  <p className="text-[10px] text-slate-500 font-medium">{a.transactionCount} transactions</p>
                </div>
                <p className="text-xl font-black text-emerald-400">{fmt(a.revenue)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-sm font-medium">No account breakdown. Sync from Stripe.</p>
        )}
      </div>
    </div>,

    // Slide 5: Daily Revenue (last 30 days)
    <div
      key={5}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-2xl p-10"
    >
      <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-6">Daily Revenue (Last 60 Days)</h2>
      <div className="flex-1 min-h-[280px]">
        {metrics.dailyRevenue.length > 0 ? (
          <ResponsiveContainer width="100%" height={320} minWidth={0}>
            <BarChart data={metrics.dailyRevenue.slice(-30).map((d) => ({ ...d, revenue: toUsd(d.revenue, metrics.currency) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} tickLine={false} tickFormatter={(v) => fmt(v, true)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px' }}
                formatter={(v: number) => fmt(v)}
              />
              <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500">No daily data.</div>
        )}
      </div>
    </div>,

    // Slide 6: Unit Economics
    <div
      key={6}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-2xl p-10"
    >
      <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-8">Unit Economics</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="rounded-2xl p-8 bg-slate-800/80 border border-violet-500/30">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Avg Revenue per Customer</p>
          <p className="text-3xl font-black text-violet-400">{fmt(metrics.avgRevenuePerCustomer)}</p>
        </div>
        <div className="rounded-2xl p-8 bg-slate-800/80 border border-slate-600">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Paying Customers</p>
          <p className="text-3xl font-black text-white">{metrics.customerCount}</p>
        </div>
        <div className="rounded-2xl p-8 bg-slate-800/80 border border-slate-600">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Transactions</p>
          <p className="text-3xl font-black text-white">{metrics.transactionCount}</p>
        </div>
      </div>
      <div className="mt-8 p-4 rounded-xl bg-slate-800/60 border border-slate-700">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Data Range</p>
        <p className="text-sm text-slate-300 font-medium">{metrics.dataRange.start || '—'} → {metrics.dataRange.end || '—'}</p>
        {metrics.lastSyncAt && (
          <p className="text-[10px] text-slate-500 mt-2">Last sync: {new Date(metrics.lastSyncAt).toLocaleString()}</p>
        )}
      </div>
    </div>,

    // Slide 7: Future Projections
    <div
      key={7}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-2xl p-10"
    >
      <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-2">Future Projections</h2>
      <p className="text-slate-400 text-sm font-medium mb-6">Next 6 months (based on current MoM growth rate)</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 flex-1">
        {metrics.futureProjections.map((proj) => (
          <div key={proj.month} className="rounded-2xl p-6 bg-slate-800/80 border border-slate-700/50">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{proj.label}</p>
            <p className="text-2xl font-black text-emerald-400">{fmt(proj.projectedRevenue)}</p>
          </div>
        ))}
      </div>
    </div>,

    // Slide 8: Summary & CTA
    <div
      key={8}
      className="w-full h-[calc(100vh-12rem)] min-h-[500px] rounded-3xl overflow-hidden relative flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/40 to-slate-950 border border-slate-800 shadow-2xl p-10"
    >
      <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="relative z-10 text-center">
        <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-8">Summary</h2>
        <ul className="text-left inline-block space-y-4 text-lg text-slate-300 font-medium">
          <li>• Gross revenue: <span className="text-emerald-400 font-bold">{fmt(metrics.grossRevenue)}</span> • Net profit: <span className="text-violet-400 font-bold">{fmt(metrics.netProfit)}</span></li>
          <li>• <span className="text-emerald-400 font-bold">{fmt(metrics.arr)}</span> ARR with <span className={metrics.revenueGrowthPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{metrics.revenueGrowthPct >= 0 ? '+' : ''}{metrics.revenueGrowthPct.toFixed(1)}%</span> MoM growth</li>
          <li>• <span className="text-white font-bold">{metrics.paidSubscriberCount}</span> paid subscribers ({metrics.paidSubscriberGrowthPct >= 0 ? '+' : ''}{metrics.paidSubscriberGrowthPct.toFixed(1)}% MoM) • <span className="text-white font-bold">{metrics.freeSubscriberCount}</span> free</li>
          <li>• Real-time metrics from Stripe • Cross-border financial OS</li>
        </ul>
        <p className="mt-12 text-slate-500 text-sm font-medium">{companyName} • Data as of {new Date().toLocaleDateString()}</p>
      </div>
    </div>,
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Investor Pitch Deck</h2>
          <p className="text-slate-500 mt-1 font-medium text-sm">VC-ready slides with real Stripe metrics • {companyName}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-4 py-2 shadow-sm">
            {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
              <button
                key={i}
                onClick={() => setSlideIndex(i)}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  slideIndex === i ? 'bg-indigo-600 scale-125' : 'bg-slate-300 hover:bg-slate-400'
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleDownloadPptx}
            className="px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg flex items-center gap-2"
          >
            <span>📥</span> Download .pptx
          </button>
        </div>
      </header>

      <div className="relative">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 shadow-xl">
          {slides[slideIndex]}
        </div>
        <button
          onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
          disabled={slideIndex === 0}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/90 shadow-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-white disabled:opacity-40 disabled:pointer-events-none"
        >
          ←
        </button>
        <button
          onClick={() => setSlideIndex((i) => Math.min(SLIDE_COUNT - 1, i + 1))}
          disabled={slideIndex === SLIDE_COUNT - 1}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/90 shadow-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-white disabled:opacity-40 disabled:pointer-events-none"
        >
          →
        </button>
      </div>

      <p className="text-[10px] text-slate-400 font-medium text-center">Use arrow keys or ← → to navigate</p>
    </div>
  );
};

export default InvestorPitch;
