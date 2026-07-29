import { describe, expect, it } from 'vitest';
import {
  importAndMatchIndianBankCSV,
  parseIndianBankStatementCSV,
} from './bankStatementMatch';

describe('bankStatementMatch (REQ-079 / T-026)', () => {
  it('parses standard debit/credit/balance CSV', () => {
    const csv = [
      'Date,Description,Debit,Credit,Balance',
      '15/01/2026,NEFT SALARY CREDIT,,50000,150000',
      '16/01/2026,UPI VENDOR PAYMENT,2500,,147500',
    ].join('\n');
    const rows = parseIndianBankStatementCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-01-15',
      type: 'Income',
      credit: 50000,
      amount: 50000,
    });
    expect(rows[1]).toMatchObject({
      date: '2026-01-16',
      type: 'Expense',
      debit: 2500,
      amount: 2500,
    });
  });

  it('matches ledger by amount and date window; leaves unmatched for categorisation', () => {
    const csv = [
      'date,description,debit,credit,balance',
      '2026-03-01,Stripe payout,,10000,10000',
      '2026-03-02,Unknown UPI,500,,9500',
    ].join('\n');
    const ledger = [
      {
        id: 'tx-1',
        date: '2026-03-01',
        description: 'Stripe settlement',
        amount: 10000,
        type: 'Income' as const,
        source: 'Stripe' as const,
        status: 'Completed' as const,
      },
    ];
    const report = importAndMatchIndianBankCSV(csv, ledger);
    expect(report.matchedCount).toBe(1);
    expect(report.unmatchedCount).toBe(1);
    expect(report.matches[0].matchedTransactionId).toBe('tx-1');
    expect(report.suggestedTransactions).toHaveLength(1);
    expect(report.suggestedTransactions[0].source).toBe('IndianBank');
    expect(report.suggestedTransactions[0].amount).toBe(500);
  });
});
