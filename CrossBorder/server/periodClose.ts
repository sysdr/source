/**
 * Server-side period close + journal helpers (REQ-060 / T-022).
 * Persists via org_data keys journalEntries / periodCloses.
 */
import { getOrgData, setOrgData } from './db.js';
import type { CompanyProfile, GLAccount, JournalEntry, PeriodClose } from '../types.js';
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
} from '../services/periodCloseEngine.js';

const JOURNAL_KEY = 'journalEntries';
const PERIOD_CLOSE_KEY = 'periodCloses';
const PROFILE_KEY = 'suez_company_profile';

const DEFAULT_CHART: GLAccount[] = [
  { code: '4000', name: 'Revenue', type: 'Income' },
  { code: '4100', name: 'Other Income', type: 'Income' },
  { code: '5000', name: 'Cost of Sales', type: 'Purchase' },
  { code: '6100', name: 'SaaS & Hosting', type: 'Expense' },
  { code: '6200', name: 'Payroll', type: 'Expense' },
  { code: '6900', name: 'Other Expenses', type: 'Expense' },
  { code: '1000', name: 'Bank/Cash', type: 'Asset' },
  { code: '2000', name: 'Payables', type: 'Liability' },
  { code: '3000', name: 'Equity', type: 'Equity' },
  { code: RETAINED_EARNINGS_CODE, name: 'Retained Earnings', type: 'Equity' },
];

function loadJournals(orgId: string): JournalEntry[] {
  const raw = getOrgData(orgId, JOURNAL_KEY);
  return Array.isArray(raw) ? (raw as JournalEntry[]) : [];
}

function saveJournals(orgId: string, list: JournalEntry[]): void {
  setOrgData(orgId, JOURNAL_KEY, list);
}

function loadCloses(orgId: string): PeriodClose[] {
  const raw = getOrgData(orgId, PERIOD_CLOSE_KEY);
  return Array.isArray(raw) ? (raw as PeriodClose[]) : [];
}

function saveCloses(orgId: string, list: PeriodClose[]): void {
  setOrgData(orgId, PERIOD_CLOSE_KEY, list);
}

function loadChart(orgId: string): GLAccount[] {
  const profile = getOrgData(orgId, PROFILE_KEY) as CompanyProfile | null;
  const accounts = profile?.accounting?.glAccounts;
  if (accounts && accounts.length > 0) return ensureRetainedEarnings(accounts);
  return DEFAULT_CHART;
}

function nextJournalNumber(entries: JournalEntry[]): string {
  const year = String(new Date().getFullYear()).slice(-2);
  const sameYear = entries.filter((i) => i.number.startsWith(`JE-${year}`));
  const maxNum = sameYear.reduce((max, i) => {
    const n = parseInt(i.number.split('-')[2] || '0', 10);
    return n > max ? n : max;
  }, 0);
  return `JE-${year}-${String(maxNum + 1).padStart(4, '0')}`;
}

export function listPeriodCloses(orgId: string): PeriodClose[] {
  return loadCloses(orgId);
}

export function listJournals(orgId: string): JournalEntry[] {
  return loadJournals(orgId);
}

export function periodStatus(orgId: string, period: string): PeriodStatus {
  return getPeriodStatus(period, loadCloses(orgId));
}

export function closeAccountingPeriod(orgId: string, period: string, closedBy?: string): PeriodClose {
  const closes = loadCloses(orgId);
  if (closes.some((c) => c.period === period)) {
    throw new Error(`Period ${period} is already closed.`);
  }
  const pc = buildPeriodCloseRecord(period, closedBy);
  saveCloses(orgId, [...closes, pc]);
  return pc;
}

export function createAndOptionallyPostJournal(
  orgId: string,
  input: {
    date: string;
    description: string;
    lines: Array<{
      glAccountCode: string;
      debit: number;
      credit: number;
      currency?: 'INR' | 'USD';
      description?: string;
    }>;
    post?: boolean;
    createdBy?: string;
  },
): JournalEntry {
  const totalDebit = input.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = input.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('Journal entry must balance');
  }
  const period = periodFromDate(input.date);
  const closes = loadCloses(orgId);
  assertPeriodOpen(period, closes);

  const entries = loadJournals(orgId);
  const now = new Date().toISOString();
  const post = input.post !== false;
  const je: JournalEntry = {
    id: `je-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    number: nextJournalNumber(entries),
    date: input.date,
    period,
    description: input.description,
    lines: input.lines.map((l, idx) => ({
      id: `jel-${Date.now()}-${idx}`,
      glAccountCode: l.glAccountCode,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      currency: l.currency ?? 'INR',
    })),
    status: post ? 'Posted' : 'Draft',
    createdAt: now,
    postedAt: post ? now : undefined,
    createdBy: input.createdBy,
  };
  saveJournals(orgId, [je, ...entries]);
  return je;
}

export function postJournal(orgId: string, journalId: string): JournalEntry {
  const entries = loadJournals(orgId);
  const je = entries.find((e) => e.id === journalId);
  if (!je) throw new Error('Journal entry not found');
  if (je.status !== 'Draft') throw new Error('Only Draft entries can be posted');
  assertPeriodOpen(je.period, loadCloses(orgId));
  const updated: JournalEntry = {
    ...je,
    status: 'Posted',
    postedAt: new Date().toISOString(),
  };
  saveJournals(orgId, entries.map((e) => (e.id === journalId ? updated : e)));
  return updated;
}

export function runYearEndCloseForOrg(
  orgId: string,
  input: { yearEndYear: number; yearEndMonth?: number; closedBy?: string; currency?: 'INR' | 'USD' },
) {
  const closes = loadCloses(orgId);
  const yearEndMonth = input.yearEndMonth ?? 12;
  const yearEndPeriod = `${input.yearEndYear}-${String(yearEndMonth).padStart(2, '0')}`;
  assertPeriodOpen(yearEndPeriod, closes);

  const entries = loadJournals(orgId);
  const chart = loadChart(orgId);
  const result = buildYearEndClose({
    entries,
    chart,
    yearEndYear: input.yearEndYear,
    yearEndMonth,
    currency: input.currency,
    closedBy: input.closedBy,
    nextJournalNumber: nextJournalNumber(entries),
  });

  const existing = new Set(closes.map((c) => c.period));
  const mergedCloses = [
    ...closes,
    ...result.lockedPeriods.filter((p) => !existing.has(p.period)),
  ];
  saveCloses(orgId, mergedCloses);
  saveJournals(orgId, [result.closingEntry, ...entries]);
  return result;
}

export function trialBalanceForOrg(orgId: string, period?: string) {
  return computeTrialBalance(loadJournals(orgId), loadChart(orgId), period);
}
