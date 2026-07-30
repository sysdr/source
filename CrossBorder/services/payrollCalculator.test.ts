/**
 * Mutation-strong payroll calculator suite (RW-009c).
 * REQ: REQ-012, statutory PT/PF/TDS slabs
 */
import { describe, expect, it } from 'vitest';
import {
  calculateESI,
  calculateHRAExemption,
  calculatePF,
  calculatePT,
  calculateTDSNewRegime,
  calculateTDSOldRegime,
  checkMinimumWage,
  computeFullSalary,
  computeYTD,
  FY_MONTHS,
  getLOPDays,
  MONTHS,
} from './payrollCalculator';
import type { Employee, LeaveRequest, PayrollConfig, PayrollRunSlip } from '../types';

const emp: Employee = {
  id: 'E1',
  name: 'Ada',
  designation: 'Eng',
  ctc: 1_200_000,
  doj: '2024-01-01',
  status: 'Active',
  email: 'ada@example.com',
  documents: { pan: false, aadhaar: false, contract: false },
  taxRegime: 'new',
};

const config: PayrollConfig = {
  pfEnabled: true,
  esiEnabled: true,
  ptState: 'Maharashtra',
  standardWorkingDays: 26,
};

describe('calculatePT', () => {
  it('applies Maharashtra slabs including February surcharge', () => {
    expect(calculatePT(7000, 'Maharashtra', 'January')).toBe(0);
    expect(calculatePT(7500, 'Maharashtra', 'January')).toBe(0);
    expect(calculatePT(7501, 'Maharashtra', 'January')).toBe(175);
    expect(calculatePT(10000, 'Maharashtra', 'January')).toBe(175);
    expect(calculatePT(10001, 'Maharashtra', 'January')).toBe(200);
    expect(calculatePT(10001, 'Maharashtra', 'February')).toBe(300);
  });

  it('applies Karnataka and default fallback slabs', () => {
    expect(calculatePT(15000, 'Karnataka', 'January')).toBe(0);
    expect(calculatePT(15001, 'Karnataka', 'January')).toBe(200);
    expect(calculatePT(9000, 'UnknownState', 'January')).toBe(0);
    expect(calculatePT(10001, 'UnknownState', 'January')).toBe(200);
    expect(calculatePT(50000, 'Delhi', 'January')).toBe(0);
  });

  it('covers West Bengal / Telangana / Tamil Nadu / Gujarat boundaries', () => {
    expect(calculatePT(10000, 'West Bengal', 'January')).toBe(0);
    expect(calculatePT(10001, 'West Bengal', 'January')).toBe(110);
    expect(calculatePT(15000, 'West Bengal', 'January')).toBe(110);
    expect(calculatePT(15001, 'West Bengal', 'January')).toBe(130);
    expect(calculatePT(25000, 'West Bengal', 'January')).toBe(130);
    expect(calculatePT(25001, 'West Bengal', 'January')).toBe(150);
    expect(calculatePT(40000, 'West Bengal', 'January')).toBe(150);
    expect(calculatePT(40001, 'West Bengal', 'January')).toBe(200);

    expect(calculatePT(15000, 'Telangana', 'January')).toBe(0);
    expect(calculatePT(15001, 'Telangana', 'January')).toBe(150);
    expect(calculatePT(20000, 'Telangana', 'January')).toBe(150);
    expect(calculatePT(20001, 'Telangana', 'January')).toBe(200);
    expect(calculatePT(15000, 'Andhra Pradesh', 'January')).toBe(0);
    expect(calculatePT(15001, 'Andhra Pradesh', 'January')).toBe(150);
    expect(calculatePT(20000, 'Andhra Pradesh', 'January')).toBe(150);
    expect(calculatePT(20001, 'Andhra Pradesh', 'January')).toBe(200);

    expect(calculatePT(21000, 'Tamil Nadu', 'January')).toBe(0);
    expect(calculatePT(21001, 'Tamil Nadu', 'January')).toBe(135);
    expect(calculatePT(30000, 'Tamil Nadu', 'January')).toBe(135);
    expect(calculatePT(30001, 'Tamil Nadu', 'January')).toBe(315);
    expect(calculatePT(45000, 'Tamil Nadu', 'January')).toBe(315);
    expect(calculatePT(45001, 'Tamil Nadu', 'January')).toBe(690);
    expect(calculatePT(60000, 'Tamil Nadu', 'January')).toBe(690);
    expect(calculatePT(60001, 'Tamil Nadu', 'January')).toBe(1095);
    expect(calculatePT(75000, 'Tamil Nadu', 'January')).toBe(1095);
    expect(calculatePT(75001, 'Tamil Nadu', 'January')).toBe(1250);

    expect(calculatePT(6000, 'Gujarat', 'January')).toBe(0);
    expect(calculatePT(6001, 'Gujarat', 'January')).toBe(80);
    expect(calculatePT(9000, 'Gujarat', 'January')).toBe(80);
    expect(calculatePT(9001, 'Gujarat', 'January')).toBe(150);
    expect(calculatePT(12000, 'Gujarat', 'January')).toBe(150);
    expect(calculatePT(12001, 'Gujarat', 'January')).toBe(200);

    expect(calculatePT(12000, 'Rajasthan', 'January')).toBe(0);
    expect(calculatePT(12001, 'Rajasthan', 'January')).toBe(100);
    expect(calculatePT(15000, 'Rajasthan', 'January')).toBe(100);
    expect(calculatePT(15001, 'Rajasthan', 'January')).toBe(150);
    expect(calculatePT(20000, 'Rajasthan', 'January')).toBe(150);
    expect(calculatePT(20001, 'Rajasthan', 'January')).toBe(200);

    expect(calculatePT(12000, 'Kerala', 'January')).toBe(0);
    expect(calculatePT(12001, 'Kerala', 'January')).toBe(120);
    expect(calculatePT(18000, 'Kerala', 'January')).toBe(120);
    expect(calculatePT(18001, 'Kerala', 'January')).toBe(180);
    expect(calculatePT(25000, 'Kerala', 'January')).toBe(180);
    expect(calculatePT(25001, 'Kerala', 'January')).toBe(250);

    expect(calculatePT(10000, 'UnknownState', 'January')).toBe(0);
    expect(calculatePT(10001, 'UnknownState', 'January')).toBe(200);
  });
});

