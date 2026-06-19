import React from 'react';
import { Transaction } from '../../types';
import { useAllTransactions, useAddTransaction, useDeleteTransaction, useUpdateTransaction } from '../../hooks/useTransactions';
import { getActiveOrgId, getUIState, setUIState, StorageKeys, addTransaction as storageAddTransaction, removeTransaction as storageRemoveTransaction, updateTransaction as storageUpdateTransaction, getTransactions } from '../../services/storageService';
import { useDisplayCurrency } from '../../contexts/DisplayCurrencyContext';
import { useState } from 'react';
import JournalLedger from './JournalLedger';
import BalanceSheet from './BalanceSheet';
import PLStatement from './PLStatement';
import GSTCenter from './GSTCenter';
import ReconciliationPanel from './ReconciliationPanel';

const AccountingModule: React.FC = () => {
  const { displayCurrency } = useDisplayCurrency();
  const [activeView, setActiveViewState] = useState<'ledger' | 'balance-sheet' | 'gst' | 'pl'>(
    () => getUIState(StorageKeys.UI_ACCOUNTING_VIEW, 'ledger' as 'ledger' | 'balance-sheet' | 'gst' | 'pl')
  );
  const setActiveView = (v: 'ledger' | 'balance-sheet' | 'gst' | 'pl') => {
    setActiveViewState(v);
    setUIState(StorageKeys.UI_ACCOUNTING_VIEW, v);
  };

  const { data: transactions = [] } = useAllTransactions();

  const addMutation = useAddTransaction();
  const deleteMutation = useDeleteTransaction();
  const updateMutation = useUpdateTransaction();

  const handleAdd = (tx: Transaction) => {
    addMutation.mutate(tx);
  };

  const handleDelete = (id: string) => {
    // Soft-delete is handled inside JournalLedger via updateTransaction directly;
    // this callback triggers a React Query invalidation so the list refetches.
    deleteMutation.mutate(id);
  };

  const handleUpdate = (id: string, updates: Partial<Transaction>) => {
    // Special sentinel used by sub-components to request a full refresh
    // (e.g. after LLP import/delete operations that go directly through storageService)
    if (id === '__refresh__') {
      // Re-fetch by invalidating queries — useUpdateTransaction's onSuccess does this.
      // We pass a minimal no-op that just triggers the invalidation.
      const currentTxns = getTransactions();
      if (currentTxns.length > 0) {
        updateMutation.mutate({ ...currentTxns[0], ...updates } as Transaction);
      }
      return;
    }
    const existing = transactions.find(t => t.id === id);
    if (existing) {
      updateMutation.mutate({ ...existing, ...updates } as Transaction);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Cloud Financial Books</h2>
          <p className="text-slate-500 mt-1 font-medium">Unified Ledger · All amounts in {displayCurrency}</p>
        </div>
        <div className="flex bg-slate-200 p-1 rounded-xl text-[10px] font-black shadow-inner">
          <button
            onClick={() => setActiveView('ledger')}
            className={`px-4 py-1.5 rounded-lg transition-all ${activeView === 'ledger' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}
          >
            GENERAL LEDGER
          </button>
          <button
            onClick={() => setActiveView('balance-sheet')}
            className={`px-4 py-1.5 rounded-lg transition-all ${activeView === 'balance-sheet' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}
          >
            BALANCE SHEET
          </button>
          <button
            onClick={() => setActiveView('pl')}
            className={`px-4 py-1.5 rounded-lg transition-all ${activeView === 'pl' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}
          >
            P&L
          </button>
          <button
            onClick={() => setActiveView('gst')}
            className={`px-4 py-1.5 rounded-lg transition-all ${activeView === 'gst' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}
          >
            GST CENTER
          </button>
        </div>
      </header>

      <ReconciliationPanel />

      {activeView === 'ledger' && (
        <JournalLedger
          transactions={transactions}
          onAdd={handleAdd}
          onDelete={handleDelete}
          onUpdate={handleUpdate}
        />
      )}

      {activeView === 'balance-sheet' && (
        <BalanceSheet transactions={transactions} />
      )}

      {activeView === 'pl' && (
        <PLStatement transactions={transactions} />
      )}

      {activeView === 'gst' && (
        <GSTCenter transactions={transactions} />
      )}
    </div>
  );
};

export default AccountingModule;
