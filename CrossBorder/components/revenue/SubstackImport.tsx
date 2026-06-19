import React from 'react';
import { Transaction } from '../../types';
import { formatAmountInDisplay } from '../../services/currencyService';
import { useDisplayCurrency } from '../../contexts/DisplayCurrencyContext';
import { getBaseCurrency } from '../../services/currencyService';

interface SubstackImportProps {
  transactions: Transaction[];
  showSubstackManual: boolean;
  setShowSubstackManual: (v: boolean) => void;
  substackManual: { date: string; amount: string; currency: string; description: string; type: 'revenue' | 'commission' | 'charge' };
  setSubstackManual: (v: SubstackImportProps['substackManual']) => void;
  onManualAdd: () => void;
  substackCsv: string;
  setSubstackCsv: (v: string) => void;
  substackImporting: boolean;
  substackImportResult: { added: number; errors: string[] } | null;
  onImportCsv: () => void;
}

const SubstackImport: React.FC<SubstackImportProps> = ({
  transactions,
  showSubstackManual,
  setShowSubstackManual,
  substackManual,
  setSubstackManual,
  onManualAdd,
  substackCsv,
  setSubstackCsv,
  substackImporting,
  substackImportResult,
  onImportCsv,
}) => {
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-emerald-50/50 flex justify-between items-center">
        <h3 className="font-black text-slate-900 uppercase text-xs tracking-widest">Substack actuals</h3>
        <button type="button" onClick={() => setShowSubstackManual(!showSubstackManual)} className="text-xs font-bold text-emerald-700 hover:text-emerald-800">
          {showSubstackManual ? 'Cancel' : '+ Add manual entry'}
        </button>
      </div>
      <div className="p-4 space-y-4">
        {showSubstackManual && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-100">
            <input type="date" value={substackManual.date} onChange={(e) => setSubstackManual({ ...substackManual, date: e.target.value })} className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
            <input type="number" step={0.01} placeholder="Amount" value={substackManual.amount} onChange={(e) => setSubstackManual({ ...substackManual, amount: e.target.value })} className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
            <select value={substackManual.currency} onChange={(e) => setSubstackManual({ ...substackManual, currency: e.target.value })} className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
              <option value="USD">USD</option>
              <option value="INR">INR</option>
            </select>
            <select value={substackManual.type} onChange={(e) => setSubstackManual({ ...substackManual, type: e.target.value as 'revenue' | 'commission' | 'charge' })} className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
              <option value="revenue">Revenue</option>
              <option value="commission">Commission</option>
              <option value="charge">Charge</option>
            </select>
            <input type="text" placeholder="Description" value={substackManual.description} onChange={(e) => setSubstackManual({ ...substackManual, description: e.target.value })} className="px-3 py-2 rounded-lg border text-sm col-span-1 sm:col-span-2 md:col-span-1" style={{ borderColor: 'var(--border-subtle)' }} />
            <div className="col-span-full flex gap-2">
              <button type="button" onClick={onManualAdd} disabled={!substackManual.amount} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold uppercase disabled:opacity-50">Add</button>
            </div>
          </div>
        )}
        <div>
          <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Import CSV (date, amount [, currency] [, description] [, type])</p>
          <textarea value={substackCsv} onChange={(e) => setSubstackCsv(e.target.value)} placeholder="2025-01-15, 1200, USD, January subs, revenue&#10;2025-01-15, 48, USD, Stripe fee, commission" rows={3} className="w-full px-4 py-2 rounded-xl border text-sm font-mono" style={{ borderColor: 'var(--border-subtle)' }} />
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={onImportCsv} disabled={substackImporting || !substackCsv.trim()} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase disabled:opacity-50">
              {substackImporting ? 'Importing…' : 'Import CSV'}
            </button>
            {substackImportResult && <span className="text-xs self-center text-slate-600">Added {substackImportResult.added}. {substackImportResult.errors.length ? substackImportResult.errors.join(' ') : ''}</span>}
          </div>
        </div>
        {transactions.filter((t) => t.source === 'Substack').length > 0 && (
          <div className="overflow-x-auto max-h-48">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-100"><th className="text-left py-2 px-3 font-heading font-semibold text-slate-600">Date</th><th className="text-left py-2 px-3 font-heading font-semibold text-slate-600">Description</th><th className="text-right py-2 px-3 font-heading font-semibold text-slate-600">Amount</th><th className="text-left py-2 px-3 font-heading font-semibold text-slate-600">Type</th></tr></thead>
              <tbody>
                {transactions.filter((t) => t.source === 'Substack').slice(0, 20).map((tx) => (
                  <tr key={tx.id} className="border-t border-slate-100">
                    <td className="py-2 px-3 text-slate-700">{tx.date}</td>
                    <td className="py-2 px-3 text-slate-700">{tx.description}</td>
                    <td className="py-2 px-3 text-right font-medium">{formatAmountInDisplay(tx.amount, tx.currency, displayCurrency)}</td>
                    <td className="py-2 px-3 text-slate-600">{tx.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubstackImport;
