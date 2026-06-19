import React, { useState } from 'react';
import { Transaction, FixedAsset } from '../../types';
import { getActiveOrgId, StorageKeys, storage } from '../../services/storageService';
import { getBaseCurrency, formatAmountInDisplay, getAmountInBase, getGstImpactInBase } from '../../services/currencyService';
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
const ASSET_DEPRECIATION_RATES: Record<string, number> = {
  Computer: 40, Furniture: 10, Vehicle: 15, PlantMachinery: 15, Intangible: 25, Other: 10,
};

function getFixedAssetsKey(): StorageKeys {
  const orgId = getActiveOrgId();
  return (orgId ? `${orgId}:${FIXED_ASSETS_KEY}` : FIXED_ASSETS_KEY) as StorageKeys;
}
function getFixedAssetsFromStorage(): FixedAsset[] {
  return storage.get<FixedAsset[]>(getFixedAssetsKey()) ?? [];
}
function saveFixedAssets(assets: FixedAsset[]): void {
  storage.set(getFixedAssetsKey(), assets);
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface BalanceSheetProps {
  transactions: Transaction[];
}

const BalanceSheet: React.FC<BalanceSheetProps> = ({ transactions }) => {
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [fixedAssets, setFixedAssetsState] = useState<FixedAsset[]>(() => {
    try { return getFixedAssetsFromStorage(); } catch { return []; }
  });
  const [newAsset, setNewAsset] = useState<Partial<FixedAsset>>({
    name: '', category: 'Computer', purchaseDate: new Date().toISOString().split('T')[0],
    cost: 0, depreciationRate: 40, accumulated: 0, entity: 'parent',
  });

  const setFixedAssets = (assets: FixedAsset[]) => {
    setFixedAssetsState(assets);
    saveFixedAssets(assets);
  };

  const isCompletedForTotal = (t: { status?: string }) =>
    !t.status || (t.status !== 'Failed' && t.status !== 'Refunded' && t.status !== 'Pending');

  const activeTxns = transactions.filter(t => !t.deleted);

  const stats = activeTxns.filter(isCompletedForTotal).reduce((acc, curr) => {
    const amt = getAmountInBase(curr, baseCurrency);
    const gst = getGstImpactInBase(curr, baseCurrency);
    if (curr.type === 'Income') {
      acc.income += amt;
      const gstOut = curr.gstRate ? amt * curr.gstRate / 100 : (curr.gstImpact ?? 0);
      acc.outwardGst += gstOut;
    } else if (curr.type === 'Purchase') {
      if (curr.category === 'Assets') acc.fixedAssets += amt;
      else acc.purchases += amt;
      if (curr.itcEligible !== false) acc.eligibleItc += gst;
      else acc.blockedItc += gst;
    } else if (curr.type === 'Expense') acc.expenses += amt;
    acc.tdsPayable += curr.tdsAmount ?? 0;
    return acc;
  }, { income: 0, purchases: 0, expenses: 0, fixedAssets: 0, eligibleItc: 0, blockedItc: 0, outwardGst: 0, tdsPayable: 0 });

  const fyLabel = getFYBounds(0).label;
  const annualDep = fixedAssets.reduce((s, a) => s + (a.cost - a.accumulated) * a.depreciationRate / 100, 0);
  const netBlock = fixedAssets.reduce((s, a) => s + a.cost - a.accumulated, 0);
  const gstNetPayable = Math.max(0, stats.outwardGst - stats.eligibleItc);
  const itcReceivable = Math.max(0, stats.eligibleItc - stats.outwardGst);
  const cashAndBank = stats.income - stats.purchases - stats.expenses;
  const totalAssets = netBlock + stats.fixedAssets + cashAndBank + itcReceivable;
  const retainedEarnings = cashAndBank;
  const totalLiabilities = retainedEarnings + gstNetPayable + stats.tdsPayable;

  const downloadReport = () => {
    setIsDownloading(true);
    try {
      const content = `BALANCE SHEET - ${fyLabel} (Amounts in ${baseCurrency})\nGenerated: ${new Date().toLocaleString()}\n\nTotal Assets,${totalAssets}\nRetained Earnings,${retainedEarnings}\nGST Payable,${gstNetPayable}\nTDS Payable,${stats.tdsPayable}\nTotal Liabilities & Equity,${totalLiabilities}`;
      const blob = new Blob([content], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Suez_BalanceSheet_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-200">
        <div>
          <h3 className="font-black text-slate-900 uppercase text-xs tracking-widest">Balance Sheet</h3>
          <p className="text-[10px] text-slate-400 mt-1">{fyLabel} · As of today · All amounts in {displayCurrency}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAssetModal(true)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">+ Add Fixed Asset</button>
          <button onClick={downloadReport} disabled={isDownloading} className="text-[10px] font-black text-indigo-600 uppercase underline">Download CSV</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Assets</h3>
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase">Non-Current Assets</p>
            <div className="flex justify-between text-xs pl-3">
              <span className="text-slate-600">Fixed Assets — Cost</span>
              <span className="font-bold">{formatAmountInDisplay(stats.fixedAssets + fixedAssets.reduce((s,a)=>s+a.cost,0), baseCurrency, displayCurrency)}</span>
            </div>
            <div className="flex justify-between text-xs pl-3">
              <span className="text-slate-600">Less: Accumulated Depreciation (IT Act §32)</span>
              <span className="font-bold text-rose-600">({formatAmountInDisplay(fixedAssets.reduce((s,a)=>s+a.accumulated,0), baseCurrency, displayCurrency)})</span>
            </div>
            <div className="flex justify-between text-xs pl-3 font-bold">
              <span>Net Block</span>
              <span>{formatAmountInDisplay(netBlock + stats.fixedAssets, baseCurrency, displayCurrency)}</span>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-2">Current Assets</p>
            <div className="flex justify-between text-xs pl-3">
              <span className="text-slate-600">Cash & Bank Balances</span>
              <span className="font-bold">{formatAmountInDisplay(Math.max(0, cashAndBank), baseCurrency, displayCurrency)}</span>
            </div>
            <div className="flex justify-between text-xs pl-3">
              <span className="text-slate-600">GST ITC Receivable (eligible, §16)</span>
              <span className="font-bold">{formatAmountInDisplay(itcReceivable, baseCurrency, displayCurrency)}</span>
            </div>
            <div className="flex justify-between text-sm pt-4 border-t border-slate-100 font-black">
              <span className="uppercase">Total Assets</span>
              <span className="text-indigo-600 text-lg">{formatAmountInDisplay(totalAssets, baseCurrency, displayCurrency)}</span>
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Liabilities & Equity</h3>
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase">Equity</p>
            <div className="flex justify-between text-xs pl-3">
              <span className="text-slate-600">Retained Earnings / Partner Capital</span>
              <span className="font-bold">{formatAmountInDisplay(retainedEarnings, baseCurrency, displayCurrency)}</span>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-2">Current Liabilities</p>
            <div className="flex justify-between text-xs pl-3">
              <span className="text-slate-600">GST Payable (output tax − eligible ITC)</span>
              <span className={`font-bold ${gstNetPayable > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatAmountInDisplay(gstNetPayable, baseCurrency, displayCurrency)}</span>
            </div>
            <div className="flex justify-between text-xs pl-3">
              <span className="text-slate-600">TDS Payable (deducted, pending deposit)</span>
              <span className={`font-bold ${stats.tdsPayable > 0 ? 'text-rose-600' : ''}`}>{formatAmountInDisplay(stats.tdsPayable, baseCurrency, displayCurrency)}</span>
            </div>
            <div className="flex justify-between text-xs pl-3">
              <span className="text-slate-500 italic">Sec 17(5) Blocked ITC (non-deductible)</span>
              <span className="font-bold text-amber-600">{formatAmountInDisplay(stats.blockedItc, baseCurrency, displayCurrency)}</span>
            </div>
            <div className="flex justify-between text-sm pt-4 border-t border-slate-100 font-black">
              <span className="uppercase">Total Liabilities & Equity</span>
              <span className="text-indigo-600 text-lg">{formatAmountInDisplay(totalLiabilities, baseCurrency, displayCurrency)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Assets Table */}
      {fixedAssets.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h4 className="font-black text-slate-900 uppercase text-xs tracking-widest">Fixed Assets Register (IT Act §32 — WDV Method)</h4>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Rate %</th>
                <th className="px-4 py-3 text-right">Annual Dep.</th>
                <th className="px-4 py-3 text-right">Accum. Dep.</th>
                <th className="px-4 py-3 text-right">Net Block (WDV)</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {fixedAssets.map(a => {
                const dep = (a.cost - a.accumulated) * a.depreciationRate / 100;
                const wdv = a.cost - a.accumulated;
                return (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-bold">{a.name}</td>
                    <td className="px-4 py-3 text-slate-500">{a.category}</td>
                    <td className="px-4 py-3 text-right">{formatAmountInDisplay(a.cost, baseCurrency, displayCurrency)}</td>
                    <td className="px-4 py-3 text-right">{a.depreciationRate}%</td>
                    <td className="px-4 py-3 text-right text-rose-600">{formatAmountInDisplay(dep, baseCurrency, displayCurrency)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{formatAmountInDisplay(a.accumulated, baseCurrency, displayCurrency)}</td>
                    <td className="px-4 py-3 text-right font-bold text-indigo-600">{formatAmountInDisplay(wdv, baseCurrency, displayCurrency)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        className="text-[10px] px-2 py-1 bg-indigo-50 text-indigo-700 rounded font-bold mr-1"
                        onClick={() => {
                          const dep2 = (a.cost - a.accumulated) * a.depreciationRate / 100;
                          const updated = fixedAssets.map(x => x.id === a.id ? { ...x, accumulated: x.accumulated + dep2 } : x);
                          setFixedAssets(updated);
                        }}
                      >Book Dep.</button>
                      <button
                        className="text-[10px] px-2 py-1 bg-rose-50 text-rose-700 rounded font-bold"
                        onClick={() => {
                          if (!confirm('Remove this asset?')) return;
                          const updated = fixedAssets.filter(x => x.id !== a.id);
                          setFixedAssets(updated);
                        }}
                      >Remove</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-black text-xs">
                <td className="px-4 py-3" colSpan={2}>Total</td>
                <td className="px-4 py-3 text-right">{formatAmountInDisplay(fixedAssets.reduce((s,a)=>s+a.cost,0), baseCurrency, displayCurrency)}</td>
                <td />
                <td className="px-4 py-3 text-right text-rose-600">{formatAmountInDisplay(annualDep, baseCurrency, displayCurrency)}</td>
                <td className="px-4 py-3 text-right">{formatAmountInDisplay(fixedAssets.reduce((s,a)=>s+a.accumulated,0), baseCurrency, displayCurrency)}</td>
                <td className="px-4 py-3 text-right text-indigo-600">{formatAmountInDisplay(netBlock, baseCurrency, displayCurrency)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Fixed Asset Modal */}
      {showAssetModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl space-y-5 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Add Fixed Asset</h3>
              <button onClick={() => setShowAssetModal(false)} className="text-2xl text-slate-400 hover:text-slate-900">×</button>
            </div>
            <p className="text-[10px] text-slate-400">Depreciation computed using IT Act §32 WDV method. Rate auto-fills by category.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Asset Name</label>
                <input type="text" value={newAsset.name ?? ''} onChange={e => setNewAsset({...newAsset, name: e.target.value})} placeholder="e.g. MacBook Pro M3" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Category</label>
                <select value={newAsset.category ?? 'Computer'} onChange={e => setNewAsset({...newAsset, category: e.target.value, depreciationRate: ASSET_DEPRECIATION_RATES[e.target.value] ?? 10})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                  <option value="Computer">Computer / Software (40%)</option>
                  <option value="Furniture">Furniture & Fittings (10%)</option>
                  <option value="Vehicle">Vehicle (15%)</option>
                  <option value="PlantMachinery">Plant & Machinery (15%)</option>
                  <option value="Intangible">Intangible — Patent/Goodwill (25%)</option>
                  <option value="Other">Other (10%)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Depreciation Rate % (WDV)</label>
                <input type="number" step="1" value={newAsset.depreciationRate ?? 40} onChange={e => setNewAsset({...newAsset, depreciationRate: Number(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Purchase Cost ({baseCurrency})</label>
                <input type="number" value={newAsset.cost ?? 0} onChange={e => setNewAsset({...newAsset, cost: Number(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Purchase Date</label>
                <input type="date" value={newAsset.purchaseDate ?? ''} onChange={e => setNewAsset({...newAsset, purchaseDate: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Accumulated Depreciation</label>
                <input type="number" value={newAsset.accumulated ?? 0} onChange={e => setNewAsset({...newAsset, accumulated: Number(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Entity</label>
                <select value={newAsset.entity ?? 'parent'} onChange={e => setNewAsset({...newAsset, entity: e.target.value as 'parent'|'subsidiary'})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                  <option value="parent">Parent (LLP)</option>
                  <option value="subsidiary">Subsidiary (Inc US)</option>
                </select>
              </div>
            </div>
            {(newAsset.cost ?? 0) > 0 && (
              <div className="bg-indigo-50 rounded-xl p-3 text-xs font-bold text-indigo-700">
                Annual depreciation this year: {baseCurrency === 'INR' ? '₹' : '$'}{(((newAsset.cost ?? 0) - (newAsset.accumulated ?? 0)) * (newAsset.depreciationRate ?? 0) / 100).toLocaleString('en-IN', {maximumFractionDigits: 0})}
              </div>
            )}
            <button
              onClick={() => {
                if (!newAsset.name || !newAsset.cost) return;
                const asset: FixedAsset = {
                  id: `FA-${Date.now()}`, name: newAsset.name!, category: newAsset.category || 'Other',
                  purchaseDate: newAsset.purchaseDate || new Date().toISOString().split('T')[0],
                  cost: newAsset.cost!, depreciationRate: newAsset.depreciationRate ?? 10,
                  accumulated: newAsset.accumulated ?? 0, entity: newAsset.entity || 'parent',
                  createdAt: new Date().toISOString(),
                };
                const updated = [...fixedAssets, asset];
                setFixedAssets(updated);
                setShowAssetModal(false);
                setNewAsset({ name: '', category: 'Computer', purchaseDate: new Date().toISOString().split('T')[0], cost: 0, depreciationRate: 40, accumulated: 0, entity: 'parent' });
              }}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl"
            >
              Add to Fixed Asset Register
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BalanceSheet;
