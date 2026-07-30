/**
 * useEmployees — React Query hook for employee data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/apiClient';
import {
  getEmployees,
  setEmployees,
  setEmployeeLocalOnly,
  getActiveOrgId,
} from '../services/storageService';
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
      // Local-only first — avoid bulk upsertEmployees (fails if any peer has bad PII).
      setEmployeeLocalOnly(employee);
      const ok = await api.upsertEmployee(orgId, employee);
      if (!ok) {
        throw new Error('Could not save employee to server');
      }
      return employee;
    },
    onSuccess: (employee) => {
      qc.setQueryData<Employee[]>(empKeys.all(orgId), (prev) => {
        const list = prev ?? getEmployees();
        const exists = list.some((e) => e.id === employee.id);
        return exists
          ? list.map((e) => (e.id === employee.id ? employee : e))
          : [...list, employee];
      });
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
