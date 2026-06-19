/**
 * useInvoices — React Query hooks for invoice data.
 *
 * Reads from the SQLite API first; falls back to localStorage if the server
 * is unavailable so the app always works offline.
 *
 * Usage:
 *   const { data, isLoading } = useInvoices('Draft');
 *   const { mutate: upsert } = useUpsertInvoice();
 *   const { mutate: remove } = useDeleteInvoice();
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/apiClient';
import {
  getInvoices,
  addInvoice,
  updateInvoice,
  deleteInvoice as removeInvoice,
  getActiveOrgId,
} from '../services/storageService';
import type { Invoice } from '../types';

// ── Query key factory ──────────────────────────────────────────────────────────
export const invoiceKeys = {
  all:      (orgId: string)                   => ['invoices', orgId] as const,
  filtered: (orgId: string, status?: string)  => ['invoices', orgId, status ?? 'all'] as const,
};

// ── Read: invoice list (optionally filtered by status) ────────────────────────
export function useInvoices(status?: string) {
  const orgId = getActiveOrgId() ?? 'default';

  return useQuery({
    queryKey: invoiceKeys.filtered(orgId, status),
    queryFn: async (): Promise<Invoice[]> => {
      try {
        const result = await api.getInvoices(orgId, status);
        if (result !== null) return result;
      } catch {
        // Server unavailable — fall through to localStorage
      }
      const local = getInvoices();
      return status ? local.filter((inv) => inv.status === status) : local;
    },
    placeholderData: () => {
      const local = getInvoices();
      return status ? local.filter((inv) => inv.status === status) : local;
    },
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export function useUpsertInvoice() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    // Optimistic update: write to localStorage immediately so the UI responds
    // without waiting for the network round-trip.
    onMutate: async (invoice: Invoice) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic data.
      await qc.cancelQueries({ queryKey: invoiceKeys.all(orgId) });

      // Snapshot current cache for rollback.
      const previous = qc.getQueriesData<Invoice[]>({ queryKey: invoiceKeys.all(orgId) });

      // Apply the optimistic update to every cached query that holds invoice lists.
      qc.setQueriesData<Invoice[]>({ queryKey: invoiceKeys.all(orgId) }, (old = []) => {
        const exists = old.some((inv) => inv.id === invoice.id);
        return exists
          ? old.map((inv) => (inv.id === invoice.id ? invoice : inv))
          : [invoice, ...old];
      });

      return { previous };
    },

    mutationFn: async (invoice: Invoice) => {
      // Persist to localStorage first (instant), then sync to server.
      const existing = getInvoices().some((i) => i.id === invoice.id);
      if (existing) {
        updateInvoice(invoice.id, invoice);
      } else {
        addInvoice(invoice);
      }
      await api.upsertInvoice(orgId, invoice);
    },

    onError: (_err, _invoice, context) => {
      // Roll back optimistic update on failure.
      if (context?.previous) {
        for (const [queryKey, data] of context.previous) {
          qc.setQueryData(queryKey, data);
        }
      }
    },

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoiceKeys.all(orgId) });
    },
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (id: string) => {
      removeInvoice(id);
      await api.deleteInvoice(orgId, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoiceKeys.all(orgId) });
    },
  });
}
