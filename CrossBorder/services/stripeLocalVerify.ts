/**
 * Field-level verification of Stripe charges vs local ledger rows (ADR-003 / REQ-044).
 * Pure compare — no network.
 */
import type { Transaction } from '../types';
import { stripeChargeIdFromLedgerId } from './stripeConstants';

export type StripeChargeSnapshot = {
  id: string;
  amount: number; // minor units
  amount_refunded?: number;
  currency: string;
  created: number;
  status?: string;
  refunded?: boolean;
  balance_transaction?: { fee?: number; net?: number; currency?: string } | string | null;
};

export type LocalStripeSnapshot = {
  id: string;
  stripeChargeId?: string;
  date: string;
  status: string;
  amount: number;
  currency: string;
  originalAmount?: number;
  originalCurrency?: string;
  feeAmount?: number;
  netAmount?: number;
  stripeAccountId?: string | null;
};

export type FieldMismatch = {
  field: string;
  stripe: string | number | boolean | null;
  local: string | number | boolean | null;
};

export type ChargeVerifyRow = {
  chargeId: string;
  outcome: 'matched' | 'mismatch' | 'missing_local' | 'missing_stripe';
  accountId?: string | null;
  mismatches: FieldMismatch[];
  local?: LocalStripeSnapshot;
  stripe?: {
    date: string;
    status: string;
    originalAmount: number;
    originalCurrency: string;
    feeMajor: number | null;
  };
};

