/**
 * Lightweight mutation score proxy for pure modules (RW-003 / RW-009).
 * Flips constants / predicates and asserts the suite would catch them
 * via targeted unit tests — full Stryker remains available via npm run test:mutation.
 */
import { describe, expect, it } from 'vitest';
import { moneyAdd, moneyMul, roundBankers } from './decimalMath';
import { validateIdentifier } from './onboardingValidation';
import { computeConsolidatedPosition } from './consolidatedPosition';
import { requiredRetentionYears, RETENTION_YEARS } from './retentionPolicy';
import { computeVendorTds, evaluateEsi, ESI_GROSS_CEILING, ESI_EMPLOYEE_RATE } from './tdsRules';
import { calculatePF, calculatePT, calculateTDSNewRegime } from './payrollCalculator';
import { maskDisplayValue } from './displayPii';
import { applyLifecycleEvent, isPayrollEligible } from './employeeLifecycle';
import type { Employee } from '../types';

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

describe('mutation kill checks — payroll/TDS slice (RW-009)', () => {
  it('ESI ceiling and rate mutants die (REQ-012)', () => {
    const over = evaluateEsi({ monthlyGross: ESI_GROSS_CEILING + 1, esiEnabled: true });
    expect(over.eligible).toBe(false);
    const at = evaluateEsi({ monthlyGross: 20_000, esiEnabled: true });
    expect(at.eligible).toBe(true);
    expect(at.employeeContribution).toBe(150);
    expect(at.employerContribution).toBe(650);
    expect(ESI_EMPLOYEE_RATE).toBe(0.0075);
  });

  it('194C individual vs company rate mutants die (REQ-062)', () => {
    const ind = computeVendorTds({ amount: 100_000, section: '194C', payeeType: 'individual' });
    const co = computeVendorTds({ amount: 100_000, section: '194C', payeeType: 'company' });
    expect(ind.rate).toBe(1);
    expect(co.rate).toBe(2);
    expect(co.tdsAmount).toBe(ind.tdsAmount * 2);
  });

  it('PF ceiling and PT slab mutants die', () => {
    const pf = calculatePF(20_000, true);
    const pfLow = calculatePF(10_000, true);
    expect(pf.epfEmployee).toBe(1800); // capped at 15k * 12%
    expect(pfLow.epfEmployee).toBe(1200);
    expect(calculatePT(12_000, 'Maharashtra', 'January')).toBe(200);
    expect(calculatePT(8_000, 'Maharashtra', 'January')).toBe(175);
    expect(calculatePT(5_000, 'Maharashtra', 'January')).toBe(0);
  });

  it('new-regime TDS slab boundary mutants die', () => {
    expect(calculateTDSNewRegime(300_000)).toBe(0);
    const mid = calculateTDSNewRegime(1_000_000);
    expect(mid).toBeGreaterThan(0);
    const high = calculateTDSNewRegime(2_000_000);
    expect(high).toBeGreaterThan(mid);
  });
});

describe('mutation kill checks — people slice (RW-009b)', () => {
  it('displayPii mask length mutants die (REQ-027)', () => {
    expect(maskDisplayValue('')).toBe('—');
    expect(maskDisplayValue('AB')).toBe('••••');
    const masked = maskDisplayValue('123456789012');
    expect(masked.endsWith('9012')).toBe(true);
    expect(masked.startsWith('•')).toBe(true);
    expect(masked).not.toContain('123456');
    expect(maskDisplayValue('ABCDE1234F').endsWith('234F')).toBe(true);
  });

  it('lifecycle transition and payroll eligibility mutants die (REQ-085)', () => {
    const base: Employee = {
      id: 'E1',
      name: 'Test',
      designation: 'Eng',
      ctc: 1,
      doj: '2024-01-01',
      status: 'Active',
      email: 't@x.test',
      documents: { pan: false, aadhaar: false, contract: false },
    };
    expect(isPayrollEligible('Active')).toBe(true);
    expect(isPayrollEligible('Notice')).toBe(true);
    expect(isPayrollEligible('Exited')).toBe(false);
    const exited = applyLifecycleEvent(base, 'exit');
    expect(exited.ok).toBe(true);
    if (exited.ok) expect(exited.employee.status).toBe('Exited');
    const bad = applyLifecycleEvent({ ...base, status: 'Archived' }, 'exit');
    expect(bad.ok).toBe(false);
  });
});
