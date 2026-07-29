import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeConsolidatedPosition } from './consolidatedPosition';
import { canAdvanceOnboardingStep, validateIdentifier } from './onboardingValidation';
import { evaluatePurgeRisk, requiredRetentionYears, RETENTION_YEARS } from './retentionPolicy';

describe('P0 traceability close-out (Phase 4)', () => {
  it('consolidates cash/AR/AP/net across both entities (REQ-001)', () => {
    const pos = computeConsolidatedPosition({
      parentName: 'SystemDR LLP',
      subsidiaryName: 'SystemDR, Inc.',
      income: 1_000_000,
      expenses: 200_000,
      purchases: 100_000,
      receivables: 50_000,
      payables: 30_000,
    });
    expect(pos.entities).toEqual(['SystemDR LLP', 'SystemDR, Inc.']);
    expect(pos.cash).toBe(700_000);
    expect(pos.netAssets).toBe(720_000);
  });

  it('rejects consolidation without both entity names (REQ-001 / REQ-053)', () => {
    expect(() => computeConsolidatedPosition({
      parentName: 'Only Parent',
      subsidiaryName: '',
      income: 1,
      expenses: 0,
      purchases: 0,
    })).toThrow(/subsidiary/i);
  });

  it('validates GSTIN/PAN/EIN/LLPIN before onboarding advance (REQ-076)', () => {
    expect(validateIdentifier('GSTIN', '27AAAAA0000A1Z5').ok).toBe(true);
    expect(validateIdentifier('GSTIN', 'bad').ok).toBe(false);
    expect(validateIdentifier('PAN', 'ABCDE1234F').ok).toBe(true);
    expect(validateIdentifier('EIN', '35-2939054').ok).toBe(true);
    expect(validateIdentifier('LLPIN', 'ABC-1234').ok).toBe(true);
    const blocked = canAdvanceOnboardingStep({ GSTIN: 'xx', PAN: 'ABCDE1234F' });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0]?.kind).toBe('GSTIN');
  });

  it('enforces longest jurisdictional retention before purge (REQ-068)', () => {
    expect(requiredRetentionYears()).toBe(RETENTION_YEARS.india_gst_cgst36);
    const blocked = evaluatePurgeRisk('2020-03-31', '2025-07-29');
    expect(blocked.allowed).toBe(false);
    expect(blocked.warning).toMatch(/Deletion blocked/i);
    const ok = evaluatePurgeRisk('2015-03-31', '2025-07-29');
    expect(ok.allowed).toBe(true);
  });

  it('CI runs npm audit and fails on high CVEs (REQ-071)', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['audit:deps']).toMatch(/npm audit/);
    const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/audit:deps/);
    expect(ci).toMatch(/npm test/);
  });
});
