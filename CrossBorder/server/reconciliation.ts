/**
 * server/reconciliation.ts — Phase 4: Reconciliation guards
 *
 * Exposes:
 *   reconcileOrg(orgId)  → ReconciliationReport
 *
 * Checks performed:
 *   1. STALE_PENDING     — Pending transactions older than 30 days
 *   2. GST_RATE_MISMATCH — gstImpact doesn't match amount × gstRate / 100
 *   3. ITC_INELIGIBLE    — itcEligible=true on a zero-GST transaction
 *   4. TDS_MISMATCH      — tdsAmount doesn't match amount × tdsRate / 100
 *   5. NEGATIVE_AMOUNT   — amount ≤ 0 (shouldn't exist after schema validation)
 *   6. MISSING_NARRATION — Expenses/Purchases > ₹5,000 / $60 without narration (Rule 6F)
 *   7. INVOICE_OVERDUE   — Sent/Viewed invoices past dueDate not marked Overdue
 *   8. INVOICE_TOTAL     — Invoice total ≠ subtotal + taxTotal
 */

import { queryTransactions, getInvoicesDB } from './db.js';

export type ReconciliationSeverity = 'error' | 'warning' | 'info';
export type ReconciliationCode =
  | 'STALE_PENDING'
  | 'GST_RATE_MISMATCH'
  | 'ITC_INELIGIBLE'
  | 'TDS_MISMATCH'
  | 'NEGATIVE_AMOUNT'
  | 'MISSING_NARRATION'
  | 'INVOICE_OVERDUE'
  | 'INVOICE_TOTAL_MISMATCH';

export interface ReconciliationIssue {
  code: ReconciliationCode;
  severity: ReconciliationSeverity;
  entityType: 'transaction' | 'invoice';
  entityId: string;
  message: string;
  /** ISO date string of the affected record */
  date: string;
  /** Suggested remediation action */
  action: string;
}

export interface ReconciliationReport {
  orgId: string;
  generatedAt: string;
  totalTransactions: number;
  totalInvoices: number;
  issues: ReconciliationIssue[];
  summary: {
    errors:   number;
    warnings: number;
    infos:    number;
    clean:    boolean;
  };
}

const STALE_PENDING_DAYS = 30;
const NARRATION_THRESHOLD_INR = 5_000;
const NARRATION_THRESHOLD_USD = 60;