describe('calculateTDSNewRegime', () => {
  it('applies standard deduction, slabs, and 87A rebate with exact band values', () => {
    expect(calculateTDSNewRegime(74_999)).toBe(0);
    expect(calculateTDSNewRegime(75_000)).toBe(0);
    expect(calculateTDSNewRegime(300_000)).toBe(0);
    expect(calculateTDSNewRegime(775_000)).toBe(0); // taxable 700k → rebate
    expect(calculateTDSNewRegime(775_001)).toBeCloseTo(25_000.1, 5);
    expect(calculateTDSNewRegime(875_000)).toBe(35_000); // 10% band
    expect(calculateTDSNewRegime(1_000_000)).toBe(48_750); // 15% band
    expect(calculateTDSNewRegime(1_275_000)).toBe(90_000); // 20% band edge
    expect(calculateTDSNewRegime(1_575_000)).toBe(150_000); // 30% band edge
    expect(calculateTDSNewRegime(2_000_000)).toBe(277_500);
  });
});

describe('calculateTDSOldRegime', () => {
  it('applies deductions, slabs, 87A, and 4% cess with exact values', () => {
    expect(calculateTDSOldRegime(400_000, 0)).toBe(0);
    expect(calculateTDSOldRegime(1_200_000, 21_600, 100_000, 20_000, 0)).toBeCloseTo(118_747.2, 5);
    expect(calculateTDSOldRegime(3_000_000, 0, 0, 0, 0)).toBe(725_400);
    // hraExemption reduces taxable (subtract, not add)
    const withHra = calculateTDSOldRegime(3_000_000, 0, 0, 0, 100_000);
    expect(withHra).toBeLessThan(725_400);
  });

  it('caps 80C at 1.5L including EPF and 80D at 25k', () => {
    const capped = calculateTDSOldRegime(2_000_000, 200_000, 200_000, 0, 0);
    const uncappedLike = calculateTDSOldRegime(2_000_000, 150_000, 0, 0, 0);
    expect(capped).toBe(uncappedLike);
    const d25 = calculateTDSOldRegime(2_000_000, 0, 0, 25_000, 0);
    const d40 = calculateTDSOldRegime(2_000_000, 0, 0, 40_000, 0);
    expect(d25).toBe(d40);
  });
});

