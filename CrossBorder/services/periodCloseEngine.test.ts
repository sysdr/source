import { describe, expect, it } from 'vitest';
import type { GLAccount, JournalEntry } from '../types';
import {
  RETAINED_EARNINGS_CODE,
  assertPeriodOpen,
  buildPeriodCloseRecord,
  buildYearEndClose,
  computeTrialBalance,
  getPeriodStatus,
  periodsInFiscalYear,
} from './periodCloseEngine';

const chart: GLAccount[] = [
  { code: '4000', name: 'Revenue', type: 'Income' },
  { code: '6200', name: 'Payroll', type: 'Expense' },
  { code: '1000', name: 'Bank/Cash', type: 'Asset' },
  { code: RETAINED_EARNINGS_CODE, name: 'Retained Earnings', type: 'Equity' },
];

function posted(
  partial: Pick<JournalEntry, 'id' | 'period' | 'date' | 'lines'> & Partial<JournalEntry>,
): JournalEntry {
  return {
    number: 'JE-25-0001',
    description: 'seed',
    status: 'Posted',
    createdAt: '2025-06-01T00:00:00.000Z',
    postedAt: '2025-06-01T00:00:00.000Z',
    ...partial,
  };
}

describe('periodCloseEngine (REQ-060 / T-022)', () => {
  it('reports open vs locked period status', () => {
    expect(getPeriodStatus('2025-06', [])).toBe('open');
    const closed = buildPeriodCloseRecord('2025-06', 'owner');
    expect(closed.locked).toBe(true);
    expect(getPeriodStatus('2025-06', [closed])).toBe('locked');
    expect(() => assertPeriodOpen('2025-06', [closed])).toThrow(/locked/i);
  });

  it('lists 12 periods for a calendar fiscal year', () => {
    expect(periodsInFiscalYear(2025, 12)).toEqual([
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
    ]);
  });

  it('builds year-end closing JE that zeros P&L into Retained Earnings', () => {
    const entries: JournalEntry[] = [
      posted({
        id: 'je-1',
        period: '2025-03',
        date: '2025-03-15',
        lines: [
          { id: 'l1', glAccountCode: '1000', debit: 10000, credit: 0, currency: 'INR' },
          { id: 'l2', glAccountCode: '4000', debit: 0, credit: 10000, currency: 'INR' },
        ],
      }),
      posted({
        id: 'je-2',
        period: '2025-08',
        date: '2025-08-10',
        lines: [
          { id: 'l3', glAccountCode: '6200', debit: 3000, credit: 0, currency: 'INR' },
          { id: 'l4', glAccountCode: '1000', debit: 0, credit: 3000, currency: 'INR' },
        ],
      }),
    ];

    const result = buildYearEndClose({
      entries,
      chart,
      yearEndYear: 2025,
      yearEndMonth: 12,
      nextJournalNumber: 'JE-25-0099',
    });

    expect(result.plAccountsClosed).toBe(2);
    expect(result.retainedEarningsAmount).toBe(7000);
    expect(result.closingEntry.status).toBe('Posted');
    expect(result.closingEntry.period).toBe('2025-12');
    expect(result.lockedPeriods).toHaveLength(12);
    expect(result.lockedPeriods.every((p) => p.locked)).toBe(true);

    const after = computeTrialBalance(
      [...entries, result.closingEntry],
      chart,
      periodsInFiscalYear(2025, 12),
    );
    const revenue = after.find((l) => l.glAccountCode === '4000');
    const payroll = after.find((l) => l.glAccountCode === '6200');
    const re = after.find((l) => l.glAccountCode === RETAINED_EARNINGS_CODE);
    expect(revenue?.net ?? 0).toBeCloseTo(0, 1);
    expect(payroll?.net ?? 0).toBeCloseTo(0, 1);
    expect(re?.net ?? 0).toBeCloseTo(-7000, 1); // credit balance → net negative
  });
});
