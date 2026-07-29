/**
 * FIRC + ODI data-backed tracking (REQ-018, REQ-019, REQ-039 / T-031).
 * Matches inward remittances to bank/Stripe credits; derives ODI APR status from profile + filings.
 */
import type {
  FilingTask,
  FircStatus,
  OdiProfile,
  RemittanceRecord,
  Transaction,
} from '../types';

const DEFAULT_AMOUNT_TOLERANCE = 0.02; // 2%
const DEFAULT_DATE_WINDOW_DAYS = 14;

export interface FircMatchCandidate {
  remittanceId: string;
  transactionId: string;
  remittanceAmount: number;
  transactionAmount: number;
  amountDeltaPct: number;
  dateDeltaDays: number;
  score: number;
}

export interface FircTrackedItem {
  remittance: RemittanceRecord;
  derivedStatus: FircStatus;
  matchedTransactionId?: string;
  matchScore?: number;
  blockers: string[];
}

export interface FircStatusReport {
  generatedAt: string;
  summary: {
    inwardTotal: number;
    pendingFirc: number;
    receivedFirc: number;
    matchedToBank: number;
    unmatchedBankCredits: number;
  };
  items: FircTrackedItem[];
  unmatchedCredits: Array<{ transactionId: string; date: string; amount: number; description: string }>;
  suggestedMatches: FircMatchCandidate[];
}

export interface OdiStatusReport {
  generatedAt: string;
  profile: OdiProfile | null;
  uinConfigured: boolean;
  aprStatus: 'unknown' | 'filed' | 'due_soon' | 'overdue' | 'not_applicable';
  daysUntilAprDue: number | null;
  filingTasks: FilingTask[];
  message: string;
}

export interface FemaTrackingReport {
  firc: FircStatusReport;
  odi: OdiStatusReport;
}

function absPctDelta(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / base;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    Math.round(
      (new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000,
    ),
  );
}

function isBankOrStripeCredit(t: Transaction): boolean {
  if (t.deleted || t.archived) return false;
  if (t.status !== 'Completed') return false;
  if (t.type !== 'Income') return false;
  return t.source === 'IndianBank' || t.source === 'Mercury' || t.source === 'Stripe' || t.source === 'Manual';
}

/**
 * Score candidate matches: lower amount+date delta → higher score (0–1).
 */
export function scoreFircMatch(
  remittance: RemittanceRecord,
  tx: Transaction,
  opts?: { amountTolerance?: number; dateWindowDays?: number },
): FircMatchCandidate | null {
  const amountTol = opts?.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE;
  const dateWindow = opts?.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS;
  const txAmount = Math.abs(tx.originalAmount ?? tx.netAmount ?? tx.amount);
  const remAmount = Math.abs(remittance.amount);
  const amountDeltaPct = absPctDelta(remAmount, txAmount);
  if (amountDeltaPct > amountTol) return null;
  const dateDeltaDays = daysBetween(remittance.date, tx.date.slice(0, 10));
  if (dateDeltaDays > dateWindow) return null;
  const amountScore = 1 - amountDeltaPct / amountTol;
  const dateScore = 1 - dateDeltaDays / dateWindow;
  const score = 0.65 * amountScore + 0.35 * dateScore;
  return {
    remittanceId: remittance.id,
    transactionId: tx.id,
    remittanceAmount: remAmount,
    transactionAmount: txAmount,
    amountDeltaPct,
    dateDeltaDays,
    score,
  };
}

