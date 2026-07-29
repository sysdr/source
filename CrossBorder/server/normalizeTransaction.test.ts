import { describe, expect, it } from 'vitest';
import {
  classifyGstFromCountry,
  normalizeLedgerTransaction,
  normalizeStripeObject,
  RevenueClassification,
} from './normalizeTransaction';

describe('classifyGstFromCountry (REQ-006)', () => {
  it('marks India customers as OIDAR at 18%', () => {
    const gst = classifyGstFromCountry('IN', 1000);
    expect(gst.classification).toBe(RevenueClassification.OIDAR_RISK);
    expect(gst.gstRate).toBe(18);
    expect(gst.gstImpact).toBe(180);
    expect(gst.customerCountry).toBe('IN');
  });

  it('marks foreign customers as Export at 0%', () => {
    const gst = classifyGstFromCountry('US', 500);
    expect(gst.classification).toBe(RevenueClassification.EXPORT);
    expect(gst.gstRate).toBe(0);
    expect(gst.gstImpact).toBe(0);
  });
});

describe('normalizeStripeObject (T-016)', () => {
  it('produces a schema-valid canonical Stripe charge row', () => {
    const result = normalizeStripeObject({
      id: 'ch_abc123',
      amount: 15500,
      currency: 'usd',
      created: 1760000000,
      description: 'Webhook payment',
      status: 'succeeded',
      billing_details: {
        email: 'buyer@example.com',
        name: 'Buyer',
        address: { country: 'US' },
      },
      metadata: { type: 'Subscription' },
    }, { webhookEventId: 'evt_1', eventType: 'charge.succeeded' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.id).toBe('stripe_ch_abc123');
    expect(result.transaction.source).toBe('Stripe');
    expect(result.transaction.amount).toBe(155);
    expect(result.transaction.classification).toBe(RevenueClassification.EXPORT);
    expect(result.transaction.gstRate).toBe(0);
    expect(result.transaction.category).toBe('Subscription');
    expect(result.transaction.customerCountry).toBe('US');
    expect(result.transaction.webhookEventId).toBe('evt_1');
  });

  it('classifies Indian OIDAR charges with GST impact', () => {
    const result = normalizeStripeObject({
      id: 'ch_in_1',
      amount: 11800,
      currency: 'inr',
      created: 1760000000,
      status: 'succeeded',
      billing_details: { address: { country: 'IN' } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.classification).toBe(RevenueClassification.OIDAR_RISK);
    expect(result.transaction.gstRate).toBe(18);
    expect(result.transaction.gstImpact).toBe(21.24);
  });

  it('marks charge.refunded as Refunded status', () => {
    const result = normalizeStripeObject({
      id: 'ch_ref_1',
      amount: 5000,
      amount_refunded: 5000,
      currency: 'usd',
      created: 1760000000,
      status: 'succeeded',
      refunded: true,
      billing_details: { address: { country: 'US' } },
    }, { eventType: 'charge.refunded' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.status).toBe('Refunded');
  });
});

describe('normalizeLedgerTransaction', () => {
  it('fills missing GST fields for income rows', () => {
    const result = normalizeLedgerTransaction({
      id: 'manual-1',
      date: '2026-03-01',
      description: 'Consulting',
      amount: 1000,
      currency: 'INR',
      source: 'Manual',
      category: 'Services',
      status: 'Completed',
      type: 'Income',
      customerCountry: 'IN',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.gstRate).toBe(18);
    expect(result.transaction.classification).toBe(RevenueClassification.OIDAR_RISK);
  });
});
