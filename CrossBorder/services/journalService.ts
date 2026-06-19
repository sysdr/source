/**
 * Journal entries, period close, trial balance (R2R).
 */

import type { JournalEntry, JournalEntryLine, JournalEntryStatus, PeriodClose, GLAccount } from '../types';
import { getJournalEntries, addJournalEntry, updateJournalEntry, getPeriodCloses, addPeriodClose, getChartOfAccounts } from './storageService';

const JE_PREFIX = 'JE';
const YEAR_DIGITS = 2;

function nextJournalNumber(): string {
  const list = getJournalEntries();
  const year = String(new Date().getFullYear()).slice(-YEAR_DIGITS);
  const sameYear = list.filter((i) => i.number.startsWith(`${JE_PREFIX}-${year}`));
  const maxNum = sameYear.reduce((max, i) => {
    const n = parseInt(i.number.split('-')[2] || '0', 10);
    return n > max ? n : max;
  }, 0);
  return `${JE_PREFIX}-${year}-${String(maxNum + 1).padStart(4, '0')}`;
}

function periodFromDate(date: string): string {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export interface CreateJournalEntryInput {
  date: string;
  description: string;
  lines: { glAccountCode: string; description?: string; debit: number; credit: number; currency: 'USD' | 'INR'; entity?: 'parent' | 'subsidiary' }[];
  createdBy?: string;
}

export function createJournalEntry(input: CreateJournalEntryInput): JournalEntry {
  const totalDebit = input.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = input.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('Journal entry must balance: total debit must equal total credit.');
  }

  const now = new Date().toISOString();
  const jeLines: JournalEntryLine[] = input.lines.map((l, idx) => ({
    id: `jel-${Date.now()}-${idx}`,
    glAccountCode: l.glAccountCode,
    description: l.description,
    debit: l.debit,
    credit: l.credit,
    currency: l.currency,
    entity: l.entity,
  }));

  const je: JournalEntry = {
    id: `je-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    number: nextJournalNumber(),
    date: input.date,
    period: periodFromDate(input.date),
    description: input.description,
    lines: jeLines,
    status: 'Draft',
    createdAt: now,
    createdBy: input.createdBy,
  };
  addJournalEntry(je);
  return je;
}

export function postJournalEntry(id: string): void {
  const je = getJournalEntries().find((e) => e.id === id);
  if (!je) return;
  if (je.status !== 'Draft') return;
  updateJournalEntry(id, { status: 'Posted', postedAt: new Date().toISOString() });
}

export function reverseJournalEntry(id: string): JournalEntry | null {
  const je = getJournalEntries().find((e) => e.id === id);
  if (!je || je.status !== 'Posted') return null;

  const now = new Date().toISOString();
  const reversedLines: JournalEntryLine[] = je.lines.map((l) => ({
    ...l,
    id: `jel-${Date.now()}-${l.id}`,
    debit: l.credit,
    credit: l.debit,
  }));

  const reversal: JournalEntry = {
    id: `je-rev-${Date.now()}`,
    number: nextJournalNumber(),
    date: now.slice(0, 10),
    period: periodFromDate(now),
    description: `Reversal of ${je.number}: ${je.description}`,
    lines: reversedLines,
    status: 'Posted',
    createdAt: now,
    postedAt: now,
    reversedAt: now,
    reversalOfId: id,
  };
  addJournalEntry(reversal);
  updateJournalEntry(id, { status: 'Reversed', reversedAt: now });
  return reversal;
}

export function closePeriod(period: string, closedBy?: string): PeriodClose {
  const existing = getPeriodCloses().find((p) => p.period === period);
  if (existing) throw new Error(`Period ${period} is already closed.`);
  const now = new Date().toISOString();
  const pc: PeriodClose = {
    id: `pc-${period}`,
    period,
    closedAt: now,
    closedBy,
    locked: true,
  };
  addPeriodClose(pc);
  return pc;
}

export function isPeriodClosed(period: string): boolean {
  return getPeriodCloses().some((p) => p.period === period && p.locked);
}

export interface TrialBalanceLine {
  glAccountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export function getTrialBalance(period?: string): TrialBalanceLine[] {
  const entries = getJournalEntries().filter((e) => e.status === 'Posted' && (period ? e.period === period : true));
  const chart = getChartOfAccounts();
  const byAccount: Record<string, { debit: number; credit: number }> = {};

  for (const je of entries) {
    for (const line of je.lines) {
      if (!byAccount[line.glAccountCode]) byAccount[line.glAccountCode] = { debit: 0, credit: 0 };
      byAccount[line.glAccountCode].debit += line.debit;
      byAccount[line.glAccountCode].credit += line.credit;
    }
  }

  return Object.entries(byAccount).map(([code, { debit, credit }]) => ({
    glAccountCode: code,
    accountName: chart.find((a) => a.code === code)?.name ?? code,
    debit,
    credit,
  }));
}
