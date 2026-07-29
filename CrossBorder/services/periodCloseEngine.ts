/**
 * Period-close lock + year-end closing entries (REQ-015, REQ-060 / T-022).
 * Pure functions — no storage side effects.
 */
import type { GLAccount, JournalEntry, JournalEntryLine, PeriodClose } from '../types';

export const RETAINED_EARNINGS_CODE = '3100';
export const RETAINED_EARNINGS_NAME = 'Retained Earnings';

export type PeriodStatus = 'open' | 'locked';

const PL_TYPES = new Set(['Income', 'Expense', 'Purchase']);

export function periodFromDate(date: string): string {
  const d = new Date(date.includes('T') ? date : `${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${date}`);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getPeriodStatus(period: string, closes: PeriodClose[]): PeriodStatus {
  return closes.some((p) => p.period === period && p.locked) ? 'locked' : 'open';
}

export function assertPeriodOpen(period: string, closes: PeriodClose[]): void {
  if (getPeriodStatus(period, closes) === 'locked') {
    throw new Error(`Period ${period} is locked; no journal entries may be posted`);
  }
}

export function buildPeriodCloseRecord(period: string, closedBy?: string): PeriodClose {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('period must be YYYY-MM');
  }
  return {
    id: `pc-${period}`,
    period,
    closedAt: new Date().toISOString(),
    closedBy,
    locked: true,
  };
}

/** Calendar months for a fiscal year ending in `yearEndMonth` (1–12) of `yearEndYear`. */
export function periodsInFiscalYear(yearEndYear: number, yearEndMonth = 12): string[] {
  const periods: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(yearEndYear, yearEndMonth - 1 - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    periods.push(`${y}-${m}`);
  }
  return periods;
}

export interface TrialBalanceLine {
  glAccountCode: string;
  accountName: string;
  accountType?: GLAccount['type'];
  debit: number;
  credit: number;
  /** debit − credit (expense-like positive when debit-heavy) */
  net: number;
}

export function computeTrialBalance(
  entries: JournalEntry[],
  chart: GLAccount[],
  periodFilter?: string | string[],
): TrialBalanceLine[] {
  const periods = periodFilter == null
    ? null
    : Array.isArray(periodFilter)
      ? new Set(periodFilter)
      : new Set([periodFilter]);

  const byAccount: Record<string, { debit: number; credit: number }> = {};
  for (const je of entries) {
    if (je.status !== 'Posted') continue;
    if (periods && !periods.has(je.period)) continue;
    for (const line of je.lines) {
      if (!byAccount[line.glAccountCode]) byAccount[line.glAccountCode] = { debit: 0, credit: 0 };
      byAccount[line.glAccountCode].debit += line.debit;
      byAccount[line.glAccountCode].credit += line.credit;
    }
  }

  return Object.entries(byAccount).map(([code, { debit, credit }]) => {
    const acct = chart.find((a) => a.code === code);
    return {
      glAccountCode: code,
      accountName: acct?.name ?? code,
      accountType: acct?.type,
      debit: round2(debit),
      credit: round2(credit),
      net: round2(debit - credit),
    };
  });
}

export interface YearEndCloseInput {
  entries: JournalEntry[];
  chart: GLAccount[];
  yearEndYear: number;
  yearEndMonth?: number;
  currency?: 'INR' | 'USD';
  closedBy?: string;
  nextJournalNumber: string;
}

export interface YearEndCloseResult {
  closingEntry: JournalEntry;
  periodClose: PeriodClose;
  lockedPeriods: PeriodClose[];
  retainedEarningsAmount: number;
  plAccountsClosed: number;
}

/**
 * Build year-end closing JE: zero P&L (Income/Expense/Purchase) into Retained Earnings,
 * then lock all fiscal-year months (final month gets the closing entry date).
 */