describe('calculatePF / ESI / HRA / min wage', () => {
  it('PF ceilings and disabled path', () => {
    expect(calculatePF(20_000, true)).toEqual({
      epfEmployee: 1800,
      epfEmployer: 551,
      epsEmployer: 1250,
      edliEmployer: 75,
    });
    expect(calculatePF(10_000, true).epfEmployee).toBe(1200);
    expect(calculatePF(10_000, false)).toEqual({
      epfEmployee: 0,
      epfEmployer: 0,
      epsEmployer: 0,
      edliEmployer: 0,
    });
  });

  it('ESI wraps evaluateEsi', () => {
    expect(calculateESI(20_000, true)).toEqual({ employee: 150, employer: 650 });
    expect(calculateESI(30_000, true)).toEqual({ employee: 0, employer: 0 });
    expect(calculateESI(15_000, false)).toEqual({ employee: 0, employer: 0 });
  });

  it('HRA exemption formula and metro vs non-metro', () => {
    expect(calculateHRAExemption(600_000, 240_000, 0, true)).toBe(0);
    const metro = calculateHRAExemption(600_000, 400_000, 400_000, true);
    const nonMetro = calculateHRAExemption(600_000, 400_000, 400_000, false);
    // min(hra, rent−10%basic, 50%/40% basic) → 300k metro vs 240k non-metro
    expect(metro).toBe(300_000);
    expect(nonMetro).toBe(240_000);
    expect(metro).toBeGreaterThan(nonMetro);
    const tight = calculateHRAExemption(600_000, 400_000, 200_000, false);
    // min(400k, 200k−60k=140k, 240k) = 140k
    expect(tight).toBe(140_000);
  });

  it('minimum wage compliance by state', () => {
    expect(checkMinimumWage(15_000, 'Maharashtra')).toEqual({ compliant: true, minimum: 14000 });
    expect(checkMinimumWage(13_000, 'Maharashtra')).toEqual({ compliant: false, minimum: 14000 });
    expect(checkMinimumWage(10_000, 'Nowhere')).toEqual({ compliant: true, minimum: 10000 });
    expect(checkMinimumWage(9999, 'Nowhere')).toEqual({ compliant: false, minimum: 10000 });
    expect(checkMinimumWage(17_494, 'Delhi').compliant).toBe(true);
  });
});

describe('getLOPDays', () => {
  it('counts approved leave only when balance is exhausted', () => {
    const leaves: LeaveRequest[] = [
      {
        id: 'L1',
        employeeId: 'E1',
        type: 'CL',
        fromDate: '2026-01-05',
        toDate: '2026-01-06',
        days: 2,
        status: 'Approved',
        reason: 'Personal',
        appliedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'L2',
        employeeId: 'E1',
        type: 'CL',
        fromDate: '2026-01-10',
        toDate: '2026-01-10',
        days: 1,
        status: 'Pending',
        reason: 'x',
        appliedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'L3',
        employeeId: 'E2',
        type: 'CL',
        fromDate: '2026-01-05',
        toDate: '2026-01-05',
        days: 1,
        status: 'Approved',
        reason: 'other',
        appliedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'L4',
        employeeId: 'E1',
        type: 'CL',
        fromDate: '2025-12-30',
        toDate: '2026-01-02',
        days: 4,
        status: 'Approved',
        reason: 'span',
        appliedAt: '2025-12-01T00:00:00.000Z',
      },
    ];
    const janLop = getLOPDays('E1', 'January', 2026, leaves, { CL: { total: 12, used: 12, remaining: 0 } });
    expect(janLop).toBeGreaterThanOrEqual(4);
    expect(getLOPDays('E1', 'January', 2026, leaves, { CL: { total: 12, used: 0, remaining: 10 } })).toBe(0);
    expect(getLOPDays('E1', 'February', 2026, leaves, { CL: { total: 12, used: 12, remaining: 0 } })).toBe(0);
    expect(getLOPDays('E1', 'December', 2025, leaves, { CL: { total: 12, used: 12, remaining: 0 } })).toBeGreaterThanOrEqual(2);
  });
});

