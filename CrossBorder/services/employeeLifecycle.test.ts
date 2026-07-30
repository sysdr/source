/**
 * REQ: REQ-085, REQ-087, REQ-088
 * Mutation-strong suite for employeeLifecycle (RW-009b).
 */
import { describe, it, expect } from 'vitest';
import {
  applyLifecycleEvent,
  appendSalaryRevision,
  canHardDeleteEmployee,
  employeeHasPayrollHistory,
  isPayrollEligible,
  type EmployeeLifecycleEvent,
} from './employeeLifecycle';
import type { Employee, PayrollRun } from '../types';

const base: Employee = {
  id: 'EMP-1',
  name: 'Ada',
  designation: 'Eng',
  ctc: 1_200_000,
  doj: '2024-01-01',
  status: 'Onboarding',
  email: 'ada@example.com',
  documents: { pan: false, aadhaar: false, contract: false },
};

function slip(employeeId: string) {
  return {
    employeeId,
    employeeName: 'Ada',
    basic: 50,
    hra: 20,
    allowance: 10,
    grossEarnings: 80,
    epf: 5,
    esiEmployee: 0,
    pt: 200,
    tds: 0,
    totalDeductions: 205,
    netPay: 90,
    epfEmployer: 5,
    epsEmployer: 0,
    esiEmployer: 0,
    lopDays: 0,
    paidDays: 22,
    workingDays: 22,
  };
}

function runWithSlips(slips: ReturnType<typeof slip>[]): PayrollRun {
  return {
    id: 'r1',
    month: 'January',
    year: 2026,
    runAt: '2026-01-31',
    employeeCount: slips.length,
    totalGross: 100,
    totalStatutory: 10,
    totalNet: 90,
    totalEmployerCost: 110,
    employeeSlips: slips,
  };
}

const EXPECTED: Record<Employee['status'], Partial<Record<EmployeeLifecycleEvent, Employee['status']>>> = {
  Onboarding: { complete_onboarding: 'Active' },
  Active: { deactivate: 'Inactive', start_notice: 'Notice', exit: 'Exited' },
  Inactive: { activate: 'Active', exit: 'Exited', archive: 'Archived' },
  Notice: { exit: 'Exited', activate: 'Active' },
  Exited: { archive: 'Archived', rehire: 'Onboarding' },
  Archived: { rehire: 'Onboarding' },
};

describe('employeeLifecycle', () => {
  it('payroll eligibility is only Active or Notice', () => {
    expect(isPayrollEligible('Active')).toBe(true);
    expect(isPayrollEligible('Notice')).toBe(true);
    expect(isPayrollEligible('Onboarding')).toBe(false);
    expect(isPayrollEligible('Inactive')).toBe(false);
    expect(isPayrollEligible('Exited')).toBe(false);
    expect(isPayrollEligible('Archived')).toBe(false);
  });

  it('applies every allowed transition with exact next status', () => {
    for (const [status, events] of Object.entries(EXPECTED) as [Employee['status'], typeof EXPECTED[Employee['status']]][]) {
      for (const [event, next] of Object.entries(events) as [EmployeeLifecycleEvent, Employee['status']][]) {
        const result = applyLifecycleEvent({ ...base, status }, event);
        expect(result.ok, `${status} + ${event}`).toBe(true);
        if (result.ok) {
          expect(result.employee.status).toBe(next);
        }
      }
    }
  });

  it('rejects disallowed transitions with a concrete message', () => {
    const result = applyLifecycleEvent(base, 'start_notice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Cannot start notice from status Onboarding.');
      expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it('rejects unknown status without throwing', () => {
    const weird = { ...base, status: 'Unknown' as Employee['status'] };
    const result = applyLifecycleEvent(weird, 'activate');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('activate');
      expect(result.message).toContain('Unknown');
    }
  });

  it('detects payroll history only for matching employee slips', () => {
    const runs = [runWithSlips([slip('OTHER'), slip('EMP-1')])];
    expect(employeeHasPayrollHistory('EMP-1', runs)).toBe(true);
    expect(employeeHasPayrollHistory('EMP-2', runs)).toBe(false);
    expect(employeeHasPayrollHistory('EMP-1', [runWithSlips([])])).toBe(false);
    expect(employeeHasPayrollHistory('EMP-1', [])).toBe(false);
  });

  it('blocks hard delete when payroll history exists (REQ-087)', () => {
    const runs = [runWithSlips([slip('EMP-1')])];
    const gate = canHardDeleteEmployee('EMP-1', runs);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.message).toBe(
        'Cannot delete an employee with payroll history. Transition to Exited, then Archived.',
      );
    }
  });

  it('allows hard delete when there is no payroll history', () => {
    expect(canHardDeleteEmployee('EMP-1', [runWithSlips([slip('OTHER')])])).toEqual({ ok: true });
    expect(canHardDeleteEmployee('EMP-1', [])).toEqual({ ok: true });
  });

  it('sets endDate when exiting (resigned)', () => {
    const active = { ...base, status: 'Active' as const };
    const result = applyLifecycleEvent(active, 'exit', { endDate: '2026-07-15' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.employee.status).toBe('Exited');
      expect(result.employee.endDate).toBe('2026-07-15');
    }
  });

  it('clears endDate on rehire', () => {
    const exited = { ...base, status: 'Exited' as const, endDate: '2026-01-01' };
    const result = applyLifecycleEvent(exited, 'rehire');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.employee.status).toBe('Onboarding');
      expect(result.employee.endDate).toBeUndefined();
    }
  });

  it('appends salary revision (REQ-088)', () => {
    const active = { ...base, status: 'Active' as const };
    const result = appendSalaryRevision(active, 1_400_000, '  Annual raise  ', '2026-04-01');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.employee.ctc).toBe(1_400_000);
      expect(result.employee.salaryRevisions?.[0]).toEqual({
        effectiveDate: '2026-04-01',
        previousCTC: 1_200_000,
        newCTC: 1_400_000,
        reason: 'Annual raise',
      });
    }
  });

  it('allows zero CTC but rejects negative, non-finite, and blank reason', () => {
    const active = { ...base, status: 'Active' as const };
    expect(appendSalaryRevision(active, 0, 'Zero base', '2026-04-01').ok).toBe(true);
    expect(appendSalaryRevision(active, -1, 'Bad', '2026-04-01')).toEqual({
      ok: false,
      message: 'New CTC must be a non-negative number.',
    });
    expect(appendSalaryRevision(active, Number.NaN, 'Bad', '2026-04-01')).toEqual({
      ok: false,
      message: 'New CTC must be a non-negative number.',
    });
    expect(appendSalaryRevision(active, 100, '   ', '2026-04-01')).toEqual({
      ok: false,
      message: 'Revision reason is required.',
    });
    expect(appendSalaryRevision(active, 100, '', '2026-04-01')).toEqual({
      ok: false,
      message: 'Revision reason is required.',
    });
  });
});