export function buildYearEndClose(input: YearEndCloseInput): YearEndCloseResult {
  const yearEndMonth = input.yearEndMonth ?? 12;
  const periods = periodsInFiscalYear(input.yearEndYear, yearEndMonth);
  const yearEndPeriod = periods[periods.length - 1];
  const currency = input.currency ?? 'INR';
  const chart = ensureRetainedEarnings(input.chart);

  const tb = computeTrialBalance(input.entries, chart, periods);
  const plLines = tb.filter((l) => l.accountType && PL_TYPES.has(l.accountType) && Math.abs(l.net) > 0.005);

  if (plLines.length === 0) {
    throw new Error('No P&L balances to close for the selected fiscal year');
  }

  const jeLines: JournalEntryLine[] = [];
  let idx = 0;
  let reDebit = 0;
  let reCredit = 0;

  for (const line of plLines) {
    // Income: credit-heavy (net negative) → debit Income to zero, credit RE
    // Expense/Purchase: debit-heavy (net positive) → credit Expense to zero, debit RE
    if (line.accountType === 'Income') {
      const amount = round2(Math.abs(line.net));
      if (line.net < 0) {
        // net = debit - credit < 0 means credit balance
        jeLines.push(lineRow(idx++, line.glAccountCode, amount, 0, currency, `Close ${line.accountName}`));
        reCredit += amount;
      } else {
        jeLines.push(lineRow(idx++, line.glAccountCode, 0, amount, currency, `Close ${line.accountName}`));
        reDebit += amount;
      }
    } else {
      const amount = round2(Math.abs(line.net));
      if (line.net > 0) {
        jeLines.push(lineRow(idx++, line.glAccountCode, 0, amount, currency, `Close ${line.accountName}`));
        reDebit += amount;
      } else {
        jeLines.push(lineRow(idx++, line.glAccountCode, amount, 0, currency, `Close ${line.accountName}`));
        reCredit += amount;
      }
    }
  }

  const reNetDebit = round2(reDebit);
  const reNetCredit = round2(reCredit);
  if (reNetCredit > reNetDebit) {
    // Net profit → credit Retained Earnings
    jeLines.push(lineRow(
      idx++,
      RETAINED_EARNINGS_CODE,
      0,
      round2(reNetCredit - reNetDebit),
      currency,
      'Year-end transfer to Retained Earnings',
    ));
  } else if (reNetDebit > reNetCredit) {
    // Net loss → debit Retained Earnings
    jeLines.push(lineRow(
      idx++,
      RETAINED_EARNINGS_CODE,
      round2(reNetDebit - reNetCredit),
      0,
      currency,
      'Year-end transfer to Retained Earnings',
    ));
  }

  const totalDebit = round2(jeLines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(jeLines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.02) {
    throw new Error(`Closing entry does not balance: debit ${totalDebit} credit ${totalCredit}`);
  }

  const now = new Date().toISOString();
  const closingDate = `${yearEndPeriod}-28`;
  const closingEntry: JournalEntry = {
    id: `je-ye-${input.yearEndYear}-${Date.now()}`,
    number: input.nextJournalNumber,
    date: closingDate,
    period: yearEndPeriod,
    description: `Year-end closing entries FY${input.yearEndYear}`,
    lines: jeLines,
    status: 'Posted',
    createdAt: now,
    postedAt: now,
    createdBy: input.closedBy,
  };

  const lockedPeriods = periods.map((p) => buildPeriodCloseRecord(p, input.closedBy));
  const retainedEarningsAmount = round2(reNetCredit - reNetDebit);

  return {
    closingEntry,
    periodClose: lockedPeriods[lockedPeriods.length - 1],
    lockedPeriods,
    retainedEarningsAmount,
    plAccountsClosed: plLines.length,
  };
}

export function ensureRetainedEarnings(chart: GLAccount[]): GLAccount[] {
  if (chart.some((a) => a.code === RETAINED_EARNINGS_CODE)) return chart;
  return [
    ...chart,
    { code: RETAINED_EARNINGS_CODE, name: RETAINED_EARNINGS_NAME, type: 'Equity' },
  ];
}

function lineRow(
  idx: number,
  code: string,
  debit: number,
  credit: number,
  currency: 'INR' | 'USD',
  description: string,
): JournalEntryLine {
  return {
    id: `jel-ye-${Date.now()}-${idx}`,
    glAccountCode: code,
    description,
    debit: round2(debit),
    credit: round2(credit),
    currency,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