describe('computeFullSalary / computeYTD', () => {
  it('computes new-regime slip with exact components and LOP', () => {
    const slip = computeFullSalary(emp, config, 'January', 2026, 0);
    expect(slip).toMatchObject({
      basic: 45_000,
      hra: 18_000,
      allowance: 37_000,
      grossEarnings: 100_000,
      epf: 1800,
      epfEmployer: 551,
      epsEmployer: 1250,
      edliEmployer: 75,
      esiEmployee: 0,
      esiEmployer: 0,
      pt: 200,
      tds: 6563,
      totalDeductions: 8563,
      netPay: 91_437,
      totalEmployerCost: 101_876,
      workingDays: 26,
      paidDays: 26,
      lopDays: 0,
      lopDeduction: 0,
      minWageCompliant: true,
    });
    expect(MONTHS).toEqual([
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]);
    expect(FY_MONTHS).toEqual([
      'April', 'May', 'June', 'July', 'August', 'September',
      'October', 'November', 'December', 'January', 'February', 'March',
    ]);

    const withLop = computeFullSalary(emp, config, 'January', 2026, 2);
    expect(withLop.paidDays).toBe(24);
    expect(withLop.grossEarnings).toBeLessThan(100_000);
    expect(withLop.lopDays).toBe(2);
    expect(withLop.lopDeduction).toBeGreaterThan(0);
  });

  it('computes ESI-eligible low-CTC slip with exact employer cost', () => {
    const low: Employee = { ...emp, ctc: 240_000 };
    const slip = computeFullSalary(low, config, 'January', 2026, 0);
    expect(slip).toMatchObject({
      grossEarnings: 20_000,
      epf: 1080,
      esiEmployee: 150,
      esiEmployer: 650,
      pt: 200,
      tds: 0,
      totalDeductions: 1430,
      netPay: 18_570,
      totalEmployerCost: 21_775,
      epfEmployer: 330,
      epsEmployer: 750,
      edliEmployer: 45,
    });
  });

  it('uses old regime path when taxRegime is old and defaults missing regime to new', () => {
    const oldEmp: Employee = {
      ...emp,
      taxRegime: 'old',
      section80C: 50_000,
      section80D: 10_000,
      hraExemptionRent: 20_000,
    };
    const slip = computeFullSalary(oldEmp, { ...config, ptState: 'Delhi' }, 'March', 2026, 0);
    expect(slip.tds).toBe(8221);
    expect(slip.pt).toBe(0);
    expect(slip.minWageCompliant).toBe(true);

    const noRegime = { ...emp };
    delete (noRegime as { taxRegime?: string }).taxRegime;
    const defaultNew = computeFullSalary(noRegime, config, 'January', 2026, 0);
    expect(defaultNew.tds).toBe(6563);
  });

  it('aggregates YTD across slips for one employee', () => {
    const slips: PayrollRunSlip[] = [
      {
        employeeId: 'E1',
        employeeName: 'Ada',
        basic: 100,
        hra: 40,
        allowance: 60,
        grossEarnings: 200,
        epf: 12,
        esiEmployee: 1,
        pt: 200,
        tds: 10,
        totalDeductions: 223,
        netPay: -23,
        epfEmployer: 5,
        epsEmployer: 5,
        esiEmployer: 3,
        lopDays: 0,
        paidDays: 26,
        workingDays: 26,
      },
      {
        employeeId: 'E2',
        employeeName: 'Bob',
        basic: 999,
        hra: 1,
        allowance: 1,
        grossEarnings: 1001,
        epf: 1,
        esiEmployee: 1,
        pt: 1,
        tds: 1,
        totalDeductions: 4,
        netPay: 997,
        epfEmployer: 1,
        epsEmployer: 1,
        esiEmployer: 1,
        lopDays: 0,
        paidDays: 26,
        workingDays: 26,
      },
    ];
    const ytd = computeYTD('E1', 'Ada', slips);
    expect(ytd).toEqual({
      employeeId: 'E1',
      employeeName: 'Ada',
      totalGross: 200,
      totalBasic: 100,
      totalHRA: 40,
      totalAllowance: 60,
      totalEPF: 12,
      totalESI: 1,
      totalPT: 200,
      totalTDS: 10,
      totalDeductions: 223,
      totalNet: -23,
      monthsProcessed: 1,
    });
  });
});
