import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import {
  buildThreeWayReconciliation,
  reconcileGstr2bItc,
  reconcileLedgerBank,
  reconcileStripeMercury,
} from './threeWayReconciliation';

function tx(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'source' | 'type' | 'amount'>): Transaction {
  return {
    date: '2026-03-01',
    description: 'Test',
    currency: 'INR',
    category: 'Services',
    status: 'Completed',
    ...partial,
  } as Transaction;
}

describe('threeWayReconciliation (REQ-058 / T-023)', () => {
  it('matches Stripe income to Mercury credit', () => {
    const pane = reconcileStripeMercury([
      tx({ id: 's1', source: 'Stripe', type: 'Income', amount: 5000, description: 'Charge', date: '2026-03-01' }),
      tx({ id: 'm1', source: 'Mercury', type: 'Income', amount: 5000, description: 'Payout', date: '2026-03-02' }),
      tx({ id: 's2', source: 'Stripe', type: 'Income', amount: 100, date: '2026-03-10' }),
    ]);
    expect(pane.matched).toBe(1);
    expect(pane.unmatched).toBe(1);
  });

  it('matches ledger to Indian bank import', () => {
    const pane = reconcileLedgerBank([
      tx({ id: 'l1', source: 'Manual', type: 'Expense', amount: 800, date: '2026-04-02' }),
      tx({ id: 'b1', source: 'IndianBank', type: 'Expense', amount: 800, date: '2026-04-02', description: 'UPI' }),
    ]);
    expect(pane.matched).toBe(1);
    expect(pane.unmatched).toBe(0);
  });

  it('flags purchase ITC as unmatched without GSTR-2B claims', () => {
    const pane = reconcileGstr2bItc([
      tx({
        id: 'p1',
        source: 'Manual',
        type: 'Purchase',
        amount: 10000,
        itcEligible: true,
        gstRate: 18,
        gstImpact: 1800,
      }),
    ]);
    expect(pane.unmatched).toBe(1);
    expect(pane.items[0].left?.amount).toBe(1800);
  });

  it('builds full three-way report', () => {
    const report = buildThreeWayReconciliation({
      transactions: [
        tx({ id: 's1', source: 'Stripe', type: 'Income', amount: 1000 }),
        tx({ id: 'm1', source: 'Mercury', type: 'Income', amount: 1000 }),
      ],
      gstr2bClaims: [],
    });
    expect(report.stripeMercury.matched).toBe(1);
    expect(report.generatedAt).toBeTruthy();
  });
});
