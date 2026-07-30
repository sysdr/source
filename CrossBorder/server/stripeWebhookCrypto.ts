/**
 * Stripe webhook signature verification (REQ-078 security).
 * Compatible with Stripe's Stripe-Signature header without the stripe SDK.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalStripeTransactionId } from '../services/stripeConstants.js';

export { canonicalStripeTransactionId };

const DEFAULT_TOLERANCE_SEC = 300;

export interface StripeSignatureParts {
  timestamp: number;
  signatures: string[];
}

export function parseStripeSignatureHeader(header: string): StripeSignatureParts | null {
  const parts = header.split(',').map((p) => p.trim());
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === 't' && v) timestamp = Number(v);
    if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Verify Stripe-Signature against the raw request body.
 * @see https://stripe.com/docs/webhooks/signatures
 */
export function verifyStripeWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string;
  secret: string;
  toleranceSec?: number;
  nowSec?: number;
}): { ok: true; timestamp: number } | { ok: false; error: string } {
  const parsed = parseStripeSignatureHeader(params.signatureHeader);
  if (!parsed) return { ok: false, error: 'Invalid Stripe-Signature header' };

  const tolerance = params.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, error: 'Stripe webhook timestamp outside tolerance' };
  }

  const signedPayload = `${parsed.timestamp}.${params.rawBody}`;
  const expected = createHmac('sha256', params.secret).update(signedPayload, 'utf8').digest('hex');
  const match = parsed.signatures.some((sig) => safeEqualHex(expected, sig));
  if (!match) return { ok: false, error: 'Stripe webhook signature mismatch' };
  return { ok: true, timestamp: parsed.timestamp };
}
