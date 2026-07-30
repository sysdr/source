/** ADR-003 — legacy Stripe ledger id migration */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  migrateLegacyStripeTransactionIds,
  migrateStripeTransactionRow,
} from './migrateStripeTransactionIds';
import { getTransactions, setTransactions, setRevenueData, getRevenueData } from './storageService';
import type { Transaction } from '../types';

function stripeTx(partial: Partial<Transaction> & { id: string }): Transaction {
  return {
    date: '2026-01-01',
    description: 't',
    amount: 10,
    currency: 'USD',
    source: 'Stripe',
    status: 'Completed',
    category: 'One-time',
    type: 'Income',
    ...partial,
  };
}

describe('migrateStripeTransactionIds', () => {
  beforeEach(() => {
    setTransactions([]);
    setRevenueData({ transactions: [], lastSyncDate: null, startDate: '2026-01-01', endDate: '2026-12-31' }, { force: true });
  });

  it('rewrites ch_* ledger ids to stripe_ch_*', () => {
    const row = migrateStripeTransactionRow(stripeTx({ id: 'ch_abc', stripeChargeId: 'ch_abc' }));
    expect(row.id).toBe('stripe_ch_abc');
    expect(row.stripeChargeId).toBe('ch_abc');
  });

  it('migrates storage and collapses duplicate legacy/canonical pairs', () => {
    setTransactions([
      stripeTx({ id: 'ch_1', stripeChargeId: 'ch_1', amount: 1 }),
      stripeTx({ id: 'stripe_ch_1', stripeChargeId: 'ch_1', amount: 2, lastSyncedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    setRevenueData({
      transactions: [stripeTx({ id: 'ch_2', stripeChargeId: 'ch_2' })],
      lastSyncDate: null,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    }, { force: true });

    const result = migrateLegacyStripeTransactionIds();
    expect(result.ledgerUpdated).toBeGreaterThan(0);
    const ledger = getTransactions();
    expect(ledger.some((t) => t.id === 'ch_1')).toBe(false);
    expect(ledger.find((t) => t.id === 'stripe_ch_1')?.amount).toBe(2);
    expect(getRevenueData().transactions.every((t) => t.id.startsWith('stripe_'))).toBe(true);
  });
});
