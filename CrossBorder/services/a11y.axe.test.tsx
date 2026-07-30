/**
 * Accessibility checks with axe-core (REQ-069 / RW-002).
 * Color-contrast disabled in jsdom (no canvas). Tests run serially — axe-core is singleton.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import React from 'react';
import Navigation from '../components/Navigation';
import AsyncStatusBanner from '../components/AsyncStatusBanner';
import DesktopOnlyGate from '../components/DesktopOnlyGate';
import AccessBanner from '../components/AccessBanner';
import { EmployeeHome } from '../components/employee/EmployeePortal';
import { IDLE_ASYNC_STATE } from './asyncOperation';

vi.mock('./apiClient', () => ({
  getAccessRole: () => 'accountant',
  getOrCreateWriterSessionId: () => 'test-session',
}));

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
    getEmployees: () => [{
      id: 'E-A11Y',
      name: 'Alex Portal',
      designation: 'Engineer',
      ctc: 1200000,
      doj: '2024-01-15',
      status: 'Active',
      email: 'alex@example.com',
      documents: { pan: true, aadhaar: false, contract: true },
    }],
    getLeaveRequests: () => [],
    getPayrollRuns: () => [],
  };
});

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

describe.sequential('axe accessibility (REQ-069)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  it('Navigation has no serious/critical axe violations', async () => {
    const { container } = render(
      <Navigation activeTab="dashboard" setActiveTab={() => {}} orgName="SystemDR LLP" />,
    );
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 20_000);

  it('AsyncStatusBanner error state has no serious/critical axe violations', async () => {
    const { container } = render(
      <AsyncStatusBanner
        state={{
          ...IDLE_ASYNC_STATE,
          phase: 'error',
          step: 'Export',
          message: 'Export failed',
          remediation: 'Retry the export',
        }}
        onDismiss={() => {}}
      />,
    );
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 15_000);

  it('DesktopOnlyGate mobile notice has no serious/critical axe violations', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    window.dispatchEvent(new Event('resize'));
    const { container } = render(
      <DesktopOnlyGate feature="Payroll run">
        <button type="button">Run payroll</button>
      </DesktopOnlyGate>,
    );
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 15_000);

  it('AccessBanner accountant read-only notice has no serious/critical axe violations', async () => {
    const { container } = render(<AccessBanner />);
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 15_000);

  it('EmployeeHome main landmark has no serious/critical axe violations', async () => {
    const { container } = render(<EmployeeHome onNavigate={() => {}} />);
    const results = await axe(container, AXE_OPTS);
    expect(seriousOrCritical(results)).toEqual([]);
  }, 15_000);
});

describe('keyboard traversal smoke (REQ-069 / F-013)', () => {
  it('Navigation tabs are keyboard-activatable buttons', () => {
    const { getByRole } = render(
      <Navigation activeTab="dashboard" setActiveTab={() => {}} />,
    );
    const dash = getByRole('button', { name: /dashboard/i });
    expect(dash.tagName).toBe('BUTTON');
    dash.focus();
    expect(document.activeElement).toBe(dash);
  });

  it('EmployeeHome quick actions expose accessible names for SR', () => {
    const { getByRole } = render(<EmployeeHome onNavigate={() => {}} />);
    expect(getByRole('main')).toBeTruthy();
    expect(getByRole('button', { name: /My profile/i })).toBeTruthy();
    expect(getByRole('navigation', { name: /Employee quick actions/i })).toBeTruthy();
  });
});
