/**
 * One-time / sync-time migration: legacy browser Stripe ids `ch_*` → `stripe_ch_*` (ADR-003).
 */
import type { Transaction } from '../types';
import { getTransactions, setTransactions, getRevenueData, setRevenueData } from './storageService';
import { canonicalStripeTransactionId, stripeChargeIdFromLedgerId } from './stripeConstants';

export function migrateStripeTransactionRow(tx: Transaction): Transaction {
  if (tx.source !== 'Stripe') return tx;
  const chargeKey = tx.stripeChargeId || (tx.id.startsWith('ch_') || tx.id.startsWith('pi_') ? tx.id : '');
  if (!chargeKey && !tx.id.startsWith('stripe_')) return tx;
  const chargeId = stripeChargeIdFromLedgerId(chargeKey || tx.id);
  const nextId = canonicalStripeTransactionId(chargeId);
  if (tx.id === nextId && tx.stripeChargeId === chargeId) return tx;
  return { ...tx, id: nextId, stripeChargeId: chargeId };
}

export function migrateLegacyStripeTransactionIds(): { ledgerUpdated: number; revenueUpdated: number } {
  const ledger = getTransactions();
  let ledgerUpdated = 0;
  const nextLedger = ledger.map((tx) => {
    const migrated = migrateStripeTransactionRow(tx);
    if (migrated !== tx && (migrated.id !== tx.id || migrated.stripeChargeId !== tx.stripeChargeId)) {
      ledgerUpdated += 1;
    }
    return migrated;
  });
  // Collapse duplicates that now share the same canonical id (prefer newer lastSyncedAt).
  const byId = new Map<string, Transaction>();
  for (const tx of nextLedger) {
    const prev = byId.get(tx.id);
    if (!prev) {
      byId.set(tx.id, tx);
      continue;
    }
    const prevTs = prev.lastSyncedAt || prev.date;
    const nextTs = tx.lastSyncedAt || tx.date;
    byId.set(tx.id, nextTs >= prevTs ? tx : prev);
  }
  const deduped = Array.from(byId.values());
  if (ledgerUpdated > 0 || deduped.length !== ledger.length) {
    setTransactions(deduped);
  }

  const revenue = getRevenueData();
  let revenueUpdated = 0;
  const nextRevenueTxns = (revenue.transactions || []).map((tx) => {
    const migrated = migrateStripeTransactionRow(tx);
    if (migrated !== tx && (migrated.id !== tx.id || migrated.stripeChargeId !== tx.stripeChargeId)) {
      revenueUpdated += 1;
    }
    return migrated;
  });
  const revById = new Map<string, Transaction>();
  for (const tx of nextRevenueTxns) {
    const prev = revById.get(tx.id);
    if (!prev) {
      revById.set(tx.id, tx);
      continue;
    }
    const prevTs = prev.lastSyncedAt || prev.date;
    const nextTs = tx.lastSyncedAt || tx.date;
    revById.set(tx.id, nextTs >= prevTs ? tx : prev);
  }
  const revDeduped = Array.from(revById.values());
  if (revenueUpdated > 0 || revDeduped.length !== (revenue.transactions || []).length) {
    setRevenueData({ ...revenue, transactions: revDeduped }, { force: true });
  }

  return { ledgerUpdated, revenueUpdated };
}
