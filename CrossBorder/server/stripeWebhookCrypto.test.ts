/**
 * REQ-078 — Stripe webhook signature + canonical id helpers
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalStripeTransactionId,
  parseStripeSignatureHeader,
  verifyStripeWebhookSignature,
} from './stripeWebhookCrypto';

function sign(rawBody: string, secret: string, timestamp: number): string {
  const payload = `${timestamp}.${rawBody}`;
  const v1 = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

describe('stripeWebhookCrypto', () => {
  it('parses Stripe-Signature headers', () => {
    expect(parseStripeSignatureHeader('t=100,v1=abc,v1=def')).toEqual({
      timestamp: 100,
      signatures: ['abc', 'def'],
    });
    expect(parseStripeSignatureHeader('bad')).toBeNull();
  });

  it('verifies a valid signature and rejects tampering', () => {
    const secret = 'whsec_test_secret';
    const rawBody = JSON.stringify({ id: 'evt_1', type: 'charge.succeeded' });
    const ts = 1_700_000_000;
    const header = sign(rawBody, secret, ts);

    expect(verifyStripeWebhookSignature({
      rawBody,
      signatureHeader: header,
      secret,
      nowSec: ts,
    }).ok).toBe(true);

    expect(verifyStripeWebhookSignature({
      rawBody: `${rawBody} `,
      signatureHeader: header,
      secret,
      nowSec: ts,
    }).ok).toBe(false);

    expect(verifyStripeWebhookSignature({
      rawBody,
      signatureHeader: header,
      secret,
      nowSec: ts + 10_000,
    }).ok).toBe(false);
  });

  it('canonicalizes stripe transaction ids', () => {
    expect(canonicalStripeTransactionId('ch_123')).toBe('stripe_ch_123');
    expect(canonicalStripeTransactionId('stripe_ch_123')).toBe('stripe_ch_123');
  });
});
