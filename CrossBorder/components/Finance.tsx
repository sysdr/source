
import React, { useState, useEffect } from 'react';
import { Transaction, EntityType } from '../types';
import { getCompanyProfile, getUIState, setUIState, StorageKeys } from '../services/storageService';
import { getTransactions, addTransaction, removeTransaction } from '../services/storageService';
import { getBaseCurrency, formatAmount, formatAmountInDisplay, getAmountInBase } from '../services/currencyService';
import { useDisplayCurrency } from '../contexts/DisplayCurrencyContext';

const EXPENSE_CATEGORIES = [
  'SaaS & Hosting',
  'Office Supplies',
  'Travel',
  'Payroll',
  'Marketing',
  'Legal & Compliance',
  'Rent & Utilities',
  'Insurance',
  'Professional Services',
  'Subscriptions',
  'Other',
];

const FinanceModule: React.FC = () => {
  const [profile] = useState(() => getCompanyProfile());
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();
  const [transactions, setTransactions] = useState<Transaction[]>(() => getTransactions());
  const [activeEntity, setActiveEntityState] = useState<EntityType>(() => getUIState(StorageKeys.UI_FINANCE_ENTITY, 'parent' as EntityType));
  const setActiveEntity = (v: EntityType) => { setActiveEntityState(v); setUIState(StorageKeys.UI_FINANCE_ENTITY, v); };
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [entryType, setEntryType] = useState<'Purchase' | 'Expense'>('Expense');

  const [newEntry, setNewEntry] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: 0,
    type: 'Expense' as 'Purchase' | 'Expense',
    category: 'SaaS & Hosting',
    source: 'Manual' as const,
    entity: 'parent' as EntityType,
  });

  useEffect(() => {
    const load = () => setTransactions(getTransactions());
    load();
    window.addEventListener('suez_data_updated', load);
    return () => window.removeEventListener('suez_data_updated', load);
  }, []);

  const parentName = profile?.parent?.name || 'Parent Company';
  const subsidiaryName = profile?.subsidiary?.name || 'Subsidiary Company';

  const handleAddEntry = () => {
    if (!newEntry.description || !newEntry.amount) return;
    const amt = Number(newEntry.amount);
    const tx: Transaction = {
      id: `TXN-${Date.now()}`,
      date: newEntry.date,
      description: newEntry.description,
      amount: amt,
      currency: baseCurrency,
      source: 'Manual',
      category: newEntry.category,
      status: 'Completed',
      type: newEntry.type,
      entity: newEntry.entity,
      gstImpact: newEntry.type === 'Purchase' ? amt * 0.18 : 0,
    };
    addTransaction(tx);
    setTransactions(getTransactions());
    setShowEntryModal(false);
    setNewEntry({
      date: new Date().toISOString().split('T')[0],
      description: '',
      amount: 0,
      type: 'Expense',
      category: 'SaaS & Hosting',
      source: 'Manual',
      entity: activeEntity,
    });
  };

  const handleDeleteEntry = (id: string) => {
    if (!confirm('Delete this entry?')) return;
    removeTransaction(id);
    setTransactions(getTransactions());
  };

  const openAddModal = (type: 'Purchase' | 'Expense', entity: EntityType) => {
    setEntryType(type);
    setActiveEntity(entity);
    setNewEntry({
      date: new Date().toISOString().split('T')[0],
      description: '',
      amount: 0,
      type,
      category: 'SaaS & Hosting',
      source: 'Manual',
      entity,
    });
    setShowEntryModal(true);
  };

  const parentTxns = transactions.filter((t) => (t.entity ?? 'parent') === 'parent' && (t.type === 'Purchase' || t.type === 'Expense'));
  const subsidiaryTxns = transactions.filter((t) => t.entity === 'subsidiary' && (t.type === 'Purchase' || t.type === 'Expense'));

  const excludeFailed = (t: { status?: string }) => t.status !== 'Failed' && t.status !== 'Refunded';
  const parentTotal = parentTxns.filter(excludeFailed).reduce((acc, t) => acc + getAmountInBase(t, baseCurrency), 0);
  const subsidiaryTotal = subsidiaryTxns.filter(excludeFailed).reduce((acc, t) => acc + getAmountInBase(t, baseCurrency), 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Finance Module</h2>
          <p className="text-slate-500 mt-1 font-medium">Purchase & Expense entries for Parent and Subsidiary</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Parent Company Card */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
            <h3 className="text-sm font-black text-indigo-900 uppercase tracking-widest">{parentName}</h3>
            <p className="text-[10px] font-bold text-indigo-600 mt-0.5">{profile?.parent?.taxId || '—'}</p>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => openAddModal('Expense', 'parent')}
                className="flex-1 bg-slate-900 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
              >
                + Expense
              </button>
              <button
                onClick={() => openAddModal('Purchase', 'parent')}
                className="flex-1 bg-indigo-600 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all"
              >
                + Purchase (ITC)
              </button>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total: {formatAmountInDisplay(parentTotal, baseCurrency, displayCurrency)}</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {parentTxns.length === 0 ? (
                <p className="text-slate-400 text-xs py-4 text-center">No entries yet</p>
              ) : (
                parentTxns.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-xl border border-slate-100 group">
                    <div>
                      <p className="text-xs font-bold text-slate-900">{t.description}</p>
                      <p className="text-[9px] font-bold text-slate-400">{t.date} • {t.category} • {t.type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-rose-600">-{formatAmountInDisplay(getAmountInBase(t, baseCurrency), baseCurrency, displayCurrency)}</span>
                      <button
                        onClick={() => handleDeleteEntry(t.id)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Subsidiary Company Card */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-emerald-50/50">
            <h3 className="text-sm font-black text-emerald-900 uppercase tracking-widest">{subsidiaryName}</h3>
            <p className="text-[10px] font-bold text-emerald-600 mt-0.5">{profile?.subsidiary?.taxId || '—'}</p>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => openAddModal('Expense', 'subsidiary')}
                className="flex-1 bg-slate-900 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
              >
                + Expense
              </button>
              <button
                onClick={() => openAddModal('Purchase', 'subsidiary')}
                className="flex-1 bg-emerald-600 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all"
              >
                + Purchase (ITC)
              </button>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total: {formatAmountInDisplay(subsidiaryTotal, baseCurrency, displayCurrency)}</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {subsidiaryTxns.length === 0 ? (
                <p className="text-slate-400 text-xs py-4 text-center">No entries yet</p>
              ) : (
                subsidiaryTxns.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-xl border border-slate-100 group">
                    <div>
                      <p className="text-xs font-bold text-slate-900">{t.description}</p>
                      <p className="text-[9px] font-bold text-slate-400">{t.date} • {t.category} • {t.type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-rose-600">-{formatAmountInDisplay(getAmountInBase(t, baseCurrency), baseCurrency, displayCurrency)}</span>
                      <button
                        onClick={() => handleDeleteEntry(t.id)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Combined summary */}
      <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-300 mb-4">Combined Summary</h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] font-bold text-indigo-300 uppercase">{parentName}</p>
            <p className="text-2xl font-black">{formatAmountInDisplay(parentTotal, baseCurrency, displayCurrency)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-emerald-300 uppercase">{subsidiaryName}</p>
            <p className="text-2xl font-black">{formatAmountInDisplay(subsidiaryTotal, baseCurrency, displayCurrency)}</p>
          </div>
        </div>
        <p className="mt-4 text-xs font-bold text-slate-400">Total: {formatAmountInDisplay(parentTotal + subsidiaryTotal, baseCurrency, displayCurrency)}</p>
      </div>

      {/* Add Entry Modal */}
      {showEntryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl space-y-8 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">
                New {entryType} — {activeEntity === 'parent' ? parentName : subsidiaryName}
              </h3>
              <button onClick={() => setShowEntryModal(false)} className="text-2xl text-slate-400 hover:text-slate-900">×</button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Description</label>
                  <input
                    type="text"
                    value={newEntry.description}
                    onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
                    placeholder="e.g. AWS Hosting, Office Supplies"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Category</label>
                  <select
                    value={newEntry.category}
                    onChange={(e) => setNewEntry({ ...newEntry, category: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Amount ({baseCurrency})</label>
                  <input
                    type="number"
                    value={newEntry.amount || ''}
                    onChange={(e) => setNewEntry({ ...newEntry, amount: Number(e.target.value) })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Date</label>
                  <input
                    type="date"
                    value={newEntry.date}
                    onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs"
                  />
                </div>
              </div>
              <button
                onClick={handleAddEntry}
                disabled={!newEntry.description || !newEntry.amount}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add {entryType}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceModule;
