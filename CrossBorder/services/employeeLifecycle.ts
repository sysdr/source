/**
 * Employee lifecycle transitions — REQ-085, REQ-087, REQ-088
 * REQ: REQ-085, REQ-087, REQ-088
 */

import type { Employee, PayrollRun, SalaryRevision } from '../types';

export type EmployeeLifecycleEvent =
  | 'complete_onboarding'
  | 'activate'
  | 'deactivate'
  | 'start_notice'
  | 'exit'
  | 'archive'
  | 'rehire';

const TRANSITIONS: Record<string, Partial<Record<EmployeeLifecycleEvent, Employee['status']>>> = {
  Onboarding: { complete_onboarding: 'Active' },
  Active: { deactivate: 'Inactive', start_notice: 'Notice', exit: 'Exited' },
  Inactive: { activate: 'Active', exit: 'Exited', archive: 'Archived' },
  Notice: { exit: 'Exited', activate: 'Active' },
  Exited: { archive: 'Archived', rehire: 'Onboarding' },
  Archived: { rehire: 'Onboarding' },
};

export function isPayrollEligible(status: Employee['status']): boolean {
  return status === 'Active' || status === 'Notice';
}

export function applyLifecycleEvent(
  employee: Employee,
  event: EmployeeLifecycleEvent,
  options: { endDate?: string } = {},
): { ok: true; employee: Employee } | { ok: false; message: string } {
  const next = TRANSITIONS[employee.status]?.[event];
  if (!next) {
    return {
      ok: false,
      message: `Cannot ${event.replace(/_/g, ' ')} from status ${employee.status}.`,
    };
  }
  const updated: Employee = { ...employee, status: next };
  if (event === 'exit') {
    updated.endDate = options.endDate || employee.endDate || new Date().toISOString().slice(0, 10);
  }
  if (event === 'rehire' || event === 'activate' || event === 'complete_onboarding') {
    if (next === 'Active' || next === 'Onboarding') {
      updated.endDate = undefined;
    }
  }
  return { ok: true, employee: updated };
}

export function employeeHasPayrollHistory(employeeId: string, runs: PayrollRun[]): boolean {
  return runs.some((run) => run.employeeSlips.some((s) => s.employeeId === employeeId));
}

export function canHardDeleteEmployee(
  employeeId: string,
  runs: PayrollRun[],
): { ok: true } | { ok: false; message: string } {
  if (employeeHasPayrollHistory(employeeId, runs)) {
    return {
      ok: false,
      message: 'Cannot delete an employee with payroll history. Transition to Exited, then Archived.',
    };
  }
  return { ok: true };
}

export function appendSalaryRevision(
  employee: Employee,
  newCTC: number,
  reason: string,
  effectiveDate: string,
): { ok: true; employee: Employee } | { ok: false; message: string } {
  if (!Number.isFinite(newCTC) || newCTC < 0) {
    return { ok: false, message: 'New CTC must be a non-negative number.' };
  }
  if (!reason.trim()) {
    return { ok: false, message: 'Revision reason is required.' };
  }
  const revision: SalaryRevision = {
    effectiveDate,
    previousCTC: employee.ctc,
    newCTC,
    reason: reason.trim(),
  };
  return {
    ok: true,
    employee: {
      ...employee,
      ctc: newCTC,
      salaryRevisions: [...(employee.salaryRevisions || []), revision],
    },
  };
}
