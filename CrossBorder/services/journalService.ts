/**
 * Journal entries, period close, trial balance (R2R) — REQ-015 / REQ-060.
 */

import type { JournalEntry, JournalEntryLine, PeriodClose, GLAccount } from '../types';
import {
  getJournalEntries,
  addJournalEntry,
  updateJournalEntry,
  getPeriodCloses,
  addPeriodClose,
  setPeriodCloses,
  getChartOfAccounts,
  setJournalEntries,
} from './storageService';
import {
  assertPeriodOpen,
  buildPeriodCloseRecord,
  buildYearEndClose,
  computeTrialBalance,
  ensureRetainedEarnings,
  getPeriodStatus,
  periodFromDate,
  RETAINED_EARNINGS_CODE,
  type PeriodStatus,
  type TrialBalanceLine,
} from './periodCloseEngine';

export {
  getPeriodStatus,
  periodFromDate,
  RETAINED_EARNINGS_CODE,
  type PeriodStatus,
  type TrialBalanceLine,
};

const JE_PREFIX = 'JE';
const YEAR_DIGITS = 2;

function nextJournalNumber(entries: JournalEntry[] = getJournalEntries()): string {
  const year = String(new Date().getFullYear()).slice(-YEAR_DIGITS);
  const sameYear = entries.filter((i) => i.number.startsWith(`${JE_PREFIX}-${year}`));
  const maxNum = sameYear.reduce((max, i) => {
    const n = parseInt(i.number.split('-')[2] || '0', 10);
    return n > max ? n : max;
  }, 0);
  return `${JE_PREFIX}-${year}-${String(maxNum + 1).padStart(4, '0')}`;
}

export interface CreateJournalEntryInput {
  date: string;
  description: string;
  lines: {
    glAccountCode: string;
    description?: string;
    debit: number;
    credit: number;
    currency: 'USD' | 'INR';
    entity?: 'parent' | 'subsidiary';
  }[];
  createdBy?: string;
}

export function createJournalEntry(input: CreateJournalEntryInput): JournalEntry {
  const totalDebit = input.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = input.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('Journal entry must balance: total debit must equal total credit.');
  }

  const period = periodFromDate(input.date);
  assertPeriodOpen(period, getPeriodCloses());

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
    period,
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
  assertPeriodOpen(je.period, getPeriodCloses());
  updateJournalEntry(id, { status: 'Posted', postedAt: new Date().toISOString() });
}

export function reverseJournalEntry(id: string): JournalEntry | null {
  const je = getJournalEntries().find((e) => e.id === id);
  if (!je || je.status !== 'Posted') return null;

  const now = new Date().toISOString();
  const period = periodFromDate(now);
  assertPeriodOpen(period, getPeriodCloses());
  assertPeriodOpen(je.period, getPeriodCloses());

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
    period,
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
  const pc = buildPeriodCloseRecord(period, closedBy);
  addPeriodClose(pc);
  return pc;
}

export function isPeriodClosed(period: string): boolean {
  return getPeriodStatus(period, getPeriodCloses()) === 'locked';
}

export function getTrialBalance(period?: string): TrialBalanceLine[] {
  return computeTrialBalance(getJournalEntries(), getChartOfAccounts(), period);
}

/**
 * Year-end close: post closing JE (P&L → Retained Earnings) and lock all FY months.
 */
export function runYearEndClose(input: {
  yearEndYear: number;
  yearEndMonth?: number;
  currency?: 'INR' | 'USD';
  closedBy?: string;
}): ReturnType<typeof buildYearEndClose> {
  const closes = getPeriodCloses();
  const yearEndMonth = input.yearEndMonth ?? 12;
  const yearEndPeriod = `${input.yearEndYear}-${String(yearEndMonth).padStart(2, '0')}`;
  assertPeriodOpen(yearEndPeriod, closes);

  const chart = ensureRetainedEarnings(getChartOfAccounts());
  const entries = getJournalEntries();
  const result = buildYearEndClose({
    entries,
    chart,
    yearEndYear: input.yearEndYear,
    yearEndMonth,
    currency: input.currency,
    closedBy: input.closedBy,
    nextJournalNumber: nextJournalNumber(entries),
  });

  const existingPeriods = new Set(closes.map((c) => c.period));
  const newCloses = result.lockedPeriods.filter((p) => !existingPeriods.has(p.period));
  setPeriodCloses([...closes, ...newCloses]);
  setJournalEntries([result.closingEntry, ...entries]);
  return result;
}

export function listPeriodStatuses(periods: string[]): Array<{ period: string; status: PeriodStatus }> {
  const closes = getPeriodCloses();
  return periods.map((period) => ({ period, status: getPeriodStatus(period, closes) }));
}

/** Ensure default chart includes Retained Earnings (idempotent). */
export function ensureDefaultRetainedEarningsAccount(chart: GLAccount[]): GLAccount[] {
  return ensureRetainedEarnings(chart);
}
