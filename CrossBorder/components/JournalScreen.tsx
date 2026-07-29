import React, { useState, useEffect, useMemo } from 'react';
import { getJournalEntries, getChartOfAccounts, getPeriodCloses } from '../services/storageService';
import {
  getTrialBalance,
  postJournalEntry,
  createJournalEntry,
  reverseJournalEntry,
  closePeriod,
  runYearEndClose,
  periodFromDate,
  getPeriodStatus,
} from '../services/journalService';
import type { JournalEntry } from '../types';
import DesktopOnlyGate from './DesktopOnlyGate';

const PAGE_SIZE = 20;

const JournalScreen: React.FC = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [trialBalance, setTrialBalance] = useState<{ glAccountCode: string; accountName: string; debit: number; credit: number }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([{ glAccountCode: '1000', debit: 0, credit: 0 }, { glAccountCode: '4000', debit: 0, credit: 0 }]);
  const [page, setPage] = useState(1);
  const [periodFilter, setPeriodFilter] = useState(() => periodFromDate(new Date().toISOString().slice(0, 10)));
  const [toast, setToast] = useState('');

  const refresh = () => {
    setEntries(getJournalEntries());
    setTrialBalance(getTrialBalance(periodFilter));
  };

  useEffect(() => {
    refresh();
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, [periodFilter]);

  const chart = getChartOfAccounts();
  const periodStatus = useMemo(
    () => getPeriodStatus(periodFilter, getPeriodCloses()),
    [periodFilter, entries],
  );
  const formPeriod = periodFromDate(date);
  const formPeriodLocked = getPeriodStatus(formPeriod, getPeriodCloses()) === 'locked';

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const handlePost = (id: string) => {
    try {
      postJournalEntry(id);
      refresh();
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const handleReverse = (id: string) => {
    try {
      reverseJournalEntry(id);
      refresh();
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const handleCreate = () => {
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) { showToast('Debit must equal credit.'); return; }
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
      showToast((e as Error).message);
    }
  };

  const handleClosePeriod = () => {
    try {
      closePeriod(periodFilter, 'owner');
      showToast(`Period ${periodFilter} locked`);
      refresh();
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const handleYearEnd = () => {
    const year = Number(periodFilter.slice(0, 4));
    try {
      const result = runYearEndClose({ yearEndYear: year, closedBy: 'owner' });
      showToast(`Year-end ${year} closed · RE ₹${result.retainedEarningsAmount.toLocaleString('en-IN')}`);
      setPeriodFilter(`${year}-12`);
      refresh();
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const filteredEntries = entries.filter((e) => e.period === periodFilter);
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const pagedEntries = filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm font-medium text-white shadow-lg" style={{ background: 'var(--bg-sidebar)' }}>
          {toast}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Journal Entries</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {filteredEntries.length} entries in {periodFilter}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={periodFilter}
            onChange={(e) => { setPeriodFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
          <span
            className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
            style={{
              background: periodStatus === 'locked' ? 'rgba(220,38,38,0.12)' : 'rgba(16,185,129,0.12)',
              color: periodStatus === 'locked' ? '#b91c1c' : '#047857',
            }}
          >
            {periodStatus === 'locked' ? 'Locked' : 'Open'}
          </span>
          <button
            type="button"
            disabled={periodStatus === 'locked'}
            onClick={handleClosePeriod}
            className="font-heading px-3 py-2 rounded-xl text-xs font-semibold border disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            Close period
          </button>
          <button
            type="button"
            onClick={handleYearEnd}
            className="font-heading px-3 py-2 rounded-xl text-xs font-semibold border"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            Year-end close
          </button>
          <DesktopOnlyGate feature="Journal entry">
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              disabled={formPeriodLocked && !showForm}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 desktop-only-entry"
              style={{ background: 'var(--bg-sidebar)' }}
            >
              {showForm ? 'Cancel' : '+ New Entry'}
            </button>
          </DesktopOnlyGate>
        </div>
      </div>
      <DesktopOnlyGate feature="Journal entry">
      {showForm && (
        <div className="p-6 rounded-2xl border-2 space-y-4 desktop-only-entry" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          {formPeriodLocked && (
            <p className="text-sm text-rose-600 font-medium">Period {formPeriod} is locked — choose an open date.</p>
          )}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-4 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
          <input type="text" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full px-4 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
          {lines.map((line, i) => (
            <div key={i} className="flex gap-4 items-center flex-wrap">
              <select value={line.glAccountCode} onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, glAccountCode: e.target.value } : l)))} className="px-4 py-2 rounded-lg border text-sm flex-1 min-w-[160px]" style={{ borderColor: 'var(--border-subtle)' }}>
                {chart.map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
              </select>
              <input type="number" min={0} step={0.01} value={line.debit || ''} onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, debit: Number(e.target.value) || 0, credit: 0 } : l)))} placeholder="Debit" className="w-28 px-4 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
              <input type="number" min={0} step={0.01} value={line.credit || ''} onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, credit: Number(e.target.value) || 0, debit: 0 } : l)))} placeholder="Credit" className="w-28 px-4 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)' }} />
            </div>
          ))}
          <button type="button" onClick={handleCreate} disabled={formPeriodLocked} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40" style={{ background: 'var(--bg-sidebar)' }}>Save draft</button>
        </div>
      )}
      </DesktopOnlyGate>

      <div className="rounded-2xl border overflow-hidden table-scroll" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--bg-elevated)' }}>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              <th className="px-4 py-3">Number</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedEntries.map((e) => (
              <tr key={e.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="px-4 py-3 font-mono text-xs">{e.number}</td>
                <td className="px-4 py-3">{e.date}</td>
                <td className="px-4 py-3">{e.description}</td>
                <td className="px-4 py-3">{e.status}</td>
                <td className="px-4 py-3 space-x-2">
                  {e.status === 'Draft' && (
                    <button type="button" onClick={() => handlePost(e.id)} className="text-xs font-semibold text-emerald-700">Post</button>
                  )}
                  {e.status === 'Posted' && (
                    <button type="button" onClick={() => handleReverse(e.id)} className="text-xs font-semibold text-rose-700">Reverse</button>
                  )}
                </td>
              </tr>
            ))}
            {pagedEntries.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No entries for this period</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded border text-xs disabled:opacity-40">Prev</button>
          <span className="text-xs self-center">{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded border text-xs disabled:opacity-40">Next</button>
        </div>
      )}

      <div>
        <h2 className="font-heading text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Trial Balance · {periodFilter}</h2>
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg-elevated)' }}>
              <tr className="text-left text-[11px] uppercase" style={{ color: 'var(--text-muted)' }}>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2 text-right">Debit</th>
                <th className="px-4 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {trialBalance.map((l) => (
                <tr key={l.glAccountCode} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-4 py-2">{l.glAccountCode} · {l.accountName}</td>
                  <td className="px-4 py-2 text-right font-mono">{l.debit.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2 text-right font-mono">{l.credit.toLocaleString('en-IN')}</td>
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
