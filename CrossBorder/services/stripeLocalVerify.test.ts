/** Unit tests for Stripe ↔ local field verification */
import { describe, expect, it } from 'vitest';
import {
  compareChargeToLocal,
  verifyStripeChargesAgainstLocal,
  mapStripeStatusToLocal,
} from './stripeLocalVerify';

describe('stripeLocalVerify', () => {
  it('maps refunded charges to Refunded', () => {
    expect(mapStripeStatusToLocal({
      id: 'ch_1', amount: 1000, currency: 'usd', created: 1, refunded: true, status: 'succeeded',
    })).toBe('Refunded');
  });

  it('matches when original amount/currency/date/status agree', () => {
    const created = Math.floor(Date.UTC(2026, 2, 25, 12, 0, 0) / 1000);
    const row = compareChargeToLocal(
      {
        id: 'ch_ok',
        amount: 1999,
        currency: 'usd',
        created,
        status: 'succeeded',
      },
      {
        id: 'stripe_ch_ok',
        stripeChargeId: 'ch_ok',
        date: '2026-03-25',
        status: 'Completed',
        amount: 1669,
        currency: 'INR',
        originalAmount: 19.99,
        originalCurrency: 'USD',
      },
    );
    expect(row.outcome).toBe('matched');
    expect(row.mismatches).toEqual([]);
  });

  it('flags originalAmount and status mismatches', () => {
    const row = compareChargeToLocal(
      {
        id: 'ch_bad',
        amount: 2000,
        currency: 'usd',
        created: Date.UTC(2026, 0, 1) / 1000,
        status: 'succeeded',
      },
      {
        id: 'stripe_ch_bad',
        stripeChargeId: 'ch_bad',
        date: '2026-01-01',
        status: 'Pending',
        amount: 20,
        currency: 'USD',
        originalAmount: 15,
        originalCurrency: 'USD',
      },
    );
    expect(row.outcome).toBe('mismatch');
    expect(row.mismatches.map((m) => m.field).sort()).toEqual(['originalAmount', 'status']);
  });

  it('matches fully refunded charges with zeroed local originalAmount', () => {
    const created = Math.floor(Date.UTC(2026, 2, 9, 12, 0, 0) / 1000);
    const row = compareChargeToLocal(
      {
        id: 'ch_ref',
        amount: 3900,
        amount_refunded: 3900,
        currency: 'usd',
        created,
        status: 'succeeded',
        refunded: true,
      },
      {
        id: 'ch_ref',
        stripeChargeId: 'ch_ref',
        date: '2026-03-09',
        status: 'Refunded',
        amount: 0,
        currency: 'INR',
        originalAmount: 0,
        originalCurrency: 'USD',
      },
    );
    expect(row.outcome).toBe('matched');
  });

  it('reports missing local / missing stripe in aggregate', () => {
    const report = verifyStripeChargesAgainstLocal({
      orgId: 'o1',
      charges: [
        { id: 'ch_a', amount: 100, currency: 'usd', created: 1_700_000_000, status: 'succeeded' },
        { id: 'ch_b', amount: 200, currency: 'usd', created: 1_700_000_100, status: 'succeeded' },
      ],
      localTransactions: [
        {
          id: 'stripe_ch_a',
          stripeChargeId: 'ch_a',
          date: '2023-11-14',
          status: 'Completed',
          amount: 1,
          currency: 'USD',
          originalAmount: 1,
          originalCurrency: 'USD',
        },
        {
          id: 'ch_only_local',
          stripeChargeId: 'ch_only_local',
          date: '2023-11-14',
          status: 'Completed',
          amount: 1,
          currency: 'USD',
          originalAmount: 1,
          originalCurrency: 'USD',
        },
      ],
    });
    expect(report.matched).toBe(1);
    expect(report.missingLocal).toBe(1);
    expect(report.missingStripe).toBe(1);
  });
});
