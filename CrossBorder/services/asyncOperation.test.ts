import { describe, expect, it } from 'vitest';
import {
  formatUserError,
  runAsyncOperation,
  IDLE_ASYNC_STATE,
} from './asyncOperation';
import {
  allowsDesktopDataEntry,
  classifyViewportWidth,
  desktopEntryBlockedMessage,
} from './responsive';

describe('asyncOperation (REQ-075 / T-035)', () => {
  it('strips stack traces from errors', () => {
    const err = new Error('Boom\n    at Object.<anonymous> (file.ts:1:1)');
    const { message, remediation } = formatUserError(err, 'Payroll batch');
    expect(message).toContain('Payroll batch failed');
    expect(message).not.toMatch(/\bat\s+/);
    expect(remediation.length).toBeGreaterThan(10);
  });

  it('suggests rate-limit remediation for 429', () => {
    const { remediation } = formatUserError(new Error('HTTP 429 rate limit'), 'Stripe sync');
    expect(remediation).toMatch(/rate-limited/i);
  });

  it('runs success and error paths with state callbacks', async () => {
    const phases: string[] = [];
    const ok = await runAsyncOperation({
      step: 'Export',
      run: async () => ({ rows: 3 }),
      successDetail: (r) => `${r.rows} rows`,
      onState: (s) => phases.push(s.phase),
    });
    expect(ok.phase).toBe('success');
    expect(ok.detail).toBe('3 rows');
    expect(phases).toEqual(['loading', 'success']);

    const bad = await runAsyncOperation({
      step: 'Export',
      run: async () => { throw new Error('disk full'); },
      onState: (s) => phases.push(s.phase),
    });
    expect(bad.phase).toBe('error');
    expect(bad.message).toMatch(/disk full/);
    expect(bad.remediation).toBeTruthy();
  });

  it('exports idle constant', () => {
    expect(IDLE_ASYNC_STATE.phase).toBe('idle');
  });
});

describe('responsive (REQ-074 / T-034)', () => {
  it('classifies viewport bands', () => {
    expect(classifyViewportWidth(375)).toBe('mobile');
    expect(classifyViewportWidth(768)).toBe('tablet');
    expect(classifyViewportWidth(1280)).toBe('desktop');
  });

  it('blocks data entry on mobile widths', () => {
    expect(allowsDesktopDataEntry(375)).toBe(false);
    expect(allowsDesktopDataEntry(767)).toBe(false);
    expect(allowsDesktopDataEntry(768)).toBe(true);
  });

  it('returns a clear desktop-only message', () => {
    expect(desktopEntryBlockedMessage('Journal entry')).toMatch(/768px/i);
  });
});
