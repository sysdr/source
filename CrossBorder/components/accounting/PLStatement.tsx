import React, { useState } from 'react';
import { Transaction, FixedAsset } from '../../types';
import { getActiveOrgId, StorageKeys, storage } from '../../services/storageService';
import { getBaseCurrency, formatAmountInDisplay, getAmountInBase } from '../../services/currencyService';
import { useDisplayCurrency } from '../../contexts/DisplayCurrencyContext';

// ─── Indian FY helpers ────────────────────────────────────────────────────────
const getFYBounds = (offset = 0): { start: Date; end: Date; label: string } => {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyYear = year + offset;
  return {
    start: new Date(fyYear, 3, 1),
    end: new Date(fyYear + 1, 2, 31),
    label: `FY ${fyYear}-${String(fyYear + 1).slice(-2)}`,
  };
};

// ─── Fixed Assets helpers ─────────────────────────────────────────────────────
const FIXED_ASSETS_KEY = 'suez_fixed_assets';

function getFixedAssetsKey(): StorageKeys {
  const orgId = getActiveOrgId();
  return (orgId ? `${orgId}:${FIXED_ASSETS_KEY}` : FIXED_ASSETS_KEY) as StorageKeys;
}
function getFixedAssetsFromStorage(): FixedAsset[] {
  return storage.get<FixedAsset[]>(getFixedAssetsKey()) ?? [];
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface PLStatementProps {
  transactions: Transaction[];
}

const PLStatement: React.FC<PLStatementProps> = ({ transactions }) => {
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();
  const [plPeriod, setPlPeriod] = useState<'month' | 'quarter' | 'year' | 'this-fy' | 'last-fy' | 'all'>('this-fy');
  const [isDownloading, setIsDownloading] = useState(false);
  const [fixedAssets] = useState<FixedAsset[]>(() => {
    try { return getFixedAssetsFromStorage(); } catch { return []; }
  });

  const isCompletedForTotal = (t: { status?: string }) =>
    !t.status || (t.status !== 'Failed' && t.status !== 'Refunded' && t.status !== 'Pending');

  const activeTxns = transactions.filter(t => !t.deleted);

  const filterByPeriod = (txs: Transaction[]) => {
    if (plPeriod === 'all') return txs;
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();
    if (plPeriod === 'this-fy') {
      const { start, end } = getFYBounds(0);
      return txs.filter((t) => { const d = new Date(t.date + 'T12:00:00'); return d >= start && d <= end; });
    }
    if (plPeriod === 'last-fy') {
      const { start, end } = getFYBounds(-1);
      return txs.filter((t) => { const d = new Date(t.date + 'T12:00:00'); return d >= start && d <= end; });
    }
    return txs.filter((t) => {
      const d = new Date(t.date + 'T12:00:00');
      const y = d.getFullYear();
      const m = d.getMonth();
      if (plPeriod === 'month') return y === thisYear && m === thisMonth;
      if (plPeriod === 'quarter') {
        const q = Math.floor(thisMonth / 3) + 1;
        const tq = Math.floor(m / 3) + 1;
        return y === thisYear && tq === q;
      }
      if (plPeriod === 'year') return y === thisYear;
      return true;
    });
  };

  const filteredForPl = filterByPeriod(activeTxns.filter(isCompletedForTotal));
  const plStats = filteredForPl.reduce((acc, curr) => {
    const amt = getAmountInBase(curr, baseCurrency);
    if (curr.type === 'Income') acc.income += amt;
    else if (curr.type === 'Purchase') acc.purchases += amt;
    else if (curr.type === 'Expense') acc.expenses += amt;
    return acc;
  }, { income: 0, purchases: 0, expenses: 0 });
  const plByCategory = filteredForPl.reduce((acc, curr) => {
    const amt = getAmountInBase(curr, baseCurrency);
    const cat = curr.category || 'Other';
    if (curr.type === 'Income') { acc.income[cat] = (acc.income[cat] || 0) + amt; }
    else if (curr.type === 'Purchase') { acc.purchases[cat] = (acc.purchases[cat] || 0) + amt; }
    else if (curr.type === 'Expense') { acc.expenses[cat] = (acc.expenses[cat] || 0) + amt; }
    return acc;
  }, { income: {} as Record<string, number>, purchases: {} as Record<string, number>, expenses: {} as Record<string, number> });
  const plGrossProfit = plStats.income - plStats.purchases;
  const plNetProfit = plStats.income - plStats.purchases - plStats.expenses;
  const totalDepreciation = fixedAssets.reduce((s, a) => s + (a.cost - a.accumulated) * a.depreciationRate / 100, 0);

  const downloadReport = () => {
    setIsDownloading(true);
    try {
      const content = `P&L REPORT (Amounts in ${baseCurrency})\nGenerated: ${new Date().toLocaleString()}\n\nTotal Revenue,${plStats.income}\nTotal Purchases,${plStats.purchases}\nGross Profit,${plGrossProfit}\nTotal Expenses,${plStats.expenses}\nNet Profit,${plNetProfit}`;
      const blob = new Blob([content], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Suez_PL_Report.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center gap-4">
        <h3 className="font-black text-slate-900 uppercase text-xs tracking-widest">Income Statement (P&amp;L)</h3>
        <select
          value={plPeriod}
          onChange={(e) => setPlPeriod(e.target.value as typeof plPeriod)}
          className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase"
        >
          <option value="this-fy">{getFYBounds(0).label} (Current FY)</option>
          <option value="last-fy">{getFYBounds(-1).label} (Last FY)</option>
          <option value="month">This month</option>
          <option value="quarter">This quarter</option>
          <option value="year">This calendar year</option>
          <option value="all">All time</option>
        </select>
        <button onClick={downloadReport} disabled={isDownloading} className="text-[10px] font-black text-indigo-600 uppercase underline">Export CSV</button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <tbody className="divide-y divide-slate-50">
            <tr><td colSpan={2} className="px-8 py-2 text-[10px] font-black text-slate-400 uppercase">Revenue</td></tr>
            {Object.entries(plByCategory.income).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <tr key={cat}><td className="px-8 py-1 pl-12 text-slate-600 text-xs">{cat}</td><td className="px-8 py-1 text-right font-bold text-slate-900">{formatAmountInDisplay(amt, baseCurrency, displayCurrency)}</td></tr>
            ))}
            <tr><td className="px-8 py-3 text-slate-600 font-bold uppercase text-[10px]">Total Revenue</td><td className="px-8 py-3 text-right font-black text-slate-900">{formatAmountInDisplay(plStats.income, baseCurrency, displayCurrency)}</td></tr>
            <tr><td colSpan={2} className="px-8 py-2 text-[10px] font-black text-slate-400 uppercase">Cost of goods / Purchases</td></tr>
            {Object.entries(plByCategory.purchases).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <tr key={cat}><td className="px-8 py-1 pl-12 text-slate-600 text-xs">{cat}</td><td className="px-8 py-1 text-right font-bold text-rose-600">({formatAmountInDisplay(amt, baseCurrency, displayCurrency)})</td></tr>
            ))}
            <tr><td className="px-8 py-3 text-slate-600 font-bold uppercase text-[10px]">Total Purchases</td><td className="px-8 py-3 text-right font-black text-rose-600">({formatAmountInDisplay(plStats.purchases, baseCurrency, displayCurrency)})</td></tr>
            <tr className="bg-slate-50"><td className="px-8 py-3 font-black text-slate-900 uppercase text-xs">Gross profit</td><td className="px-8 py-3 text-right font-black text-indigo-600">{formatAmountInDisplay(plGrossProfit, baseCurrency, displayCurrency)}</td></tr>
            <tr><td colSpan={2} className="px-8 py-2 text-[10px] font-black text-slate-400 uppercase">Operating expenses</td></tr>
            {Object.entries(plByCategory.expenses).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <tr key={cat}><td className="px-8 py-1 pl-12 text-slate-600 text-xs">{cat}</td><td className="px-8 py-1 text-right font-bold text-rose-600">({formatAmountInDisplay(amt, baseCurrency, displayCurrency)})</td></tr>
            ))}
            <tr><td className="px-8 py-3 text-slate-600 font-bold uppercase text-[10px]">Total Operating expenses</td><td className="px-8 py-3 text-right font-black text-rose-600">({formatAmountInDisplay(plStats.expenses, baseCurrency, displayCurrency)})</td></tr>
            {fixedAssets.length > 0 && (() => {
              const dep = fixedAssets.reduce((s, a) => s + (a.cost - a.accumulated) * a.depreciationRate / 100, 0);
              return (
                <>
                  <tr><td colSpan={2} className="px-8 py-2 text-[10px] font-black text-slate-400 uppercase">Depreciation (IT Act §32 — WDV)</td></tr>
                  {fixedAssets.map(a => {
                    const d = (a.cost - a.accumulated) * a.depreciationRate / 100;
                    return <tr key={a.id}><td className="px-8 py-1 pl-12 text-slate-600 text-xs">{a.name} @ {a.depreciationRate}%</td><td className="px-8 py-1 text-right font-bold text-rose-600">({formatAmountInDisplay(d, baseCurrency, displayCurrency)})</td></tr>;
                  })}
                  <tr><td className="px-8 py-3 text-slate-600 font-bold uppercase text-[10px]">Total Depreciation</td><td className="px-8 py-3 text-right font-black text-rose-600">({formatAmountInDisplay(dep, baseCurrency, displayCurrency)})</td></tr>
                </>
              );
            })()}
            <tr className="bg-slate-900"><td className="px-8 py-4 font-black text-white uppercase text-xs">Net profit (before partner remuneration)</td><td className="px-8 py-4 text-right font-black text-emerald-400">{formatAmountInDisplay(plNetProfit - totalDepreciation, baseCurrency, displayCurrency)}</td></tr>
            <tr className="bg-slate-800"><td className="px-8 py-3 text-slate-300 text-[10px] italic">Partner remuneration (§40(b)) — see Tax Engine for deductible limit</td><td className="px-8 py-3 text-right text-[10px] text-slate-400">—</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PLStatement;
