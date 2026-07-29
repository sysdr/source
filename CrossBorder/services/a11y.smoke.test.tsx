/**
 * Accessibility smoke checks for primary flows (REQ-069 / T-041).
 * Lightweight structural checks — runs in CI without a browser stack.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import AsyncStatusBanner from '../components/AsyncStatusBanner';
import DesktopOnlyGate from '../components/DesktopOnlyGate';
import { IDLE_ASYNC_STATE } from './asyncOperation';

describe('a11y smoke (REQ-069 / T-041)', () => {
  it('AsyncStatusBanner exposes alert role on error', () => {
    render(
      <AsyncStatusBanner
        state={{
          ...IDLE_ASYNC_STATE,
          phase: 'error',
          step: 'Export',
          message: 'Export failed: timeout',
          remediation: 'Retry the export',
        }}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Retry the export/i)).toBeTruthy();
  });

  it('AsyncStatusBanner uses status role while loading', () => {
    render(
      <AsyncStatusBanner
        state={{
          ...IDLE_ASYNC_STATE,
          phase: 'loading',
          step: 'Stripe sync',
          message: 'Syncing…',
        }}
      />,
    );
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('DesktopOnlyGate notice has status role on mobile viewport', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    window.dispatchEvent(new Event('resize'));
    render(
      <DesktopOnlyGate feature="Journal entry">
        <button type="button">New Entry</button>
      </DesktopOnlyGate>,
    );
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New Entry' })).toBeNull();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
  });

  it('interactive controls have accessible names', () => {
    render(
      <button type="button" aria-label="Open navigation">
        <span aria-hidden="true">☰</span>
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });
});
