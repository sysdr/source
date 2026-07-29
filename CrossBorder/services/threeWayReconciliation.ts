/**
 * Three-way reconciliation workbench (REQ-058 / T-023).
 * Panes: Stripe↔Mercury, Ledger↔Bank, GSTR-2B ITC↔Purchase register.
 */
import type { Transaction } from '../types';

export type ReconItemStatus = 'matched' | 'unmatched' | 'disputed';

export interface ReconSide {
  id: string;
  label: string;
  amount: number;
  date: string;
  source?: string;
}

export interface ReconPaneItem {
  id: string;
  status: ReconItemStatus;
  left?: ReconSide;
  right?: ReconSide;
  reason?: string;
}

export interface ReconPaneSummary {
  matched: number;
  unmatched: number;
  disputed: number;
  items: ReconPaneItem[];
}

export interface ThreeWayReconciliationReport {
  generatedAt: string;
  stripeMercury: ReconPaneSummary;
  ledgerBank: ReconPaneSummary;
  gstr2bPurchases: ReconPaneSummary;
}

export interface Gstr2bClaim {
  id: string;
  date: string;
  supplierGstin?: string;
  description: string;
  itcAmount: number;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    Math.round(
      (new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000,
    ),
  );
}

function summarize(items: ReconPaneItem[]): ReconPaneSummary {
  return {
    matched: items.filter((i) => i.status === 'matched').length,
    unmatched: items.filter((i) => i.status === 'unmatched').length,
    disputed: items.filter((i) => i.status === 'disputed').length,
    items,
  };
}

function pairSides(
  leftPool: ReconSide[],
  rightPool: ReconSide[],
  options: { dateWindowDays?: number; amountTolerance?: number; pane: string } = { pane: 'x' },
): ReconPaneItem[] {
  const dateWindow = options.dateWindowDays ?? 3;
  const tol = options.amountTolerance ?? 1;
  const usedRight = new Set<string>();
  const items: ReconPaneItem[] = [];

  for (const left of leftPool) {
    const candidates = rightPool
      .filter((r) => !usedRight.has(r.id))
      .map((r) => {
        const amountDiff = Math.abs(r.amount - left.amount);
        const dayDiff = daysBetween(r.date, left.date);
        if (amountDiff > tol || dayDiff > dateWindow) return null;
        return { right: r, score: 10 - dayDiff - amountDiff };
      })
      .filter((c): c is { right: ReconSide; score: number } => c != null)
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      items.push({
        id: `${options.pane}-u-${left.id}`,
        status: 'unmatched',
        left,
        reason: 'No counterpart within amount/date window',
      });
      continue;
    }

    if (candidates.length > 1 && Math.abs(candidates[0].score - candidates[1].score) < 0.25) {
      items.push({
        id: `${options.pane}-d-${left.id}`,
        status: 'disputed',
        left,
        right: candidates[0].right,
        reason: 'Multiple equally likely matches — review manually',
      });
      usedRight.add(candidates[0].right.id);
      continue;
    }

    usedRight.add(candidates[0].right.id);
    items.push({
      id: `${options.pane}-m-${left.id}`,
      status: 'matched',
      left,
      right: candidates[0].right,
    });
  }

  for (const right of rightPool) {
    if (usedRight.has(right.id)) continue;
    items.push({
      id: `${options.pane}-ur-${right.id}`,
      status: 'unmatched',
      right,
      reason: 'No counterpart on the other side',
    });
  }

  return items;
}

function toSide(tx: Transaction, label?: string): ReconSide {
  return {
    id: tx.id,
    label: label || tx.description,
    amount: Math.abs(Number(tx.amount) || 0),
    date: tx.date,
    source: tx.source,
  };
}

/** (a) Stripe payouts / charges vs Mercury bank credits */
export function reconcileStripeMercury(transactions: Transaction[]): ReconPaneSummary {
  const stripe = transactions
    .filter((t) => t.source === 'Stripe' && t.type === 'Income' && t.status !== 'Refunded' && !t.deleted)
    .map((t) => toSide(t));
  const mercury = transactions
    .filter((t) => t.source === 'Mercury' && t.type === 'Income' && t.status !== 'Refunded' && !t.deleted)
    .map((t) => toSide(t));
  return summarize(pairSides(stripe, mercury, { pane: 'sm', dateWindowDays: 5 }));
}

/** (b) Ledger (non-bank) vs Indian bank statement imports */
export function reconcileLedgerBank(transactions: Transaction[]): ReconPaneSummary {
  const ledger = transactions
    .filter(
      (t) =>
        t.source !== 'IndianBank'
        && t.status === 'Completed'
        && !t.deleted
        && (t.type === 'Income' || t.type === 'Expense' || t.type === 'Purchase'),
    )
    .map((t) => toSide(t));
  const bank = transactions
    .filter((t) => t.source === 'IndianBank' && !t.deleted)
    .map((t) => toSide(t, `[Bank] ${t.description}`));
  return summarize(pairSides(ledger, bank, { pane: 'lb', dateWindowDays: 3 }));
}

/**
 * (c) Purchase-register ITC vs GSTR-2B claims.
 * Purchases with itcEligible contribute claimed ITC = gstImpact (or amount×gstRate/100).
 * Claims come from optional gstr2bClaims list (manual until GSTN API).
 */
export function reconcileGstr2bItc(
  transactions: Transaction[],
  claims: Gstr2bClaim[] = [],
): ReconPaneSummary {
  const purchases: ReconSide[] = transactions
    .filter(
      (t) =>
        (t.type === 'Purchase' || t.type === 'Expense')
        && t.itcEligible === true
        && !t.deleted
        && t.status !== 'Refunded',
    )
    .map((t) => {
      const rate = Number(t.gstRate) || 0;
      const itc = t.gstImpact != null
        ? Number(t.gstImpact)
        : rate > 0
          ? Math.round((Number(t.amount) * rate) / 100 * 100) / 100
          : 0;
      return {
        id: t.id,
        label: t.description,
        amount: itc,
        date: t.date,
        source: t.source,
      };
    })
    .filter((s) => s.amount > 0);

  const claimSides: ReconSide[] = claims.map((c) => ({
    id: c.id,
    label: c.description,
    amount: c.itcAmount,
    date: c.date,
    source: 'GSTR-2B',
  }));

  // If no claims uploaded, mark all purchase ITC as unmatched (needs GSTR-2B entry)
  if (claimSides.length === 0) {
    return summarize(
      purchases.map((p) => ({
        id: `g2b-u-${p.id}`,
        status: 'unmatched' as const,
        left: p,
        reason: 'No GSTR-2B claim recorded — enter claim or mark disputed',
      })),
    );
  }

  return summarize(pairSides(purchases, claimSides, { pane: 'g2b', dateWindowDays: 45, amountTolerance: 2 }));
}

export function buildThreeWayReconciliation(input: {
  transactions: Transaction[];
  gstr2bClaims?: Gstr2bClaim[];
}): ThreeWayReconciliationReport {
  return {
    generatedAt: new Date().toISOString(),
    stripeMercury: reconcileStripeMercury(input.transactions),
    ledgerBank: reconcileLedgerBank(input.transactions),
    gstr2bPurchases: reconcileGstr2bItc(input.transactions, input.gstr2bClaims || []),
  };
}
