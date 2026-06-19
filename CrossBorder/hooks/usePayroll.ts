/**
 * usePayroll — React Query hooks for payroll run data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/apiClient';
import { getPayrollRuns, addPayrollRun, getActiveOrgId } from '../services/storageService';
import type { PayrollRun } from '../types';

export const payrollKeys = {
  all: (orgId: string) => ['payroll', orgId] as const,
};

export function usePayrollRuns(orgId?: string) {
  const oid = orgId ?? getActiveOrgId() ?? 'default';

  return useQuery({
    queryKey: payrollKeys.all(oid),
    queryFn: async () => {
      const fromApi = await api.getPayrollRuns(oid);
      if (fromApi) return fromApi;
      return getPayrollRuns();
    },
    placeholderData: () => getPayrollRuns(),
    staleTime: 5 * 60_000,
  });
}

export function useAddPayrollRun() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (run: PayrollRun) => {
      addPayrollRun(run);
      await api.upsertPayrollRun(orgId, run);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: payrollKeys.all(orgId) });
    },
  });
}

export function useDeletePayrollRun() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (runId: string) => {
      await api.deletePayrollRun(orgId, runId);
      // localStorage removal handled by caller (storageService)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: payrollKeys.all(orgId) });
    },
  });
}
