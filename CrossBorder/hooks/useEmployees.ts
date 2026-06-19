/**
 * useEmployees — React Query hook for employee data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/apiClient';
import { getEmployees, setEmployees, getActiveOrgId } from '../services/storageService';
import type { Employee } from '../types';

export const empKeys = {
  all: (orgId: string) => ['employees', orgId] as const,
};

export function useEmployees(orgId?: string) {
  const oid = orgId ?? getActiveOrgId() ?? 'default';

  return useQuery({
    queryKey: empKeys.all(oid),
    queryFn: async () => {
      const fromApi = await api.getEmployees(oid);
      if (fromApi) return fromApi;
      return getEmployees();
    },
    placeholderData: () => getEmployees(),
  });
}

export function useUpsertEmployee() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (employee: Employee) => {
      // Update localStorage first (keeps existing list in sync)
      const current = getEmployees();
      const updated = current.some(e => e.id === employee.id)
        ? current.map(e => e.id === employee.id ? employee : e)
        : [...current, employee];
      setEmployees(updated);
      await api.upsertEmployee(orgId, employee);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: empKeys.all(orgId) });
    },
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (empId: string) => {
      const updated = getEmployees().filter(e => e.id !== empId);
      setEmployees(updated);
      await api.deleteEmployee(orgId, empId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: empKeys.all(orgId) });
    },
  });
}

export function useBulkSetEmployees() {
  const qc = useQueryClient();
  const orgId = getActiveOrgId() ?? 'default';

  return useMutation({
    mutationFn: async (employees: Employee[]) => {
      setEmployees(employees);
      await api.upsertEmployees(orgId, employees);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: empKeys.all(orgId) });
    },
  });
}
