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
import { IDLE_ASYNC_STATE } from './asyncOperation';

vi.mock('./apiClient', () => ({
  getAccessRole: () => 'accountant',
  getOrCreateWriterSessionId: () => 'test-session',
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
});

describe('keyboard traversal smoke (REQ-069)', () => {
  it('Navigation tabs are keyboard-activatable buttons', () => {
    const { getByRole } = render(
      <Navigation activeTab="dashboard" setActiveTab={() => {}} />,
    );
    const dash = getByRole('button', { name: /dashboard/i });
    expect(dash.tagName).toBe('BUTTON');
    dash.focus();
    expect(document.activeElement).toBe(dash);
  });
});
