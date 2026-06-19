/**
 * useTransactions — React Query hook for transaction data.
 *
 * Reads from the SQLite API first; falls back to localStorage if the server
 * is unavailable so the app always works offline.
 *
 * Usage:
 *   const { data, isLoading, error } = useTransactions({ orgId, startDate, endDate });
 *   const { mutate: addTxn } = useAddTransaction();
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type TxnQueryParams } from '../services/apiClient';
import { getTransactions, setTransactions, addTransaction, removeTransaction, updateTransaction, getActiveOrgId } from '../services/storageService';
import type { Transaction } from '../types';

// ── Query key factory ─────────────────────────────────────────────────────────
export const txnKeys = {
  all:     (orgId: string)                       => ['transactions', orgId] as const,
  list:    (orgId: string, filters: Omit<TxnQueryParams, 'orgId'>) => ['transactions', orgId, filters] as const,
  count:   (orgId: string)                       => ['transactions', orgId, 'count'] as const,
};

// ── Read: paginated list ──────────────────────────────────────────────────────
export function useTransactions(params?: Partial<TxnQueryParams>) {
  const orgId = params?.orgId ?? getActiveOrgId() ?? 'default';

  return useQuery({
    queryKey: txnKeys.list(orgId, { ...params, orgId: undefined } as Omit<TxnQueryParams, 'orgId'>),
    queryFn: async () => {
      // Try API first
      const page = await api.getTransactions({ orgId, limit: 2000, ...params });
      if (page) return page.transactions;
      // Fallback: localStorage
      return getTransactions();
    },
    placeholderData: () => getTransactions(), // show cached data immediately while fetching
  });
}

// ── Read: all transactions (for aggregation) ──────────────────────────────────
export function useAllTransactions(orgId?: string) {
  const oid = orgId ?? getActiveOrgId() ?? 'default';
  return useQuery({
    queryKey: txnKeys.all(oid),
    queryFn: async () => {
      const page = await api.getTransactions({ orgId: oid, limit: 5000 });
      if (page) return page.transactions;
      return getTransactions();
    },
    placeholderData: () => getTransactions(),
    staleTime: 60_000, // aggregation data can be slightly stale
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────
export function useAddTransaction() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (tx: Transaction) => {
      addTransaction(tx);                    // localStorage first (instant)
      await api.upsertTransaction(orgId, tx); // then persist to SQLite
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions', orgId] });
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (tx: Transaction) => {
      const { id, ...updates } = tx;
      updateTransaction(id, updates);
      await api.updateTransaction(orgId, tx);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions', orgId] });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (txId: string) => {
      removeTransaction(txId);
      await api.deleteTransaction(orgId, txId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions', orgId] });
    },
  });
}

export function useBulkUpsertTransactions() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (txns: Transaction[]) => {
      setTransactions(txns);
      await api.upsertTransactions(orgId, txns);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions', orgId] });
    },
  });
}
