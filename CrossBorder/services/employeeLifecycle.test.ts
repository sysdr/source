/**
 * REQ: REQ-085, REQ-087, REQ-088
 */
import { describe, it, expect } from 'vitest';
import {
  applyLifecycleEvent,
  appendSalaryRevision,
  canHardDeleteEmployee,
  isPayrollEligible,
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

describe('employeeLifecycle', () => {
  it('rejects start_notice from Onboarding (REQ-085)', () => {
    const result = applyLifecycleEvent(base, 'start_notice');
    expect(result.ok).toBe(false);
  });

  it('completes onboarding to Active', () => {
    const result = applyLifecycleEvent(base, 'complete_onboarding');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.employee.status).toBe('Active');
      expect(isPayrollEligible(result.employee.status)).toBe(true);
    }
  });

  it('blocks hard delete when payroll history exists (REQ-087)', () => {
    const runs: PayrollRun[] = [{
      id: 'r1',
      month: 'January',
      year: 2026,
      runAt: '2026-01-31',
      employeeCount: 1,
      totalGross: 100,
      totalStatutory: 10,
      totalNet: 90,
      totalEmployerCost: 110,
      employeeSlips: [{
        employeeId: 'EMP-1',
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
      }],
    }];
    const gate = canHardDeleteEmployee('EMP-1', runs);
    expect(gate.ok).toBe(false);
  });

  it('appends salary revision (REQ-088)', () => {
    const active = { ...base, status: 'Active' as const };
    const result = appendSalaryRevision(active, 1_400_000, 'Annual', '2026-04-01');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.employee.ctc).toBe(1_400_000);
      expect(result.employee.salaryRevisions?.[0].previousCTC).toBe(1_200_000);
    }
  });
});
