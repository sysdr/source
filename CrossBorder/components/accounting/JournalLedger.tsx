import React, { useState } from 'react';
import { Invoice, InvoiceLine, Transaction, FixedAsset } from '../../types';
import {
  addInvoice,
  getInvoices,
  getTransactions,
  removeTransaction,
  updateTransaction,
  getPendingTransactions,
  approvePendingTransaction,
  removePendingTransaction,
  getChartOfAccounts,
  getActiveOrgId,
  StorageKeys,
  storage,
} from '../../services/storageService';
import {
  getBaseCurrency,
  formatAmount,
  formatAmountInDisplay,
  getAmountInBase,
  getGstImpactInBase,
} from '../../services/currencyService';
import { useDisplayCurrency } from '../../contexts/DisplayCurrencyContext';
import {
  parseLLPBankStatementCSV,
  parseLLPBankStatementText,
  importLLPBankStatement,
  extractTextFromBankStatementPDF,
  convertImportedIndianBankTransactionsToINR,
  deleteAllImportedIndianBankTransactions,
} from '../../services/llpBankStatementIngestionService';

// ─── Fixed Assets helpers ────────────────────────────────────────────────────
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

// ─── Invoice helpers ──────────────────────────────────────────────────────────
const INVOICE_PREFIX = 'INV';

function nextInvoiceNumber(): string {
  const year = String(new Date().getFullYear()).slice(-2);
  const sameYear = getInvoices().filter((i) => i.number.startsWith(`${INVOICE_PREFIX}-${year}`));
  const maxNum = sameYear.reduce((max, i) => {
    const n = parseInt(i.number.split('-')[2] || '0', 10);
    return n > max ? n : max;
  }, 0);
  return `${INVOICE_PREFIX}-${year}-${String(maxNum + 1).padStart(4, '0')}`;
}