export function suggestFircMatches(
  remittances: RemittanceRecord[],
  transactions: Transaction[],
  opts?: { amountTolerance?: number; dateWindowDays?: number },
): FircMatchCandidate[] {
  const inward = remittances.filter((r) => r.direction === 'Inward');
  const credits = transactions.filter(isBankOrStripeCredit);
  const usedTx = new Set<string>();
  const suggestions: FircMatchCandidate[] = [];

  for (const rem of inward) {
    if (rem.matchedTransactionId || rem.fircStatus === 'Matched') continue;
    let best: FircMatchCandidate | null = null;
    for (const tx of credits) {
      if (usedTx.has(tx.id)) continue;
      const candidate = scoreFircMatch(rem, tx, opts);
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
    if (best && best.score >= 0.5) {
      suggestions.push(best);
      usedTx.add(best.transactionId);
    }
  }
  return suggestions.sort((a, b) => b.score - a.score);
}

export function deriveFircStatus(rem: RemittanceRecord): FircStatus {
  if (rem.direction === 'Outward') return 'NotRequired';
  if (rem.fircStatus === 'Matched' || rem.matchedTransactionId) return 'Matched';
  if (rem.fircStatus === 'Received' || rem.fircNumber) return 'Received';
  if (rem.fircStatus === 'NotRequired') return 'NotRequired';
  return 'Pending';
}

export function applySuggestedMatch(
  rem: RemittanceRecord,
  match: FircMatchCandidate,
): RemittanceRecord {
  return {
    ...rem,
    matchedTransactionId: match.transactionId,
    fircStatus: 'Matched',
  };
}

export function buildFircStatusReport(input: {
  remittances: RemittanceRecord[];
  transactions: Transaction[];
  asOfDate?: string;
}): FircStatusReport {
  const suggestions = suggestFircMatches(input.remittances, input.transactions);
  const suggestionByRem = new Map(suggestions.map((s) => [s.remittanceId, s]));
  const matchedTxIds = new Set(
    input.remittances.map((r) => r.matchedTransactionId).filter(Boolean) as string[],
  );
  for (const s of suggestions) matchedTxIds.add(s.transactionId);

  const items: FircTrackedItem[] = input.remittances
    .filter((r) => r.direction === 'Inward')
    .map((rem) => {
      const blockers: string[] = [];
      let derived = deriveFircStatus(rem);
      const suggestion = suggestionByRem.get(rem.id);
      if (derived === 'Pending' && suggestion) {
        derived = 'Matched';
      }
      if (derived === 'Pending') blockers.push('FIRC number not recorded');
      if (derived === 'Received' && !rem.matchedTransactionId && !suggestion) {
        blockers.push('No matching bank/Stripe credit found within tolerance');
      }
      return {
        remittance: rem,
        derivedStatus: derived,
        matchedTransactionId: rem.matchedTransactionId ?? suggestion?.transactionId,
        matchScore: suggestion?.score,
        blockers,
      };
    });

  const unmatchedCredits = input.transactions
    .filter(isBankOrStripeCredit)
    .filter((t) => !matchedTxIds.has(t.id))
    .map((t) => ({
      transactionId: t.id,
      date: t.date.slice(0, 10),
      amount: Math.abs(t.originalAmount ?? t.netAmount ?? t.amount),
      description: t.description,
    }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      inwardTotal: items.length,
      pendingFirc: items.filter((i) => i.derivedStatus === 'Pending').length,
      receivedFirc: items.filter((i) => i.derivedStatus === 'Received' || i.derivedStatus === 'Matched').length,
      matchedToBank: items.filter((i) => i.derivedStatus === 'Matched' || i.matchedTransactionId).length,
      unmatchedBankCredits: unmatchedCredits.length,
    },
    items,
    unmatchedCredits,
    suggestedMatches: suggestions,
  };
}

export function buildOdiStatusReport(input: {
  profile: OdiProfile | null;
  filingTasks: FilingTask[];
  asOfDate?: string;
}): OdiStatusReport {
  const asOf = input.asOfDate ?? new Date().toISOString().slice(0, 10);
  const odiTasks = input.filingTasks.filter(
    (t) => t.type === 'FEMA' || /odi|apr|fema/i.test(t.type) || /odi|apr/i.test(t.period + (t.notes ?? '')),
  );
  const profile = input.profile;
  const uinConfigured = !!(profile?.uin && profile.uin.trim().length > 0);

  let aprStatus: OdiStatusReport['aprStatus'] = 'unknown';
  let daysUntilAprDue: number | null = null;
  let message = 'ODI profile not configured — enter UIN and APR due date';

  if (!uinConfigured && odiTasks.length === 0) {
    aprStatus = 'not_applicable';
    message = 'No ODI UIN or FEMA filings — mark N/A if no overseas investment';
  } else {
    const due = profile?.nextAprDueDate
      ?? odiTasks.find((t) => t.status !== 'Filed')?.dueDate
      ?? null;
    const filed = profile?.lastAprFiledDate
      ?? odiTasks.find((t) => t.status === 'Filed')?.filedDate
      ?? null;

    if (due) {
      daysUntilAprDue = Math.ceil(
        (new Date(`${due}T00:00:00`).getTime() - new Date(`${asOf}T00:00:00`).getTime()) / 86_400_000,
      );
      const filedCoversDue = !!(filed && filed >= due.slice(0, 10));
      if (daysUntilAprDue < 0 && !filedCoversDue) {
        aprStatus = 'overdue';
        message = `APR overdue by ${Math.abs(daysUntilAprDue)} days`;
      } else if (daysUntilAprDue <= 45 && !filedCoversDue) {
        aprStatus = 'due_soon';
        message = `APR due in ${daysUntilAprDue} days${uinConfigured ? ` (UIN ${profile!.uin})` : ''}`;
      } else if (filedCoversDue || (filed && daysUntilAprDue > 45)) {
        aprStatus = 'filed';
        message = `APR filed${filed ? ` on ${filed}` : ''}${uinConfigured ? ` · UIN ${profile!.uin}` : ''}`;
      } else {
        aprStatus = 'unknown';
        message = uinConfigured
          ? `UIN ${profile!.uin} — next APR ${due}`
          : `Next APR due ${due}`;
      }
    } else if (filed) {
      aprStatus = 'filed';
      message = `APR filed on ${filed}${uinConfigured ? ` · UIN ${profile!.uin}` : ''}`;
    } else if (uinConfigured) {
      aprStatus = 'unknown';
      message = `UIN ${profile!.uin} configured — set next APR due date`;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    profile,
    uinConfigured,
    aprStatus,
    daysUntilAprDue,
    filingTasks: odiTasks,
    message,
  };
}

export function buildFemaTrackingReport(input: {
  remittances: RemittanceRecord[];
  transactions: Transaction[];
  odiProfile: OdiProfile | null;
  filingTasks: FilingTask[];
  asOfDate?: string;
}): FemaTrackingReport {
  return {
    firc: buildFircStatusReport({
      remittances: input.remittances,
      transactions: input.transactions,
      asOfDate: input.asOfDate,
    }),
    odi: buildOdiStatusReport({
      profile: input.odiProfile,
      filingTasks: input.filingTasks,
      asOfDate: input.asOfDate,
    }),
  };
}
