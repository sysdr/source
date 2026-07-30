/** Shared Stripe API / id constants (ADR-003). */

/** Pin both browser and server Stripe REST calls to one version. */
export const STRIPE_API_VERSION = '2024-06-20';

export function canonicalStripeTransactionId(chargeId: string): string {
  const id = chargeId.trim();
  if (!id) return id;
  if (id.startsWith('stripe_')) return id;
  if (id.startsWith('ch_') || id.startsWith('pi_')) return `stripe_${id}`;
  return id;
}

/** Charge id without stripe_ prefix, for StripeChargeId field / Stripe API. */
export function stripeChargeIdFromLedgerId(ledgerOrChargeId: string): string {
  const id = ledgerOrChargeId.trim();
  if (id.startsWith('stripe_')) return id.slice('stripe_'.length);
  return id;
}
