import React, { useState, useEffect } from 'react';
import { getJournalEntries, getChartOfAccounts } from '../services/storageService';
import { getTrialBalance, postJournalEntry, createJournalEntry, reverseJournalEntry } from '../services/journalService';
import type { JournalEntry } from '../types';

const PAGE_SIZE = 20;

const JournalScreen: React.FC = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [trialBalance, setTrialBalance] = useState<{ glAccountCode: string; accountName: string; debit: number; credit: number }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([{ glAccountCode: '1000', debit: 0, credit: 0 }, { glAccountCode: '4000', debit: 0, credit: 0 }]);
  const [page, setPage] = useState(1);

  const refresh = () => {
    setEntries(getJournalEntries());
    setTrialBalance(getTrialBalance());
  };

  useEffect(() => {
    refresh();
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, []);

  const chart = getChartOfAccounts();

  const handlePost = (id: string) => {
    postJournalEntry(id);
    refresh();
  };

  const handleReverse = (id: string) => {
    reverseJournalEntry(id);
    refresh();
  };

  const handleCreate = () => {
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) { alert('Debit must equal credit.'); return; }
    try {
      createJournalEntry({
        date,
        description: desc || 'Manual entry',
        lines: lines.map((l) => ({ glAccountCode: l.glAccountCode, debit: l.debit, credit: l.credit, currency: 'INR' as const })),
      });
      setDesc(''); setLines([{ glAccountCode: '1000', debit: 0, credit: 0 }, { glAccountCode: '4000', debit: 0, credit: 0 }]);
      setShowForm(false);
      refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const pagedEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Journal Entries</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{entries.length} total entries</p>
        </div>
        <button type="button" onClick={() => setShowForm(!showForm)} className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>{showForm ? 'Cancel' : '+ New Entry'}</button>
      </div>
      {showForm && (
        <div className="p-6 rounded-2xl border-2 space-y-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-4 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
          <input type="text" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full px-4 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
          {lines.map((line, i) => (
            <div key={i} className="flex gap-4 items-center">
              <select value={line.glAccountCode} onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, glAccountCode: e.target.value } : l)))} className="px-4 py-2 rounded-lg border text-sm flex-1" style={{ borderColor: 'var(--border-subtle)' }}>
                {chart.map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
              </select>
              <input type="number" min={0} step={0.01} value={line.debit || ''} onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, debit: Number(e.target.value) || 0, credit: 0 } : l)))} placeholder="Debit" className="w-28 px-4 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
              <input type="number" min={0} step={0.01} value={line.credit || ''} onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, credit: Number(e.target.value) || 0, debit: 0 } : l)))} placeholder="Credit" className="w-28 px-4 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
            </div>
          ))}
          <button type="button" onClick={handleCreate} className="font-heading px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>Create & Post</button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <h2 className="font-heading text-lg font-semibold p-4 border-b" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>Entries</h2>
          <table className="w-full text-sm">
            <thead><tr style={{ background: 'var(--bg-page)' }}><th className="text-left py-2 px-4 font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>Number</th><th className="text-left py-2 px-4 font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>Date</th><th className="text-left py-2 px-4 font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>Status</th><th className="text-right py-2 px-4 font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>Action</th></tr></thead>
            <tbody>
              {pagedEntries.map((je) => (
                <tr key={je.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="py-2 px-4" style={{ color: 'var(--text-primary)' }}>{je.number}</td>
                  <td className="py-2 px-4" style={{ color: 'var(--text-secondary)' }}>{je.date}</td>
                  <td className="py-2 px-4"><span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{je.status}</span></td>
                  <td className="py-2 px-4 text-right flex gap-2 justify-end">
                    {je.status === 'Draft' && (
                      <button type="button" onClick={() => handlePost(je.id)} className="text-xs font-semibold" style={{ color: 'var(--bg-sidebar)' }}>Post</button>
                    )}
                    {je.status === 'Posted' && (
                      <button type="button" onClick={() => handleReverse(je.id)} className="text-xs font-semibold px-2 py-0.5 rounded-lg" style={{ background: '#fee2e2', color: '#dc2626' }}>Reverse</button>
                    )}
                  </td>
                </tr>
              ))}
              {pagedEntries.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No entries yet.</td></tr>
              )}
            </tbody>
          </table>
          {entries.length > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="font-heading px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
                Previous
              </button>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Page {page} of {totalPages} · {entries.length} entries</span>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="font-heading px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
                Next
              </button>
            </div>
          )}
        </div>
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <h2 className="font-heading text-lg font-semibold p-4 border-b" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>Trial Balance</h2>
          <table className="w-full text-sm">
            <thead><tr style={{ background: 'var(--bg-page)' }}><th className="text-left py-2 px-4 font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>Account</th><th className="text-right py-2 px-4 font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>Debit</th><th className="text-right py-2 px-4 font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>Credit</th></tr></thead>
            <tbody>
              {trialBalance.length === 0 ? <tr><td colSpan={3} className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No posted entries yet.</td></tr> : trialBalance.map((row) => (
                <tr key={row.glAccountCode} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="py-2 px-4" style={{ color: 'var(--text-primary)' }}>{row.glAccountCode} {row.accountName}</td>
                  <td className="py-2 px-4 text-right" style={{ color: 'var(--text-secondary)' }}>{row.debit > 0 ? row.debit.toLocaleString() : ''}</td>
                  <td className="py-2 px-4 text-right" style={{ color: 'var(--text-secondary)' }}>{row.credit > 0 ? row.credit.toLocaleString() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default JournalScreen;
