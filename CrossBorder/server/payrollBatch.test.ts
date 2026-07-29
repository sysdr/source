import { describe, expect, it } from 'vitest';
import type { Employee } from '../types';
import {
  runPayrollBatch,
  validateEmployeeForPayroll,
  validatePayrollEmployees,
} from './payrollBatch';

function emp(partial: Partial<Employee> & Pick<Employee, 'id' | 'name'>): Employee {
  return {
    designation: 'Engineer',
    ctc: 1200000,
    doj: '2025-01-01',
    status: 'Active',
    email: `${partial.id}@example.com`,
    documents: { pan: true, aadhaar: true, contract: true },
    panNumber: 'ABCDE1234F',
    bankAccountNumber: '123456789012',
    bankIFSC: 'HDFC0001234',
    taxRegime: 'new',
    ...partial,
  };
}

describe('payroll pre-validation (REQ-059 / T-017)', () => {
  it('flags missing PAN, bank, and tax regime', () => {
    const failure = validateEmployeeForPayroll(emp({
      id: 'e1',
      name: 'Broken',
      panNumber: '',
      bankAccountNumber: '',
      bankIFSC: '',
      taxRegime: undefined,
    }));
    expect(failure).toBeTruthy();
    expect(failure?.codes).toContain('MISSING_PAN');
    expect(failure?.codes).toContain('MISSING_BANK_ACCOUNT');
    expect(failure?.codes).toContain('MISSING_BANK_IFSC');
    expect(failure?.codes).toContain('MISSING_TAX_REGIME');
  });

  it('accepts a complete employee', () => {
    expect(validateEmployeeForPayroll(emp({ id: 'e2', name: 'Ok' }))).toBeNull();
  });

  it('reports row-level failures without blocking valid ids', () => {
    const report = validatePayrollEmployees([
      emp({ id: 'ok', name: 'Ok' }),
      emp({ id: 'bad', name: 'Bad', panNumber: 'BAD' }),
    ]);
    expect(report.validCount).toBe(1);
    expect(report.failedCount).toBe(1);
    expect(report.validEmployeeIds).toEqual(['ok']);
    expect(report.failures[0].employeeId).toBe('bad');
  });
});

describe('payroll batch execution (REQ-011 / T-018)', () => {
  it('processes valid employees and skips invalid ones with an error report', () => {
    const result = runPayrollBatch({
      orgId: 'org-1',
      month: 'January',
      year: 2026,
      employees: [
        emp({ id: 'ok', name: 'Ok Employee' }),
        emp({ id: 'bad', name: 'Bad Employee', panNumber: '' }),
      ],
      payrollConfig: {
        pfEnabled: true,
        esiEnabled: true,
        ptState: 'Maharashtra',
        standardWorkingDays: 22,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.run).toBeTruthy();
    expect(result.run?.employeeCount).toBe(1);
    expect(result.run?.employeeSlips[0].employeeId).toBe('ok');
    expect(result.validation.failedCount).toBe(1);
    expect(result.outputs?.suggestedExports.some((e) => e.kind === 'form24q')).toBe(true);
    expect(result.outputs?.summary.skipped).toBe(1);
    expect(result.run!.totalNet).toBe(result.run!.totalGross - result.run!.totalStatutory);
  });

  it('failClosed refuses to create a run when any row fails', () => {
    const result = runPayrollBatch({
      orgId: 'org-1',
      month: '2026-01',
      year: 2026,
      failClosed: true,
      employees: [
        emp({ id: 'ok', name: 'Ok' }),
        emp({ id: 'bad', name: 'Bad', taxRegime: undefined }),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.run).toBeUndefined();
    expect(result.validation.failedCount).toBe(1);
  });

  it('returns error when nobody is valid', () => {
    const result = runPayrollBatch({
      orgId: 'org-1',
      month: 'March',
      year: 2026,
      employees: [emp({ id: 'bad', name: 'Bad', panNumber: '' })],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No employees passed/);
  });
});
