import React from 'react';
import { Transaction, RevenueCategory } from '../../types';
import { formatAmountInDisplay } from '../../services/currencyService';
import { getBaseCurrency } from '../../services/currencyService';
import { useDisplayCurrency } from '../../contexts/DisplayCurrencyContext';
import { getStripeOrgConfig } from '../../services/storageService';
import { removeTransaction } from '../../services/storageService';

interface TransactionListProps {
  transactions: Transaction[];
  lastSyncDate: string | null;
  connectionStatus: 'connected' | 'disconnected';
  onShowSettings: () => void;
  onUpdateTable: (data: Transaction[], persist?: boolean) => void;
}

const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  lastSyncDate,
  connectionStatus,
  onShowSettings,
  onUpdateTable,
}) => {
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();
  const accounts = getStripeOrgConfig().accounts;

  const [selectedAccountFilter, setSelectedAccountFilter] = React.useState<string>('all');

  const getAccountName = (accountId: string | undefined) => {
    if (!accountId) return 'Platform';
    const acc = accounts.find((a) => a.id === accountId);
    return acc?.name || accountId.slice(0, 12) + '...';
  };

  const isCompleted = (t: Transaction) => t.status === 'Completed';

  const baseFiltered =
    selectedAccountFilter === 'all'
      ? transactions
      : transactions.filter((t) => t.stripeAccountId === selectedAccountFilter);
  const completedTxns = baseFiltered.filter(isCompleted);
  const excludedTxns = baseFiltered.filter((t) => !isCompleted(t));

  return (
    <>
      {accounts.length > 1 && (
        <div className="flex gap-2 items-center">
          <span className="text-[10px] font-black text-slate-400 uppercase">Filter by account:</span>
          <select value={selectedAccountFilter} onChange={(e) => setSelectedAccountFilter(e.target.value)} className="text-xs font-bold border border-slate-200 rounded-lg px-3 py-2">
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name || a.id}</option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="font-black text-slate-900 uppercase text-xs tracking-widest">
            {completedTxns.length} Completed (in total) • {excludedTxns.length} Excluded (failed/refunded/incomplete) • {lastSyncDate ? `Last sync: ${new Date(lastSyncDate).toLocaleString()}` : 'Not synced'}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[9px] tracking-widest border-b border-slate-100">
              <tr>
                <th className="px-6 py-4">ID</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Account</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4 text-right">Charge (gross)</th>
                <th className="px-6 py-4 text-right">Commission</th>
                <th className="px-6 py-4 text-right">Revenue (net)</th>
                <th className="px-6 py-4">Region</th>
                <th className="px-6 py-4">Classification</th>
                <th className="px-6 py-4 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {completedTxns.length === 0 && excludedTxns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-24 text-center">
                    <div className="flex flex-col items-center gap-4 opacity-40">
                      <div className="text-4xl">🌍</div>
                      <p className="text-xs font-black uppercase">Fetch data or load saved.</p>
                      {connectionStatus === 'disconnected' && (
                        <button onClick={onShowSettings} className="text-[10px] font-black text-indigo-600 uppercase underline">Configure Stripe</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                completedTxns.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/80">
                    <td className="px-6 py-4 font-mono text-[10px] text-slate-400">{tx.stripeChargeId || tx.id}</td>
                    <td className="px-6 py-4 font-bold text-slate-900">{tx.date}</td>
                    <td className="px-6 py-4"><span className="text-[10px] font-bold text-slate-600 bg-slate-50 px-2 py-0.5 rounded">{getAccountName(tx.stripeAccountId)}</span></td>
                    <td className="px-6 py-4">
                      <span className="font-black text-slate-900 text-[11px] truncate max-w-[200px] block">{tx.description}</span>
                      <span className="text-[9px] text-slate-400">{tx.category}</span>
                    </td>
                    <td className="px-6 py-4 text-right font-black">{formatAmountInDisplay(tx.amount, tx.currency, displayCurrency)}</td>
                    <td className="px-6 py-4 text-right text-slate-600">{tx.source === 'Stripe' && tx.feeAmount != null ? formatAmountInDisplay(tx.feeAmount, tx.currency, displayCurrency) : tx.source === 'Substack' && tx.type === 'Expense' ? formatAmountInDisplay(Math.abs(tx.amount), tx.currency, displayCurrency) : '—'}</td>
                    <td className="px-6 py-4 text-right font-semibold text-indigo-700">{tx.source === 'Stripe' && (tx.netAmount != null || tx.feeAmount != null) ? formatAmountInDisplay(tx.netAmount ?? tx.amount - (tx.feeAmount ?? 0), tx.currency, displayCurrency) : tx.source === 'Substack' && tx.type === 'Income' ? formatAmountInDisplay(tx.amount, tx.currency, displayCurrency) : formatAmountInDisplay(tx.amount, tx.currency, displayCurrency)}</td>
                    <td className="px-6 py-4"><span className="text-[10px] font-black bg-slate-100 px-2 py-0.5 rounded uppercase">{tx.customerLocation}</span></td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase ${
                        tx.classification === RevenueCategory.EXPORT ? 'bg-emerald-50 text-emerald-700' :
                        tx.classification === RevenueCategory.OIDAR_RISK ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {tx.classification}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => {
                          if (!confirm('Delete this transaction from ledger and revenue data?')) return;
                          removeTransaction(tx.id);
                          onUpdateTable(transactions.filter((t) => t.id !== tx.id), false);
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50"
                        title="Delete"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {excludedTxns.length > 0 && (
        <div className="bg-slate-50 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-amber-50/50">
            <h3 className="font-black text-amber-800 uppercase text-xs tracking-widest">
              Failed, Refunded &amp; Incomplete — Not included in totals
            </h3>
            <p className="text-[10px] text-amber-700 mt-0.5">{excludedTxns.length} transaction(s)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-500 font-black uppercase text-[9px] tracking-widest border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">ID</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Account</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {excludedTxns.map((tx) => (
                  <tr key={tx.id} className="hover:bg-amber-50/50">
                    <td className="px-6 py-4 font-mono text-[10px] text-slate-500">{tx.stripeChargeId || tx.id}</td>
                    <td className="px-6 py-4 font-bold text-slate-700">{tx.date}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                        tx.status === 'Failed' ? 'bg-rose-100 text-rose-700' :
                        tx.status === 'Refunded' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-6 py-4"><span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{getAccountName(tx.stripeAccountId)}</span></td>
                    <td className="px-6 py-4">
                      <span className="font-bold text-slate-700 text-[11px] truncate max-w-[200px] block">{tx.description}</span>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-slate-600">{formatAmountInDisplay(tx.amount, tx.currency, displayCurrency)}</td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => {
                          if (!confirm('Delete this transaction from ledger and revenue data?')) return;
                          removeTransaction(tx.id);
                          onUpdateTable(transactions.filter((t) => t.id !== tx.id), false);
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50"
                        title="Delete"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};

export default TransactionList;
