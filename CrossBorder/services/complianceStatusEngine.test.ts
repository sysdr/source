import { describe, expect, it } from 'vitest';
import type { Employee, FilingTask, PayrollRun, Transaction } from '../types';
import {
  assessFilingReadiness,
  buildComplianceStatusReport,
  deriveFilingStatus,
} from './complianceStatusEngine';

describe('complianceStatusEngine (REQ-002 / REQ-036 / REQ-041 / T-029)', () => {
  it('derives Overdue from dueDate when not Filed', () => {
    const task = {
      id: 't1',
      type: 'GSTR-1',
      period: '2026-01',
      dueDate: '2026-02-11',
      status: 'Pending',
      createdAt: '',
      updatedAt: '',
    } as FilingTask;
    expect(deriveFilingStatus(task, '2026-03-01')).toBe('Overdue');
    expect(deriveFilingStatus({ ...task, status: 'Filed', filedDate: '2026-02-10' }, '2026-03-01')).toBe('Filed');
  });

  it('blocks GSTR-1 without GSTIN / unclassified revenue', () => {
    const result = assessFilingReadiness('GSTR-1', {
      transactions: [
        {
          id: 'i1',
          date: '2026-01-05',
          description: 'Sale',
          amount: 1000,
          currency: 'INR',
          source: 'Manual',
          category: 'Revenue',
          status: 'Completed',
          type: 'Income',
        } as Transaction,
      ],
      employees: [],
      payrollRuns: [],
      hasGstin: false,
    });
    expect(result.readiness).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'MISSING_GSTIN')).toBe(true);
  });

  it('blocks 24Q when active employees lack PAN', () => {
    const result = assessFilingReadiness('24Q', {
      transactions: [],
      employees: [{
        id: 'e1',
        name: 'Ada',
        designation: 'Eng',
        ctc: 1,
        doj: '2025-01-01',
        status: 'Active',
        email: 'a@x.com',
        documents: { pan: false, aadhaar: false, contract: false },
      } as Employee],
      payrollRuns: [{ id: 'r1', month: 'January', year: 2026 } as PayrollRun],
      hasTan: true,
    });
    expect(result.readiness).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'EMPLOYEE_PAN')).toBe(true);
  });

  it('summarizes compliance board from tasks + live data', () => {
    const report = buildComplianceStatusReport({
      tasks: [
        {
          id: 't1',
          type: 'GSTR-1',
          period: '2026-01',
          dueDate: '2026-02-11',
          status: 'Pending',
          createdAt: '',
          updatedAt: '',
        } as FilingTask,
        {
          id: 't2',
          type: 'Form 5472',
          period: '2025',
          dueDate: '2026-04-15',
          status: 'Filed',
          filedDate: '2026-03-01',
          createdAt: '',
          updatedAt: '',
        } as FilingTask,
      ],
      transactions: [],
      employees: [],
      payrollRuns: [],
      hasGstin: true,
      asOfDate: '2026-03-01',
    });
    expect(report.summary.overdue).toBe(1);
    expect(report.summary.filed).toBe(1);
    expect(report.items[0].derivedStatus).toBe('Overdue');
  });
});
