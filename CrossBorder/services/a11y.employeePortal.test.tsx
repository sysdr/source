/**
 * Employee portal accessibility (REQ-069 / REQ-091 / RW-P-005).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import React from 'react';
import {
  EmployeeHome,
  EmployeeLeaveSelf,
  EmployeePaySelf,
  EmployeeProfileSelf,
} from '../components/employee/EmployeePortal';
import type { Employee } from '../types';

const EMP: Employee = {
  id: 'E-A11Y',
  name: 'Alex Portal',
  designation: 'Engineer',
  ctc: 1200000,
  doj: '2024-01-15',
  status: 'Active',
  email: 'alex@example.com',
  documents: { pan: true, aadhaar: false, contract: true },
  phone: '9999999999',
  bankName: 'HDFC',
  bankIFSC: 'HDFC0001234',
  bankAccountNumber: '123456789012',
  panNumber: 'ABCDE1234F',
  taxRegime: 'new',
};

vi.mock('./sessionAuth', () => ({
  getAppSession: () => ({
    role: 'employee',
    displayName: 'Alex',
    email: 'alex@example.com',
    employeeId: 'E-A11Y',
    orgId: 'org-a11y',
    loggedInAt: new Date().toISOString(),
  }),
}));

vi.mock('./storageService', async () => {
  const actual = await vi.importActual<typeof import('./storageService')>('./storageService');
  return {
    ...actual,
    getEmployees: () => [EMP],
    getLeaveRequests: () => [],
    getLeavePolicies: () => [
      { type: 'CL', name: 'Casual Leave', annualQuota: 12 },
    ],
    getLeaveBalance: () => ({
      employeeId: 'E-A11Y',
      year: 2026,
      balances: { CL: { total: 12, used: 0, remaining: 12 } },
    }),
    getPayrollRuns: () => [],
    getCompanyProfile: () => ({
      projectName: 'Demo',
      payroll: { pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22 },
    }),
    syncLeaveRequestsFromServer: async () => 0,
    updateEmployeeSelfProfile: async () => ({ ok: true }),
    addLeaveRequest: () => {},
    updateLeaveRequest: () => {},
    setEmployeeLocalOnly: () => {},
  };
});

vi.mock('./apiClient', () => ({
  api: {
    getEmployeeSelf: async () => EMP,
  },
  getAccessRole: () => 'employee',
}));

vi.mock('./payrollCalculator', () => ({
  MONTHS: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  computeFullSalary: () => ({
    basic: 50000,
    hra: 20000,
    epf: 1800,
    pt: 200,
    tds: 1000,
    grossEarnings: 70000,
    netPay: 67000,
  }),
}));

const AXE_OPTS = {
  rules: {
    region: { enabled: false },
    'color-contrast': { enabled: false },
  },
} as const;

function seriousOrCritical(results: Awaited<ReturnType<typeof axe>>) {
  return results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
}

describe.sequential('employee portal axe (REQ-091 / RW-P-005)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  it('EmployeeHome has no serious/critical axe violations', async () => {
    const { container } = render(<EmployeeHome onNavigate={() => {}} />);
    expect(screen.getByRole('heading', { name: /Hi, Alex/i })).toBeTruthy();
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 20_000);

  it('EmployeeProfileSelf has no serious/critical axe violations', async () => {
    const { container } = render(<EmployeeProfileSelf />);
    expect(screen.getByRole('heading', { name: /My profile/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByDisplayValue('Alex Portal')).toBeTruthy();
    });
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 20_000);

  it('EmployeePaySelf has no serious/critical axe violations', async () => {
    const { container } = render(<EmployeePaySelf onNavigate={() => {}} />);
    expect(screen.getByRole('heading', { name: /Pay & salary slips/i })).toBeTruthy();
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 20_000);

  it('EmployeeLeaveSelf has no serious/critical axe violations', async () => {
    const { container } = render(<EmployeeLeaveSelf />);
    expect(screen.getByRole('heading', { name: /^Leave$/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText(/^Type$/i)).toBeTruthy();
    });
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 20_000);
});

describe('employee portal keyboard smoke (RW-P-005)', () => {
  it('home quick actions are focusable buttons', () => {
    render(<EmployeeHome onNavigate={() => {}} />);
    const profile = screen.getByRole('button', { name: /My profile/i });
    profile.focus();
    expect(document.activeElement).toBe(profile);
  });

  it('leave form controls are labelled', () => {
    render(<EmployeeLeaveSelf />);
    expect(screen.getByLabelText(/^Type$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^From$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^To$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Reason$/i)).toBeTruthy();
  });
});