export type StripeLocalVerifyReport = {
  orgId: string;
  comparedAt: string;
  stripeChargeCount: number;
  localStripeCount: number;
  matched: number;
  mismatched: number;
  missingLocal: number;
  missingStripe: number;
  rows: ChargeVerifyRow[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toMajor(minor: number): number {
  return round2(minor / 100);
}

export function mapStripeStatusToLocal(charge: StripeChargeSnapshot): string {
  if (charge.refunded || (charge.amount_refunded ?? 0) > 0 && charge.amount_refunded === charge.amount) {
    return 'Refunded';
  }
  const s = String(charge.status || '').toLowerCase();
  if (s === 'succeeded' || s === 'paid') return 'Completed';
  if (s === 'failed') return 'Failed';
  return 'Pending';
}

export function localChargeKey(tx: LocalStripeSnapshot): string | null {
  if (tx.stripeChargeId) return stripeChargeIdFromLedgerId(tx.stripeChargeId);
  if (tx.id.startsWith('stripe_')) return stripeChargeIdFromLedgerId(tx.id);
  if (tx.id.startsWith('ch_') || tx.id.startsWith('pi_')) return tx.id;
  return null;
}

export function stripeDateFromCreated(created: number): string {
  return new Date(created * 1000).toISOString().split('T')[0];
}

function feeMajorFromCharge(charge: StripeChargeSnapshot): number | null {
  const bt = charge.balance_transaction;
  if (bt && typeof bt === 'object' && typeof bt.fee === 'number') return toMajor(bt.fee);
  return null;
}

/**
 * Compare one Stripe charge to one local row.
 * Money identity uses originalAmount/originalCurrency (FX-independent).
 * Base-currency amount/fee are soft-checked only when currencies match.
 */
export function compareChargeToLocal(
  charge: StripeChargeSnapshot,
  local: LocalStripeSnapshot | undefined,
): ChargeVerifyRow {
  const chargeId = charge.id;
  if (!local) {
    return {
      chargeId,
      outcome: 'missing_local',
      mismatches: [],
      stripe: {
        date: stripeDateFromCreated(charge.created),
        status: mapStripeStatusToLocal(charge),
        originalAmount: toMajor(Math.max(0, charge.amount - (charge.amount_refunded ?? 0))),
        originalCurrency: String(charge.currency || '').toUpperCase(),
        feeMajor: feeMajorFromCharge(charge),
      },
    };
  }

  const mismatches: FieldMismatch[] = [];
  const stripeDate = stripeDateFromCreated(charge.created);
  const stripeStatus = mapStripeStatusToLocal(charge);
  const stripeOriginal = toMajor(Math.max(0, charge.amount - (charge.amount_refunded ?? 0)));
  // Gross charge amount — used when local kept pre-refund identity (rare) or for display.
  const stripeGross = toMajor(charge.amount);
  const stripeCurrency = String(charge.currency || '').toUpperCase();
  const feeMajor = feeMajorFromCharge(charge);

  if (local.date !== stripeDate) {
    mismatches.push({ field: 'date', stripe: stripeDate, local: local.date });
  }
  if (local.status !== stripeStatus) {
    mismatches.push({ field: 'status', stripe: stripeStatus, local: local.status });
  }

  const localOriginal = local.originalAmount ?? local.amount;
  const localCurrency = (local.originalCurrency || local.currency || '').toUpperCase();
  // Sync stores net-after-refund as originalAmount (0 when fully refunded).
  if (Math.abs(localOriginal - stripeOriginal) > 0.009) {
    // Tolerate local still holding gross when status already Refunded.
    if (!(stripeStatus === 'Refunded' && Math.abs(localOriginal - stripeGross) <= 0.009)) {
      mismatches.push({ field: 'originalAmount', stripe: stripeOriginal, local: localOriginal });
    }
  }
  if (localCurrency !== stripeCurrency) {
    mismatches.push({ field: 'originalCurrency', stripe: stripeCurrency, local: localCurrency });
  }

  // Soft: when ledger currency equals Stripe currency, amount should match original.
  if (local.currency.toUpperCase() === stripeCurrency) {
    if (Math.abs(local.amount - stripeOriginal) > 0.05) {
      mismatches.push({ field: 'amount', stripe: stripeOriginal, local: local.amount });
    }
  }

  if (feeMajor != null && local.feeAmount != null && local.currency.toUpperCase() === stripeCurrency) {
    if (Math.abs(local.feeAmount - feeMajor) > 0.05) {
      mismatches.push({ field: 'feeAmount', stripe: feeMajor, local: local.feeAmount });
    }
  }

  return {
    chargeId,
    outcome: mismatches.length ? 'mismatch' : 'matched',
    accountId: local.stripeAccountId,
    mismatches,
    local,
    stripe: {
      date: stripeDate,
      status: stripeStatus,
      originalAmount: stripeOriginal,
      originalCurrency: stripeCurrency,
      feeMajor,
    },
  };
}

export function verifyStripeChargesAgainstLocal(params: {
  orgId: string;
  charges: Array<StripeChargeSnapshot & { accountId?: string | null }>;
  localTransactions: LocalStripeSnapshot[];
}): StripeLocalVerifyReport {
  const localByCharge = new Map<string, LocalStripeSnapshot>();
  for (const tx of params.localTransactions) {
    const key = localChargeKey(tx);
    if (!key) continue;
    localByCharge.set(key, tx);
  }

  const seen = new Set<string>();
  const rows: ChargeVerifyRow[] = [];

  for (const charge of params.charges) {
    seen.add(charge.id);
    const row = compareChargeToLocal(charge, localByCharge.get(charge.id));
    row.accountId = charge.accountId ?? row.accountId;
    rows.push(row);
  }

  for (const [chargeId, local] of localByCharge) {
    if (seen.has(chargeId)) continue;
    rows.push({
      chargeId,
      outcome: 'missing_stripe',
      accountId: local.stripeAccountId,
      mismatches: [],
      local,
    });
  }

  return {
    orgId: params.orgId,
    comparedAt: new Date().toISOString(),
    stripeChargeCount: params.charges.length,
    localStripeCount: localByCharge.size,
    matched: rows.filter((r) => r.outcome === 'matched').length,
    mismatched: rows.filter((r) => r.outcome === 'mismatch').length,
    missingLocal: rows.filter((r) => r.outcome === 'missing_local').length,
    missingStripe: rows.filter((r) => r.outcome === 'missing_stripe').length,
    rows,
  };
}
