/**
 * Canonical transaction normalizer (T-016 / REQ-006 / REQ-078).
 * Maps multi-source payloads into the ledger Transaction shape before persistence.
 */
import { TransactionSchema, validate } from './schemas.js';

export type BaseCurrency = 'INR' | 'USD';

export const RevenueClassification = {
  OIDAR_RISK: 'OIDAR GST Risk (18% Liability)',
  EXPORT: 'Export Revenue (GST 0%)',
  DOMESTIC_MOR: 'Domestic Revenue (Tax Handled by MoR)',
} as const;

export type RevenueClassificationValue =
  (typeof RevenueClassification)[keyof typeof RevenueClassification];

export interface GstClassification {
  customerCountry: string;
  customerLocation: string;
  classification: RevenueClassificationValue;
  gstRate: number;
  gstImpact: number;
}

export interface NormalizeOptions {
  baseCurrency?: BaseCurrency;
  accountId?: string | null;
  webhookEventId?: string;
  eventType?: string;
  /** When true, skip Zod validation (used by bulk sync that already trusts mapCharge). */
  skipValidation?: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function extractCountry(obj: Record<string, unknown>): string {
  const customer = obj.customer as Record<string, unknown> | string | undefined;
  const billing = obj.billing_details as Record<string, unknown> | undefined;
  const shipping = (typeof customer === 'object' && customer
    ? (customer.shipping as Record<string, unknown> | undefined)
    : undefined);
  const addr = (
    (billing?.address as Record<string, unknown> | undefined)
    || (typeof customer === 'object' && customer
      ? (customer.address as Record<string, unknown> | undefined)
      : undefined)
    || shipping?.address
  ) as Record<string, unknown> | undefined;
  const country = typeof addr?.country === 'string' ? addr.country.toUpperCase() : '';
  return country || 'Unknown';
}

/** REQ-006 — classify revenue by customer country → GST treatment. */
export function classifyGstFromCountry(
  countryRaw: string,
  taxableAmount: number,
): GstClassification {
  const country = (countryRaw || 'Unknown').toUpperCase();
  const isIndia = country === 'IN';
  const isKnownForeign = country.length === 2 && country !== 'IN' && country !== 'UN';
  const classification = isIndia
    ? RevenueClassification.OIDAR_RISK
    : isKnownForeign
      ? RevenueClassification.EXPORT
      : RevenueClassification.EXPORT;
  const gstRate = isIndia ? 18 : 0;
  const gstImpact = round2(taxableAmount * gstRate / 100);
  return {
    customerCountry: country === 'UNKNOWN' ? 'Unknown' : country,
    customerLocation: country === 'UNKNOWN' ? 'Unknown' : country,
    classification,
    gstRate,
    gstImpact,
  };
}

function mapStripeStatus(obj: Record<string, unknown>, eventType?: string):
  'Pending' | 'Completed' | 'Failed' | 'Refunded' {
  if (eventType === 'charge.refunded' || Boolean(obj.refunded)) return 'Refunded';
  const status = String(obj.status || '').toLowerCase();
  if (status === 'succeeded' || status === 'paid') return 'Completed';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

function mapCategory(obj: Record<string, unknown>): string {
  const meta = obj.metadata as Record<string, unknown> | undefined;
  if (typeof meta?.type === 'string' && meta.type.trim()) return meta.type.trim();
  if (obj.invoice) return 'Subscription';
  if (obj.subscription) return 'Subscription';
  return 'One-time';
}

function toMajorUnits(amountMinor: number): number {
  return round2(amountMinor / 100);
}

function resolveChargeId(obj: Record<string, unknown>, fallback: string): string {
  if (typeof obj.id === 'string' && obj.id.startsWith('ch_')) return obj.id;
  if (typeof obj.latest_charge === 'string') return obj.latest_charge;
  if (typeof obj.id === 'string') return obj.id;
  return fallback;
}

/**
 * Normalize a Stripe charge / payment_intent object into a canonical ledger row.
 * Stable id: stripe_<chargeId> so webhook + pull-sync converge on the same key.
 */
export function normalizeStripeObject(
  obj: Record<string, unknown>,
  opts: NormalizeOptions = {},
): { ok: true; transaction: Record<string, unknown> } | { ok: false; error: string } {
  const baseCurrency = opts.baseCurrency ?? 'INR';
  const chargeId = resolveChargeId(obj, opts.webhookEventId || `unknown_${Date.now()}`);
  const amountMinor = Number(obj.amount_received ?? obj.amount ?? 0) || 0;
  const amountRefundedMinor = Number(obj.amount_refunded ?? 0) || 0;
  const netMinor = Math.max(0, amountMinor - amountRefundedMinor);
  const originalAmount = toMajorUnits(netMinor);
  const originalCurrency = String(obj.currency || 'usd').toUpperCase();

  const createdTs = Number(obj.created || Math.floor(Date.now() / 1000));
  const txDate = new Date(createdTs * 1000).toISOString().split('T')[0];

  const customer = obj.customer as Record<string, unknown> | string | undefined;
  const billing = obj.billing_details as Record<string, unknown> | undefined;
  const customerEmail = (
    (typeof customer === 'object' && customer ? customer.email : undefined)
    || billing?.email
    || ''
  ) as string;
  const customerName = (
    (typeof customer === 'object' && customer ? customer.name : undefined)
    || billing?.name
    || 'Customer'
  ) as string;

  const description = typeof obj.description === 'string' && obj.description.trim()
    ? obj.description.trim()
    : `${customerName}${customerEmail ? ` (${customerEmail})` : ''}`;

  const country = extractCountry(obj);
  const gst = classifyGstFromCountry(country, originalAmount);

  // Sync path converts FX asynchronously; webhook keeps original as ledger amount
  // when currencies match base, otherwise stores originalAmount/originalCurrency for later FX.
  const ledgerCurrency: BaseCurrency =
    originalCurrency === 'USD' || originalCurrency === 'INR'
      ? (originalCurrency as BaseCurrency)
      : baseCurrency;
  const amount = originalCurrency === ledgerCurrency
    ? originalAmount
    : originalAmount; // FX conversion remains in sync path; webhook stores as-received

  const bt = obj.balance_transaction as Record<string, unknown> | undefined;
  const feeMinor = Number(bt?.fee ?? 0) || 0;
  const feeAmount = toMajorUnits(feeMinor);
  const netAmount = bt
    ? toMajorUnits(Number(bt.net ?? netMinor - feeMinor) || 0)
    : round2(originalAmount - feeAmount);

  const status = mapStripeStatus(obj, opts.eventType);
  const transaction: Record<string, unknown> = {
    id: `stripe_${chargeId}`,
    stripeChargeId: chargeId,
    stripeAccountId: opts.accountId || undefined,
    date: txDate,
    description,
    amount: amount > 0 ? amount : 0.01, // schema requires positive; refunds use Refunded status
    currency: ledgerCurrency,
    originalAmount,
    originalCurrency,
    feeAmount,
    netAmount: netAmount >= 0 ? netAmount : 0,
    source: 'Stripe',
    status,
    category: mapCategory(obj),
    type: 'Income',
    entity: 'subsidiary',
    customerLocation: gst.customerLocation,
    customerCountry: gst.customerCountry,
    classification: gst.classification,
    gstRate: gst.gstRate,
    gstImpact: gst.gstImpact,
    lastSyncedAt: new Date().toISOString(),
  };

  if (opts.webhookEventId) transaction.webhookEventId = opts.webhookEventId;
  if (opts.eventType) transaction.webhookEventType = opts.eventType;

  // Fully refunded charges may have amount 0 — keep a sentinel for schema positivity.
  if (status === 'Refunded' && !(Number(transaction.amount) > 0)) {
    transaction.amount = toMajorUnits(amountMinor) || originalAmount || 0.01;
    transaction.netAmount = 0;
  }

  if (!opts.skipValidation) {
    const err = validate(TransactionSchema, transaction);
    if (err) return { ok: false, error: err };
  }

  return { ok: true, transaction };
}

/**
 * Normalize a generic / already-partial ledger row into canonical fields.
 * Fills missing GST classification when customer country is present.
 */
export function normalizeLedgerTransaction(
  raw: Record<string, unknown>,
  opts: NormalizeOptions = {},
): { ok: true; transaction: Record<string, unknown> } | { ok: false; error: string } {
  const tx = { ...raw };
  if (!tx.id || typeof tx.id !== 'string') {
    return { ok: false, error: 'id required' };
  }

  const amount = Number(tx.amount) || 0;
  const country = String(tx.customerCountry || tx.customerLocation || 'Unknown');
  if (tx.type === 'Income' && (tx.classification == null || tx.gstRate == null)) {
    const gst = classifyGstFromCountry(country, amount);
    tx.customerCountry = gst.customerCountry;
    tx.customerLocation = tx.customerLocation || gst.customerLocation;
    tx.classification = tx.classification || gst.classification;
    tx.gstRate = tx.gstRate ?? gst.gstRate;
    tx.gstImpact = tx.gstImpact ?? gst.gstImpact;
  }

  if (!tx.source) tx.source = 'Manual';
  if (!tx.status) tx.status = 'Completed';
  if (!tx.type) tx.type = 'Income';
  if (!tx.category) tx.category = 'Uncategorized';
  if (!tx.currency) tx.currency = opts.baseCurrency || 'INR';
  if (!tx.entity) tx.entity = 'parent';

  if (!opts.skipValidation) {
    const err = validate(TransactionSchema, tx);
    if (err) return { ok: false, error: err };
  }
  return { ok: true, transaction: tx };
}
