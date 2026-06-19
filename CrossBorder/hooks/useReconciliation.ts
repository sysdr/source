/**
 * useReconciliation — React Query hook for the Phase 4 reconciliation engine.
 *
 * Calls GET /api/reconciliation?orgId= and returns the full ReconciliationReport.
 *
 * Usage:
 *   const { data: report, isLoading, refetch } = useReconciliation();
 *   useReconciliation(undefined, { persistSnapshot: true }); // store each run in SQLite
 *   // report.summary.errors / .warnings / .infos
 *   // report.issues — array of ReconciliationIssue
 */

import { useQuery } from '@tanstack/react-query';
import { getActiveOrgId } from '../services/storageService';

// ── Types (mirror server/reconciliation.ts without importing server code) ─────

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
  date: string;
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

// ── Fetcher ───────────────────────────────────────────────────────────────────

const BASE = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE ?? 'http://localhost:3001';

export interface UseReconciliationOptions {
  /** When true, each successful fetch stores a row in SQLite (`reports`, type `reconciliation`). */
  persistSnapshot?: boolean;
}

async function fetchReconciliation(orgId: string, persistSnapshot?: boolean): Promise<ReconciliationReport> {
  const q = new URLSearchParams({ orgId });
  if (persistSnapshot) q.set('persist', 'true');
  const res = await fetch(`${BASE}/api/reconciliation?${q}`);
  if (!res.ok) throw new Error(`Reconciliation failed: ${res.status}`);
  const data = await res.json();
  // Server may add _persistedId when persist=true; strip for typed report
  if (data && typeof data === 'object' && '_persistedId' in data) {
    const { _persistedId: _id, ...rest } = data as ReconciliationReport & { _persistedId?: string };
    return rest as ReconciliationReport;
  }
  return data as ReconciliationReport;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useReconciliation(orgId?: string, options?: UseReconciliationOptions) {
  const resolvedOrgId = orgId ?? getActiveOrgId() ?? 'default';
  const persist = options?.persistSnapshot === true;
  return useQuery({
    queryKey:    ['reconciliation', resolvedOrgId, persist] as const,
    queryFn:     () => fetchReconciliation(resolvedOrgId, persist),
    staleTime:   5 * 60 * 1000,    // 5 minutes — reconciliation is expensive
    refetchOnWindowFocus: false,
  });
}
