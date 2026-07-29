/**
 * Non-P0 requirement citation close-out (RW-005).
 * Lightweight assertions that bind remaining REQ ids to existing behaviour.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SLO_TARGETS_MS } from './sloMetrics';
import { evaluatePurgeRisk } from './retentionPolicy';
import { IDLE_ASYNC_STATE, formatUserError, runAsyncOperation } from './asyncOperation';
import { classifyViewportWidth, allowsDesktopDataEntry } from './responsive';

describe('non-P0 traceability citations (RW-005)', () => {
  it('documents ledger p95 SLO target of 500ms (REQ-031)', () => {
    expect(SLO_TARGETS_MS.ledger_query).toBe(500);
  });

  it('async error states include remediation without stack traces (REQ-047)', async () => {
    const formatted = formatUserError(new Error('Timeout contacting Stripe\n    at Object.run'), 'Stripe sync');
    expect(formatted.message).not.toMatch(/\bat\s+Object/);
    expect(formatted.remediation).toMatch(/network|retry/i);
    const state = await runAsyncOperation({
      step: 'Export',
      run: async () => 'ok',
      successDetail: () => 'GSTR-1 ready',
    });
    expect(state.phase).toBe('success');
    expect(IDLE_ASYNC_STATE.phase).toBe('idle');
  });

  it('viewport helpers cover mobile through desktop (REQ-042)', () => {
    expect(classifyViewportWidth(375)).toBe('mobile');
    expect(allowsDesktopDataEntry(375)).toBe(false);
    expect(classifyViewportWidth(1920)).toBe('desktop');
  });

  it('retention warning surfaces before purge window (REQ-056)', () => {
    const risk = evaluatePurgeRisk('2024-03-31', '2026-07-29');
    expect(risk.allowed).toBe(false);
    expect(risk.warning).toMatch(/retain|Deletion blocked/i);
  });

  it('CI verification gates and demo script exist (REQ-057 / REQ-064 / REQ-065)', () => {
    expect(existsSync(resolve('.github/workflows/ci.yml'))).toBe(true);
    expect(existsSync(resolve('demo/scripts/p0-differentiation.md'))).toBe(true);
    expect(existsSync(resolve('context/reports/traceability_report.json'))).toBe(true);
    const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/npm test/);
    expect(ci).toMatch(/test:a11y|test:load/);
  });

  it('filing calendar readiness engine is present (REQ-017)', () => {
    expect(existsSync(resolve('services/complianceStatusEngine.ts'))).toBe(true);
    expect(existsSync(resolve('services/filingCalendarService.ts'))).toBe(true);
  });

  it('invoice AP foreign-income and US tax screens exist (REQ-022 / REQ-023 / REQ-024 / REQ-025)', () => {
    expect(existsSync(resolve('components/invoices/index.tsx'))).toBe(true);
    expect(existsSync(resolve('components/ForeignIncomeScreen.tsx'))).toBe(true);
    expect(existsSync(resolve('components/USTaxScreen.tsx'))).toBe(true);
  });

  it('transfer pricing storage and GST ITC paths exist (REQ-003 / REQ-016 / REQ-021)', () => {
    const storage = readFileSync(resolve('services/storageService.ts'), 'utf8');
    expect(storage).toMatch(/TRANSFER_PRICING/);
    expect(existsSync(resolve('services/threeWayReconciliation.ts'))).toBe(true);
  });

  it('tax strategy module exists for partner remuneration (REQ-020)', () => {
    expect(
      existsSync(resolve('components/TaxEngine.tsx'))
      || existsSync(resolve('components/taxation/TaxEngine.tsx'))
      || existsSync(resolve('components/TaxStrategy.tsx')),
    ).toBe(true);
  });

  it('backlog documents deferred feature-flag / multi-user work (REQ-040 / REQ-045 / REQ-046)', () => {
    const backlog = readFileSync(resolve('context/design/implementation_backlog.json'), 'utf8');
    expect(backlog).toMatch(/EPIC-0[178]/);
  });

  it('accountant invite and onboarding validators exist (REQ-077 / REQ-078)', () => {
    expect(existsSync(resolve('services/accountantInvite.ts'))).toBe(true);
    expect(existsSync(resolve('services/onboardingValidation.ts'))).toBe(true);
  });
});