function createInvoiceFromAccounting(input: {
  customerName: string;
  customerCountry?: string;
  currency: 'USD' | 'INR';
  dueDays: number;
  entity: 'parent' | 'subsidiary';
  notes?: string;
  lines: { description: string; quantity: number; unitPrice: number; taxRate?: number }[];
}): Invoice {
  const nowIso = new Date().toISOString();
  const invoiceDate = nowIso.slice(0, 10);
  const due = new Date();
  due.setDate(due.getDate() + input.dueDays);
  const dueDate = due.toISOString().slice(0, 10);

  const lines: InvoiceLine[] = input.lines.map((l) => {
    const amount = l.quantity * l.unitPrice;
    const taxAmount = amount * ((l.taxRate || 0) / 100);
    return {
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount,
      currency: input.currency,
      taxRate: l.taxRate || undefined,
      taxAmount: taxAmount || undefined,
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const taxTotal = lines.reduce((sum, l) => sum + (l.taxAmount || 0), 0);
  const invoice: Invoice = {
    id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    number: nextInvoiceNumber(),
    date: invoiceDate,
    dueDate,
    customerName: input.customerName,
    customerCountry: input.customerCountry,
    status: 'Draft',
    currency: input.currency,
    subtotal,
    taxTotal,
    total: subtotal + taxTotal,
    lines,
    entity: input.entity,
    notes: input.notes,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  addInvoice(invoice);
  return invoice;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface JournalLedgerProps {
  transactions: Transaction[];
  onAdd: (tx: Transaction) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Transaction>) => void;
}

const JournalLedger: React.FC<JournalLedgerProps> = ({ transactions, onAdd, onDelete, onUpdate }) => {
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showLLPImportModal, setShowLLPImportModal] = useState(false);
  const [llpImportCsv, setLlpImportCsv] = useState('');
  const [llpPdfFileName, setLlpPdfFileName] = useState('');
  const [isPdfReading, setIsPdfReading] = useState(false);
  const [llpImportResult, setLlpImportResult] = useState<{ added: number; skipped: number; errors: string[]; importedIds: string[] } | null>(null);
  const [llpPdfExtractPreview, setLlpPdfExtractPreview] = useState<string>('');
  const [llpConvertResult, setLlpConvertResult] = useState<{ converted: number; skipped: number; errors: string[] } | null>(null);
  const [llpConvertRunning, setLlpConvertRunning] = useState(false);
  const [llpDeleteAllResult, setLlpDeleteAllResult] = useState<{ deleted: number; skipped: number; errors: string[] } | null>(null);
  const [llpDeleteAllRunning, setLlpDeleteAllRunning] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [pendingList, setPendingList] = useState(() => getPendingTransactions());
  const [showPendingBar, setShowPendingBar] = useState(false);
  const [ledgerScope, setLedgerScope] = useState<'all' | 'llp' | 'inc_us'>('all');
  const [onlyLlpImported, setOnlyLlpImported] = useState(false);
  const [journalPageSize, setJournalPageSize] = useState(50);
  const [showDeleted, setShowDeleted] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const [showAssetModal, setShowAssetModal] = useState(false);
  const [fixedAssets, setFixedAssetsState] = useState<FixedAsset[]>(() => {
    try { return getFixedAssetsFromStorage(); } catch { return []; }
  });
  const [newAsset, setNewAsset] = useState<Partial<FixedAsset>>({
    name: '', category: 'Computer', purchaseDate: new Date().toISOString().split('T')[0],
    cost: 0, depreciationRate: 40, accumulated: 0, entity: 'parent',
  });

  const glAccounts = getChartOfAccounts();

  const [newTx, setNewTx] = useState<Partial<Transaction>>({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: 0,
    type: 'Expense',
    category: 'SaaS & Hosting',
    source: 'Manual',
    currency: baseCurrency,
    gstRate: 18,
    itcEligible: true,
    narration: '',
  });

  const setFixedAssets = (assets: FixedAsset[]) => {
    setFixedAssetsState(assets);
    saveFixedAssets(assets);
  };

  // ─── Derived data ─────────────────────────────────────────────────────────
  const isInLedgerScope = (t: Transaction): boolean => {
    if (onlyLlpImported) return t.source === 'IndianBank';
    if (ledgerScope === 'all') return true;
    if (ledgerScope === 'llp') return t.source === 'IndianBank' || t.entity === 'parent';
    return t.entity === 'subsidiary';
  };
  const isCompletedForTotal = (t: { status?: string }) =>
    !t.status || (t.status !== 'Failed' && t.status !== 'Refunded' && t.status !== 'Pending');

  const scopedTransactions = transactions.filter(isInLedgerScope);
  const activeScopedTxns = scopedTransactions.filter(t => !t.deleted);

  const stats = activeScopedTxns.filter(isCompletedForTotal).reduce((acc, curr) => {
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
  const statsWithItc = { ...stats, totalItc: stats.eligibleItc };

  const nonINRImportedCount = transactions.filter((t) => t.source === 'IndianBank' && t.currency !== 'INR').length;
  const importedIndianBankCount = transactions.filter((t) => t.source === 'IndianBank').length;

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleDeleteTransaction = (id: string) => {
    const reason = window.prompt('Reason for deletion (required for audit trail):');
    if (reason === null) return;
    updateTransaction(id, { deleted: true, deletedAt: new Date().toISOString(), deletedReason: reason || 'No reason provided' });
    onDelete(id);
  };

  const handleEditTransaction = (tx: Transaction) => {
    if (tx.source === 'Stripe' || tx.stripeChargeId) return;
    setEditingTx({ ...tx });
  };

  const handleSaveEditTransaction = () => {
    if (!editingTx || !editingTx.description || editingTx.amount == null) return;
    const amt = Number(editingTx.amount);
    const nextCurrency = editingTx.source === 'IndianBank' ? 'INR' : baseCurrency;
    const gstRate = editingTx.gstRate ?? (editingTx.type === 'Purchase' ? 18 : 0);
    const tdsAmt = editingTx.tdsApplicable ? amt * (editingTx.tdsRate ?? 0) / 100 : 0;
    const updates: Partial<Transaction> = {
      date: editingTx.date,
      description: editingTx.description,
      amount: amt,
      type: editingTx.type,
      category: editingTx.category,
      currency: nextCurrency,
      gstRate,
      gstImpact: editingTx.type === 'Purchase' ? amt * gstRate / 100 : 0,
      itcEligible: editingTx.type === 'Purchase' ? (editingTx.itcEligible ?? true) : undefined,
      tdsSection: editingTx.tdsSection,
      tdsRate: editingTx.tdsRate,
      tdsAmount: tdsAmt || undefined,
      tdsApplicable: editingTx.tdsApplicable,
      narration: editingTx.narration,
      entity: editingTx.entity,
      recipientGstin: editingTx.recipientGstin,
    };
    updateTransaction(editingTx.id, updates);
    onUpdate(editingTx.id, updates);
    setEditingTx(null);
  };

  const handleAddTransaction = () => {
    if (!newTx.description || !newTx.amount) return;
    const amt = Number(newTx.amount);
    const gstRate = newTx.gstRate ?? (newTx.type === 'Purchase' ? 18 : 0);
    const tdsAmt = newTx.tdsApplicable ? amt * (newTx.tdsRate ?? 0) / 100 : 0;
    const tx: Transaction = {
      ...newTx as Transaction,
      id: `TXN-${Date.now()}`,
      amount: amt,
      currency: baseCurrency,
      status: 'Completed',
      gstRate,
      gstImpact: newTx.type === 'Purchase' ? amt * gstRate / 100 : 0,
      itcEligible: newTx.type === 'Purchase' ? (newTx.itcEligible ?? true) : undefined,
      tdsAmount: tdsAmt || undefined,
    };
    onAdd(tx);
    setShowEntryModal(false);
    setNewTx({
      date: new Date().toISOString().split('T')[0],
      description: '', amount: 0, type: 'Expense',
      category: 'SaaS & Hosting', source: 'Manual', currency: baseCurrency,
      gstRate: 18, itcEligible: true, narration: '',
    });
  };

  const handleConvertImportedLLPToINR = () => {
    if (nonINRImportedCount === 0 || llpConvertRunning) return;
    setLlpConvertRunning(true);
    setLlpConvertResult(null);
    try {
      const result = convertImportedIndianBankTransactionsToINR();
      // Trigger a re-fetch by invalidating through onUpdate with a dummy no-op
      // The parent will refetch from storage via React Query invalidation
      onUpdate('__refresh__', {});
      setLlpConvertResult(result);
    } finally {
      setLlpConvertRunning(false);
    }
  };

  const handleDeleteAllImportedLLP = () => {
    if (importedIndianBankCount === 0 || llpDeleteAllRunning) return;
    const ok = confirm(`Delete ALL imported LLP transactions (${importedIndianBankCount}) from ledger?`);
    if (!ok) return;
    setLlpDeleteAllRunning(true);
    setLlpDeleteAllResult(null);
    try {
      const result = deleteAllImportedIndianBankTransactions();
      onUpdate('__refresh__', {});
      setLlpImportResult(null);
      setLlpDeleteAllResult(result);
    } finally {
      setLlpDeleteAllRunning(false);
    }
  };

  const handleImportLLPBankStatement = () => {
    const rows = parseLLPBankStatementCSV(llpImportCsv);
    if (rows.length === 0) {
      setLlpImportResult({ added: 0, skipped: 0, errors: ['No valid rows found.'], importedIds: [] });
      return;
    }
    const result = importLLPBankStatement(rows);
    onUpdate('__refresh__', {});
    setLlpImportResult(result);
  };

  const handleImportLLPBankStatementPdf = async (file: File | null) => {
    if (!file) return;
    setIsPdfReading(true);
    setLlpImportResult(null);
    setLlpPdfFileName(file.name);
    setLlpPdfExtractPreview('');
    try {
      const text = await extractTextFromBankStatementPDF(file);
      const preview = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 60)
        .join('\n');
      setLlpPdfExtractPreview(preview);
      const rows = parseLLPBankStatementText(text);
      if (rows.length === 0) {
        setLlpImportResult({ added: 0, skipped: 0, errors: ['No statement rows detected from PDF text.'], importedIds: [] });
        return;
      }
      const result = importLLPBankStatement(rows);
      onUpdate('__refresh__', {});
      setLlpImportResult(result);
    } catch (e) {
      setLlpImportResult({ added: 0, skipped: 0, errors: [(e as Error).message || 'Failed to read PDF'], importedIds: [] });
    } finally {
      setIsPdfReading(false);
    }
  };

  const handleUpdateImportedTransaction = (id: string, updates: Partial<Transaction>) => {
    updateTransaction(id, updates);
    onUpdate(id, updates);
  };

  const handleGenerateInvoiceFromImported = (tx: Transaction) => {
    if (tx.type !== 'Income') return;
    const customerName = window.prompt('Customer name for invoice', tx.description || 'Customer');
    if (!customerName || !customerName.trim()) return;
    createInvoiceFromAccounting({
      customerName: customerName.trim(),
      customerCountry: tx.customerCountry || tx.customerLocation,
      currency: tx.currency,
      dueDays: 30,
      entity: tx.entity || 'parent',
      notes: `Manually generated from imported transaction ${tx.id}`,
      lines: [
        {
          description: tx.description || 'Imported receipt',
          quantity: 1,
          unitPrice: tx.amount,
          taxRate: 0,
        },
      ],
    });
    alert('Invoice created in Invoicing module.');
  };

  const handleDeleteImportedBatch = () => {
    if (!llpImportResult?.importedIds?.length) return;
    const ok = confirm(`Delete ${llpImportResult.importedIds.length} imported transaction(s) from the ledger?`);
    if (!ok) return;
    for (const id of llpImportResult.importedIds) {
      removeTransaction(id);
    }
    onUpdate('__refresh__', {});
    setLlpImportResult(null);
  };

  const downloadReport = (name: string) => {
    setIsDownloading(true);
    try {
      const blob = new Blob([
        `${name.toUpperCase()} REPORT\nGenerated: ${new Date().toLocaleString()}\n\nDate, Description, Category, Type, Amount, GST Impact\n` +
        scopedTransactions.map(t => {
          const amt = getAmountInBase(t, baseCurrency);
          const gst = getGstImpactInBase(t, baseCurrency);
          return `${t.date}, ${t.description}, ${t.category}, ${t.type}, ${amt}, ${gst}`;
        }).join('\n')
      ], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Suez_${name}_Report.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Pending approvals bar */}
      {pendingList.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <button onClick={() => setShowPendingBar(!showPendingBar)} className="w-full flex items-center justify-between text-left">
            <span className="text-sm font-black text-amber-900 uppercase tracking-widest">
              {pendingList.length} Pending approval
            </span>
            <span className="text-amber-600">{showPendingBar ? '▼' : '▶'}</span>
          </button>
          {showPendingBar && (
            <ul className="mt-4 space-y-2">
              {pendingList.map((p) => (
                <li key={p.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-amber-100">
                  <div>
                    <p className="font-bold text-slate-900 text-xs">{p.description}</p>
                    <p className="text-[10px] text-slate-500">{p.date} · {formatAmountInDisplay(p.amount, baseCurrency, displayCurrency)} · {p.type}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        approvePendingTransaction(p.id);
                        onUpdate('__refresh__', {});
                        setPendingList(getPendingTransactions());
                      }}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => { removePendingTransaction(p.id); setPendingList(getPendingTransactions()); }}
                      className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-[10px] font-black uppercase"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gross Revenue</p>
          <h3 className="text-2xl font-black text-slate-900">{formatAmountInDisplay(stats.income, baseCurrency, displayCurrency)}</h3>
          <p className="text-[10px] text-slate-500 mt-1">Total income</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-600">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Net Revenue</p>
          <h3 className="text-2xl font-black text-slate-900">{formatAmountInDisplay(stats.income, baseCurrency, displayCurrency)}</h3>
          <p className="text-[10px] text-slate-500 mt-1">After refunds</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-t-4 border-t-orange-500">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Purchases & Opex</p>
          <h3 className="text-2xl font-black text-slate-900">{formatAmountInDisplay(stats.purchases + stats.expenses, baseCurrency, displayCurrency)}</h3>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-t-4 border-t-violet-500">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gross Profit</p>
          <h3 className="text-2xl font-black text-slate-900">{formatAmountInDisplay(stats.income - stats.purchases, baseCurrency, displayCurrency)}</h3>
          <p className="text-[10px] text-slate-500 mt-1">Revenue − purchases</p>
        </div>
        <div className="bg-slate-900 p-6 rounded-2xl shadow-sm border-t-4 border-t-indigo-400">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Net Profit</p>
          <h3 className="text-2xl font-black text-white">{formatAmountInDisplay(stats.income - stats.purchases - stats.expenses, baseCurrency, displayCurrency)}</h3>
          <p className="text-[10px] text-slate-400 mt-1">Revenue − all expenses</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm border-t-4 border-t-indigo-500">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">ITC Collected</p>
          <h3 className="text-xl font-black text-slate-900">{formatAmountInDisplay(statsWithItc.totalItc, baseCurrency, displayCurrency)}</h3>
        </div>
      </div>

      {/* Transaction Journal */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="font-black text-slate-900 uppercase text-xs tracking-widest">Transaction Journal</h3>
          <div className="flex gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">View</span>
              <select
                value={ledgerScope}
                onChange={(e) => { setLedgerScope(e.target.value as 'all' | 'llp' | 'inc_us'); setJournalPageSize(50); }}
                className="text-[10px] font-black border border-slate-200 rounded-lg px-2 py-2 bg-white"
              >
                <option value="all">All</option>
                <option value="llp">SystemDR LLP</option>
                <option value="inc_us">SystemDR Inc US</option>
              </select>
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer">
                <input type="checkbox" checked={onlyLlpImported} onChange={(e) => { setOnlyLlpImported(e.target.checked); setJournalPageSize(50); }} />
                Imported only
              </label>
              <label className="flex items-center gap-2 text-[10px] font-black text-rose-400 uppercase tracking-widest cursor-pointer">
                <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
                Show deleted
              </label>
            </div>
            <button
              onClick={() => setShowLLPImportModal(true)}
              className="bg-white border border-slate-200 text-slate-900 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
            >
              Import LLP Statement
            </button>
            <button
              onClick={handleConvertImportedLLPToINR}
              disabled={llpConvertRunning || nonINRImportedCount === 0}
              className="bg-white border border-slate-200 text-slate-900 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all disabled:opacity-50"
              title="Convert existing imported LLP (IndianBank) ledger amounts to INR"
            >
              {llpConvertRunning ? 'Converting…' : `Convert to INR${nonINRImportedCount ? ` (${nonINRImportedCount})` : ''}`}
            </button>
            <button
              onClick={handleDeleteImportedBatch}
              disabled={!llpImportResult?.importedIds?.length}
              className="bg-white border border-rose-200 text-rose-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 transition-all disabled:opacity-50"
              title="Delete the transactions from the most recent LLP import batch"
            >
              Delete last import{llpImportResult?.importedIds?.length ? ` (${llpImportResult.importedIds.length})` : ''}
            </button>
            <button
              onClick={handleDeleteAllImportedLLP}
              disabled={llpDeleteAllRunning || importedIndianBankCount === 0}
              className="bg-white border border-rose-200 text-rose-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 transition-all disabled:opacity-50"
              title="Delete all imported LLP transactions (IndianBank) from ledger"
            >
              {llpDeleteAllRunning ? 'Deleting…' : `Delete All Imported (${importedIndianBankCount})`}
            </button>
            <button
              onClick={() => downloadReport('ledger')}
              disabled={isDownloading}
              className="bg-white border border-slate-200 text-slate-900 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"
            >
              {isDownloading ? 'Exporting...' : 'Export CSV'}
            </button>
            <button
              onClick={() => setShowEntryModal(true)}
              className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
            >
              + New Entry
            </button>
          </div>
        </div>
        {llpConvertResult && (
          <div className="px-8 py-4 border-b border-slate-100 bg-emerald-50/50">
            <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">LLP INR Conversion Result</p>
            <p className="text-xs text-emerald-900 mt-1">
              Converted: {llpConvertResult.converted}. Skipped: {llpConvertResult.skipped}.
              {llpConvertResult.errors.length ? ` Errors: ${llpConvertResult.errors.join(' ')}` : ''}
            </p>
          </div>
        )}
        {llpDeleteAllResult && (
          <div className="px-8 py-4 border-b border-slate-100 bg-rose-50/50">
            <p className="text-[10px] font-black text-rose-800 uppercase tracking-widest">LLP Delete All Result</p>
            <p className="text-xs text-rose-900 mt-1">
              Deleted: {llpDeleteAllResult.deleted}. Skipped: {llpDeleteAllResult.skipped}.
              {llpDeleteAllResult.errors.length ? ` Errors: ${llpDeleteAllResult.errors.join(' ')}` : ''}
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-8 py-4">Date</th>
                <th className="px-8 py-4">Account</th>
                <th className="px-8 py-4">Entity</th>
                <th className="px-8 py-4">GST Link</th>
                <th className="px-8 py-4 text-right">Amount</th>
                <th className="px-8 py-4 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(showDeleted ? scopedTransactions : activeScopedTxns)
                .slice(0, journalPageSize)
                .map(txn => (
                  <tr key={txn.id} className={`hover:bg-slate-50/50 transition-colors ${txn.deleted ? 'opacity-40' : ''}`}>
                    <td className="px-8 py-6 text-xs font-bold text-slate-500 uppercase">{txn.date}</td>
                    <td className="px-8 py-6">
                      <p className={`font-black text-slate-900 uppercase text-xs ${txn.deleted ? 'line-through' : ''}`}>{txn.description}</p>
                      {txn.deleted && <span className="inline-flex mt-1 text-[9px] font-black bg-rose-50 text-rose-700 px-2 py-0.5 rounded">Deleted: {txn.deletedReason}</span>}
                      {txn.narration && <p className="text-[9px] text-slate-500 italic mt-0.5">{txn.narration}</p>}
                      {txn.source === 'IndianBank' && (
                        <span className="inline-flex mt-1 text-[9px] font-black bg-amber-50 text-amber-700 px-2 py-0.5 rounded">
                          Imported LLP (INR)
                        </span>
                      )}
                      {txn.tdsAmount ? <span className="inline-flex mt-1 ml-1 text-[9px] font-black bg-rose-50 text-rose-700 px-2 py-0.5 rounded">TDS {txn.tdsSection}: {formatAmountInDisplay(txn.tdsAmount, baseCurrency, displayCurrency)}</span> : null}
                      {txn.type === 'Purchase' && txn.itcEligible === false && <span className="inline-flex mt-1 ml-1 text-[9px] font-black bg-amber-50 text-amber-700 px-2 py-0.5 rounded">ITC Blocked §17(5)</span>}
                      <p className="text-[9px] font-bold text-slate-400 uppercase">{txn.category} • {txn.source} {txn.gstRate != null ? `• GST ${txn.gstRate}%` : ''}</p>
                    </td>
                    <td className="px-8 py-6">
                      <span className={`text-[9px] font-black px-2 py-1 rounded ${txn.entity === 'subsidiary' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
                        {txn.entity === 'subsidiary' ? 'Subsidiary' : 'Parent'}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      {txn.gstImpact ? (
                        <span className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-2 py-1 rounded">
                          ITC:{' '}
                          {txn.source === 'IndianBank'
                            ? formatAmount(getGstImpactInBase(txn, 'INR'), 'INR')
                            : formatAmountInDisplay(getGstImpactInBase(txn, baseCurrency), baseCurrency, displayCurrency)}
                        </span>
                      ) : (
                        <span className="text-[9px] font-black text-slate-300">N/A</span>
                      )}
                    </td>
                    <td className={`px-8 py-6 text-right font-black text-sm ${txn.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {txn.type === 'Income' ? '+' : '-'}{' '}
                      {txn.source === 'IndianBank'
                        ? formatAmount(txn.amount, 'INR')
                        : formatAmountInDisplay(getAmountInBase(txn, baseCurrency), baseCurrency, displayCurrency)}
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex gap-1">
                        {txn.source === 'IndianBank' && txn.type === 'Income' && (
                          <button
                            type="button"
                            onClick={() => handleGenerateInvoiceFromImported(txn)}
                            className="text-slate-400 hover:text-indigo-600 transition-colors p-1 rounded-lg hover:bg-indigo-50"
                            title="Generate manual invoice from this received amount"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M7 3v18" />
                              <path d="M17 3v18" />
                              <path d="M7 8h10" />
                              <path d="M7 16h10" />
                            </svg>
                          </button>
                        )}
                        {txn.source !== 'Stripe' && !txn.stripeChargeId && (
                          <button
                            onClick={() => handleEditTransaction(txn)}
                            className="text-slate-400 hover:text-indigo-600 transition-colors p-1 rounded-lg hover:bg-indigo-50"
                            title="Edit transaction"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteTransaction(txn.id)}
                          className="text-slate-400 hover:text-rose-600 transition-colors p-1 rounded-lg hover:bg-rose-50"
                          title="Delete transaction"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {(showDeleted ? scopedTransactions : activeScopedTxns).length > journalPageSize && (
          <div className="px-8 py-4 border-t border-slate-100 bg-white">
            <button
              type="button"
              className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800"
              onClick={() => setJournalPageSize((p) => p + 50)}
            >
              {(() => { const list = showDeleted ? scopedTransactions : activeScopedTxns; return `Show more (${Math.min(list.length, journalPageSize + 50)}/${list.length})`; })()}
            </button>
          </div>
        )}
      </div>

      {/* Fixed Assets section (shown inline in ledger) */}
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

      {/* LLP Import Modal */}
      {showLLPImportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Import LLP Bank Statement</h3>
              <button
                onClick={() => { setShowLLPImportModal(false); setLlpImportResult(null); }}
                className="text-2xl text-slate-400 hover:text-slate-900"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-slate-500">
              CSV format: date, description, amount [, currency] [, type] [, category] [, status] [, entity] [, reference]
            </p>
            <div className="space-y-2">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">
                PDF Statement (LLP Bank)
              </label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => void handleImportLLPBankStatementPdf(e.target.files?.[0] || null)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
              />
              <p className="text-[10px] text-slate-500">
                {isPdfReading ? 'Reading PDF and extracting transactions...' : llpPdfFileName ? `Selected: ${llpPdfFileName}` : 'Upload PDF bank statement to auto-read transactions.'}
              </p>
              {llpPdfExtractPreview && (
                <details className="mt-1">
                  <summary className="text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer">
                    Debug: extracted PDF text (preview)
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto bg-slate-50 border border-slate-100 rounded-xl p-3 font-mono text-[10px] text-slate-700 whitespace-pre-wrap">
                    {llpPdfExtractPreview}
                  </pre>
                </details>
              )}
            </div>
            <textarea
              value={llpImportCsv}
              onChange={(e) => setLlpImportCsv(e.target.value)}
              rows={8}
              placeholder={'date,description,amount,currency,type,category,status,entity,reference\n2026-03-10,Customer payment INV-102,25000,INR,Income,Sales,Completed,parent,UTR123\n2026-03-11,AWS bill,-4600,INR,Expense,SaaS & Hosting,Completed,parent,UTR124'}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-mono text-xs"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleImportLLPBankStatement}
                disabled={!llpImportCsv.trim()}
                className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50"
              >
                Import into Ledger
              </button>
              {llpImportResult && (
                <span className="text-xs text-slate-600">
                  Added {llpImportResult.added}, skipped {llpImportResult.skipped}
                  {llpImportResult.errors.length ? `, errors: ${llpImportResult.errors.join(' ')}` : ''}
                </span>
              )}
            </div>
            {llpImportResult && llpImportResult.importedIds.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  Imported transactions - edit placement & generate invoice
                </p>
                <div className="flex gap-2 items-center">
                  <button
                    type="button"
                    onClick={handleDeleteImportedBatch}
                    className="px-3 py-1.5 rounded-xl bg-white border border-rose-200 text-rose-700 text-[10px] font-black uppercase tracking-widest hover:bg-rose-50"
                  >
                    Delete last import
                  </button>
                  <span className="text-xs text-slate-500">
                    {llpImportResult.importedIds.length} row(s) in this batch
                  </span>
                </div>
                <div className="max-h-72 overflow-auto rounded-xl border border-slate-100">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-2 py-2">Date</th>
                        <th className="text-left px-2 py-2">Description</th>
                        <th className="text-left px-2 py-2">Type</th>
                        <th className="text-left px-2 py-2">Category</th>
                        <th className="text-left px-2 py-2">Entity</th>
                        <th className="text-right px-2 py-2">Amount</th>
                        <th className="text-left px-2 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions
                        .filter((tx) => llpImportResult.importedIds.includes(tx.id))
                        .map((tx) => (
                          <tr key={tx.id} className="border-t border-slate-100">
                            <td className="px-2 py-2">
                              <input
                                type="date"
                                value={tx.date}
                                onChange={(e) => handleUpdateImportedTransaction(tx.id, { date: e.target.value })}
                                className="w-full border border-slate-200 rounded px-1 py-1"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <input
                                type="text"
                                value={tx.description}
                                onChange={(e) => handleUpdateImportedTransaction(tx.id, { description: e.target.value })}
                                className="w-full border border-slate-200 rounded px-1 py-1"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <select
                                value={tx.type}
                                onChange={(e) => handleUpdateImportedTransaction(tx.id, { type: e.target.value as Transaction['type'] })}
                                className="w-full border border-slate-200 rounded px-1 py-1"
                              >
                                <option value="Income">Income</option>
                                <option value="Expense">Expense</option>
                                <option value="Purchase">Purchase</option>
                              </select>
                            </td>
                            <td className="px-2 py-2">
                              <input
                                type="text"
                                value={tx.category}
                                onChange={(e) => handleUpdateImportedTransaction(tx.id, { category: e.target.value })}
                                className="w-full border border-slate-200 rounded px-1 py-1"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <select
                                value={tx.entity || 'parent'}
                                onChange={(e) => handleUpdateImportedTransaction(tx.id, { entity: e.target.value as 'parent' | 'subsidiary' })}
                                className="w-full border border-slate-200 rounded px-1 py-1"
                              >
                                <option value="parent">Parent</option>
                                <option value="subsidiary">Subsidiary</option>
                              </select>
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                value={tx.amount}
                                onChange={(e) => handleUpdateImportedTransaction(tx.id, { amount: Number(e.target.value) || 0 })}
                                className="w-28 border border-slate-200 rounded px-1 py-1 text-right"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() => handleGenerateInvoiceFromImported(tx)}
                                disabled={tx.type !== 'Income'}
                                className="px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-40"
                                title="Generate manual invoice from this receipt"
                              >
                                Generate Invoice
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Entry Modal */}
      {showEntryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-xl rounded-[2.5rem] p-10 shadow-2xl space-y-5 animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Manual Journal Entry</h3>
              <button onClick={() => setShowEntryModal(false)} className="text-2xl text-slate-400 hover:text-slate-900">×</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Description *</label>
                <input type="text" value={newTx.description} onChange={e => setNewTx({...newTx, description: e.target.value})} placeholder="e.g. AWS hosting bill" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Narration (business purpose — Rule 6F)</label>
                <input type="text" value={newTx.narration ?? ''} onChange={e => setNewTx({...newTx, narration: e.target.value})} placeholder="e.g. Cloud infra for SaaS product" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Type</label>
                <select value={newTx.type} onChange={e => setNewTx({...newTx, type: e.target.value as Transaction['type'], itcEligible: true, tdsApplicable: false})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                  <option value="Expense">Expense</option>
                  <option value="Purchase">Purchase (ITC)</option>
                  <option value="Income">Income</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Category (GL)</label>
                <select value={newTx.category} onChange={e => setNewTx({...newTx, category: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                  {glAccounts.filter((a) => a.type === (newTx.type || 'Expense')).map((a) => <option key={a.code} value={a.name}>{a.code} – {a.name}</option>)}
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Amount ({baseCurrency})</label>
                <input type="number" value={newTx.amount} onChange={e => setNewTx({...newTx, amount: Number(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Date</label>
                <input type="date" value={newTx.date} onChange={e => setNewTx({...newTx, date: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">GST Rate %</label>
                <select value={newTx.gstRate ?? 0} onChange={e => setNewTx({...newTx, gstRate: Number(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                  <option value={0}>0% (Nil / Export)</option>
                  <option value={5}>5%</option>
                  <option value={12}>12%</option>
                  <option value={18}>18%</option>
                  <option value={28}>28%</option>
                </select>
              </div>
              {newTx.type === 'Income' && (
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Recipient GSTIN (B2B)</label>
                  <input type="text" value={newTx.recipientGstin ?? ''} onChange={e => setNewTx({...newTx, recipientGstin: e.target.value.toUpperCase()})} placeholder="29AABCT1332L1ZV" maxLength={15} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                </div>
              )}
              {newTx.type === 'Purchase' && (
                <div className="col-span-2 flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <input type="checkbox" id="itcEligNew" checked={newTx.itcEligible !== false} onChange={e => setNewTx({...newTx, itcEligible: e.target.checked})} />
                  <label htmlFor="itcEligNew" className="text-[10px] font-black text-amber-800 uppercase tracking-widest cursor-pointer">ITC Eligible (uncheck for Sec 17(5) blocked — motor vehicles, food, club membership etc.)</label>
                </div>
              )}
              {(newTx.type === 'Expense' || newTx.type === 'Purchase') && (
                <>
                  <div className="col-span-2 flex items-center gap-3 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
                    <input type="checkbox" id="tdsNew" checked={!!newTx.tdsApplicable} onChange={e => setNewTx({...newTx, tdsApplicable: e.target.checked, tdsSection: e.target.checked ? '194C' : undefined, tdsRate: e.target.checked ? 1 : undefined})} />
                    <label htmlFor="tdsNew" className="text-[10px] font-black text-rose-800 uppercase tracking-widest cursor-pointer">TDS Applicable</label>
                  </div>
                  {newTx.tdsApplicable && (
                    <div className="col-span-2 grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Section</label>
                        <select value={newTx.tdsSection ?? '194C'} onChange={e => { const rates: Record<string,number> = {'194C':1,'194J(tech)':2,'194J(prof)':10,'194H':5,'194I(a)':2,'194I(b)':10,'194Q':0.1}; setNewTx({...newTx, tdsSection: e.target.value, tdsRate: rates[e.target.value] ?? 1}); }} className="w-full px-2 py-2 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                          <option value="194C">194C — Contractor (1%)</option>
                          <option value="194J(tech)">194J — Technical (2%)</option>
                          <option value="194J(prof)">194J — Professional (10%)</option>
                          <option value="194H">194H — Commission (5%)</option>
                          <option value="194I(a)">194I(a) — Rent P&M (2%)</option>
                          <option value="194I(b)">194I(b) — Rent Land/Bldg (10%)</option>
                          <option value="194Q">194Q — Goods &gt;50L (0.1%)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Rate %</label>
                        <input type="number" step="0.1" value={newTx.tdsRate ?? 1} onChange={e => setNewTx({...newTx, tdsRate: Number(e.target.value)})} className="w-full px-2 py-2 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">TDS Amount</label>
                        <input type="text" readOnly value={((newTx.amount ?? 0) * (newTx.tdsRate ?? 0) / 100).toFixed(2)} className="w-full px-2 py-2 bg-slate-100 border border-slate-100 rounded-xl font-bold text-xs" />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <button onClick={handleAddTransaction} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl">Post to Ledger</button>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {editingTx && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-xl rounded-[2.5rem] p-10 shadow-2xl space-y-5 animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Edit Journal Entry</h3>
              <button onClick={() => setEditingTx(null)} className="text-2xl text-slate-400 hover:text-slate-900">×</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Description</label>
                <input type="text" value={editingTx.description} onChange={e => setEditingTx({...editingTx, description: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Narration (Rule 6F)</label>
                <input type="text" value={editingTx.narration ?? ''} onChange={e => setEditingTx({...editingTx, narration: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Type</label>
                <select value={editingTx.type} onChange={e => setEditingTx({...editingTx, type: e.target.value as Transaction['type']})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                  <option value="Expense">Expense</option>
                  <option value="Purchase">Purchase (ITC)</option>
                  <option value="Income">Income</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Category (GL)</label>
                <select value={editingTx.category} onChange={e => setEditingTx({...editingTx, category: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                  {glAccounts.filter(a => a.type === (editingTx.type || 'Expense')).map(a => <option key={a.code} value={a.name}>{a.code} – {a.name}</option>)}
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Amount ({baseCurrency})</label>
                <input type="number" value={editingTx.amount} onChange={e => setEditingTx({...editingTx, amount: Number(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Date</label>
                <input type="date" value={editingTx.date} onChange={e => setEditingTx({...editingTx, date: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">GST Rate %</label>
                <select value={editingTx.gstRate ?? 0} onChange={e => setEditingTx({...editingTx, gstRate: Number(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                  <option value={0}>0%</option><option value={5}>5%</option><option value={12}>12%</option><option value={18}>18%</option><option value={28}>28%</option>
                </select>
              </div>
              {editingTx.type === 'Income' && (
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Recipient GSTIN (B2B)</label>
                  <input type="text" value={editingTx.recipientGstin ?? ''} onChange={e => setEditingTx({...editingTx, recipientGstin: e.target.value.toUpperCase()})} maxLength={15} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                </div>
              )}
              {editingTx.type === 'Purchase' && (
                <div className="col-span-2 flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <input type="checkbox" id="itcEligEdit" checked={editingTx.itcEligible !== false} onChange={e => setEditingTx({...editingTx, itcEligible: e.target.checked})} />
                  <label htmlFor="itcEligEdit" className="text-[10px] font-black text-amber-800 uppercase tracking-widest cursor-pointer">ITC Eligible (uncheck for Sec 17(5) blocked)</label>
                </div>
              )}
              {(editingTx.type === 'Expense' || editingTx.type === 'Purchase') && (
                <>
                  <div className="col-span-2 flex items-center gap-3 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
                    <input type="checkbox" id="tdsEdit" checked={!!editingTx.tdsApplicable} onChange={e => setEditingTx({...editingTx, tdsApplicable: e.target.checked, tdsSection: e.target.checked ? (editingTx.tdsSection || '194C') : undefined, tdsRate: e.target.checked ? (editingTx.tdsRate || 1) : undefined})} />
                    <label htmlFor="tdsEdit" className="text-[10px] font-black text-rose-800 uppercase tracking-widest cursor-pointer">TDS Applicable</label>
                  </div>
                  {editingTx.tdsApplicable && (
                    <div className="col-span-2 grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Section</label>
                        <select value={editingTx.tdsSection ?? '194C'} onChange={e => { const rates: Record<string,number> = {'194C':1,'194J(tech)':2,'194J(prof)':10,'194H':5,'194I(a)':2,'194I(b)':10,'194Q':0.1}; setEditingTx({...editingTx, tdsSection: e.target.value, tdsRate: rates[e.target.value] ?? 1}); }} className="w-full px-2 py-2 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs appearance-none">
                          <option value="194C">194C — Contractor (1%)</option>
                          <option value="194J(tech)">194J — Technical (2%)</option>
                          <option value="194J(prof)">194J — Professional (10%)</option>
                          <option value="194H">194H — Commission (5%)</option>
                          <option value="194I(a)">194I(a) — Rent P&M (2%)</option>
                          <option value="194I(b)">194I(b) — Rent Land/Bldg (10%)</option>
                          <option value="194Q">194Q — Goods &gt;50L (0.1%)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Rate %</label>
                        <input type="number" step="0.1" value={editingTx.tdsRate ?? 1} onChange={e => setEditingTx({...editingTx, tdsRate: Number(e.target.value)})} className="w-full px-2 py-2 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">TDS Amount</label>
                        <input type="text" readOnly value={(editingTx.amount * (editingTx.tdsRate ?? 0) / 100).toFixed(2)} className="w-full px-2 py-2 bg-slate-100 border border-slate-100 rounded-xl font-bold text-xs" />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <button onClick={handleSaveEditTransaction} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl">Save Changes</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default JournalLedger;