function daysDiff(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

export function reconcileOrg(orgId: string): ReconciliationReport {
  const now = new Date().toISOString();
  const txns = queryTransactions({ orgId, limit: 10_000, offset: 0, includeDeleted: false }) as Record<string, unknown>[];
  const invoices = getInvoicesDB(orgId) as Record<string, unknown>[];
  const issues: ReconciliationIssue[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Transaction-level checks ──────────────────────────────────────────

  for (const tx of txns) {
    const id   = tx.id as string;
    const date = tx.date as string;
    const amount = tx.amount as number;
    const status = tx.status as string;
    const type   = tx.type as string;
    const gstImpact = tx.gstImpact as number | undefined;
    const gstRate   = tx.gstRate   as number | undefined;
    const itcEligible = tx.itcEligible as boolean | undefined;
    const tdsAmount   = tx.tdsAmount as number | undefined;
    const tdsRate     = tx.tdsRate   as number | undefined;
    const narration   = tx.narration as string | undefined;
    const currency    = tx.currency  as 'USD' | 'INR';

    // 1a. Stale Pending
    if (status === 'Pending' && daysDiff(date) > STALE_PENDING_DAYS) {
      issues.push({
        code: 'STALE_PENDING',
        severity: 'warning',
        entityType: 'transaction',
        entityId: id,
        message: `Transaction "${tx.description}" has been Pending for ${Math.floor(daysDiff(date))} days (since ${date})`,
        date,
        action: 'Review and mark Completed, Flagged, or Failed',
      });
    }

    // 1b. Negative/zero amount
    if (amount <= 0) {
      issues.push({
        code: 'NEGATIVE_AMOUNT',
        severity: 'error',
        entityType: 'transaction',
        entityId: id,
        message: `Transaction "${tx.description}" has non-positive amount: ${amount}`,
        date,
        action: 'Correct amount or delete the transaction',
      });
    }

    // 1c. GST impact cross-check
    if (gstImpact != null && gstRate != null && gstRate > 0) {
      const expected = (amount * gstRate) / 100;
      if (Math.abs(gstImpact - expected) > 0.5) {
        issues.push({
          code: 'GST_RATE_MISMATCH',
          severity: 'error',
          entityType: 'transaction',
          entityId: id,
          message: `GST impact ₹${gstImpact.toFixed(2)} ≠ amount × ${gstRate}% = ₹${expected.toFixed(2)} (diff: ${(gstImpact - expected).toFixed(2)})`,
          date,
          action: 'Correct gstImpact or gstRate to ensure amount × rate / 100 = impact',
        });
      }
    }

    // 1d. ITC ineligible
    if (itcEligible === true && (!gstRate || gstRate === 0)) {
      issues.push({
        code: 'ITC_INELIGIBLE',
        severity: 'warning',
        entityType: 'transaction',
        entityId: id,
        message: `itcEligible=true but gstRate is 0 or unset — ITC cannot be claimed on zero-rated transactions`,
        date,
        action: 'Set itcEligible=false or supply correct gstRate',
      });
    }

    // 1e. TDS amount mismatch
    if (tdsAmount != null && tdsRate != null) {
      const expected = (amount * tdsRate) / 100;
      if (Math.abs(tdsAmount - expected) > 1.0) {
        issues.push({
          code: 'TDS_MISMATCH',
          severity: 'warning',
          entityType: 'transaction',
          entityId: id,
          message: `TDS amount ₹${tdsAmount.toFixed(2)} ≠ amount × ${tdsRate}% = ₹${expected.toFixed(2)}`,
          date,
          action: 'Correct tdsAmount or tdsRate',
        });
      }
    }

    // 1f. Missing narration for large expenses (Rule 6F)
    const threshold = currency === 'INR' ? NARRATION_THRESHOLD_INR : NARRATION_THRESHOLD_USD;
    if ((type === 'Expense' || type === 'Purchase') && amount >= threshold && !narration) {
      issues.push({
        code: 'MISSING_NARRATION',
        severity: 'info',
        entityType: 'transaction',
        entityId: id,
        message: `${type} of ${currency} ${amount.toFixed(2)} on ${date} lacks a narration/business purpose (required under Rule 6F for audit)`,
        date,
        action: 'Add narration describing the business purpose',
      });
    }
  }

  // ── 2. Invoice-level checks ──────────────────────────────────────────────

  for (const inv of invoices) {
    const id       = inv.id as string;
    const date     = inv.date as string;
    const dueDate  = inv.dueDate as string;
    const status   = inv.status as string;
    const subtotal = inv.subtotal as number;
    const taxTotal = inv.taxTotal as number;
    const total    = inv.total as number;

    // 2a. Overdue invoices not marked as Overdue
    if ((status === 'Sent' || status === 'Viewed') && dueDate < today) {
      issues.push({
        code: 'INVOICE_OVERDUE',
        severity: 'warning',
        entityType: 'invoice',
        entityId: id,
        message: `Invoice #${inv.number} (${inv.customerName}) was due on ${dueDate} but is still marked "${status}"`,
        date,
        action: 'Update status to Overdue and follow up with the customer',
      });
    }

    // 2b. Invoice total integrity
    const expectedTotal = subtotal + taxTotal;
    if (Math.abs(total - expectedTotal) > 0.5) {
      issues.push({
        code: 'INVOICE_TOTAL_MISMATCH',
        severity: 'error',
        entityType: 'invoice',
        entityId: id,
        message: `Invoice #${inv.number} total (${total.toFixed(2)}) ≠ subtotal (${subtotal.toFixed(2)}) + taxTotal (${taxTotal.toFixed(2)}) = ${expectedTotal.toFixed(2)}`,
        date,
        action: 'Recalculate and correct the invoice total',
      });
    }
  }

  // ── 3. Summary ────────────────────────────────────────────────────────────

  const errors   = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos    = issues.filter(i => i.severity === 'info').length;

  return {
    orgId,
    generatedAt: now,
    totalTransactions: txns.length,
    totalInvoices: invoices.length,
    issues,
    summary: {
      errors,
      warnings,
      infos,
      clean: issues.length === 0,
    },
  };
}
