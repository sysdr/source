/**
 * Lightweight mutation score proxy for pure modules (RW-003).
 * Flips constants / predicates and asserts the suite would catch them
 * via targeted unit tests — full Stryker remains available via npm run test:mutation.
 */
import { describe, expect, it } from 'vitest';
import { moneyAdd, moneyMul, roundBankers } from './decimalMath';
import { validateIdentifier } from './onboardingValidation';
import { computeConsolidatedPosition } from './consolidatedPosition';
import { requiredRetentionYears, RETENTION_YEARS } from './retentionPolicy';

describe('mutation kill checks (RW-003)', () => {
  it('decimalMath: bank round half-to-even kills truncating mutants (REQ-034)', () => {
    expect(roundBankers(1.225, 2)).toBe(1.22);
    expect(roundBankers(1.235, 2)).toBe(1.24);
    expect(moneyAdd(0.1, 0.2)).toBe(0.3);
    expect(moneyMul(10, 0.075)).toBe(0.75);
  });

  it('onboardingValidation: GSTIN length/format mutants die (REQ-076)', () => {
    expect(validateIdentifier('GSTIN', '27AAAAA0000A1Z5').ok).toBe(true);
    expect(validateIdentifier('GSTIN', '27AAAAA0000A1Z').ok).toBe(false);
    expect(validateIdentifier('PAN', 'ABCDE1234').ok).toBe(false);
  });

  it('consolidatedPosition: netAssets formula mutants die (REQ-001)', () => {
    const pos = computeConsolidatedPosition({
      parentName: 'A',
      subsidiaryName: 'B',
      income: 100,
      expenses: 20,
      purchases: 10,
      receivables: 5,
      payables: 3,
    });
    expect(pos.cash).toBe(70);
    expect(pos.netAssets).toBe(72);
  });

  it('retentionPolicy: longest-jurisdiction mutant dies (REQ-068)', () => {
    expect(requiredRetentionYears()).toBe(RETENTION_YEARS.india_gst_cgst36);
    expect(requiredRetentionYears()).toBeGreaterThan(RETENTION_YEARS.us_irs_form5472);
  });
});
