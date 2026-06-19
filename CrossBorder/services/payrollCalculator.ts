import { Employee, SalarySlip, PayrollRunSlip, LeaveRequest } from '../types';
import { PayrollConfig } from '../types';

// ── Professional Tax Slabs by State (monthly) ──────────────────────────────

const PT_SLABS: Record<string, (monthlySalary: number, isFebruary: boolean) => number> = {
  Maharashtra: (m, isFeb) => {
    if (m <= 7500) return 0;
    if (m <= 10000) return 175;
    return isFeb ? 300 : 200;
  },
  Karnataka: (m) => (m <= 15000 ? 0 : 200),
  'West Bengal': (m) => {
    if (m <= 10000) return 0;
    if (m <= 15000) return 110;
    if (m <= 25000) return 130;
    if (m <= 40000) return 150;
    return 200;
  },
  Telangana: (m) => {
    if (m <= 15000) return 0;
    if (m <= 20000) return 150;
    return 200;
  },
  'Andhra Pradesh': (m) => {
    if (m <= 15000) return 0;
    if (m <= 20000) return 150;
    return 200;
  },
  'Tamil Nadu': (m) => {
    if (m <= 21000) return 0;
    if (m <= 30000) return 135;
    if (m <= 45000) return 315;
    if (m <= 60000) return 690;
    if (m <= 75000) return 1095;
    return 1250;
  },
  Gujarat: (m) => {
    if (m <= 6000) return 0;
    if (m <= 9000) return 80;
    if (m <= 12000) return 150;
    return 200;
  },
  Rajasthan: (m) => {
    if (m <= 12000) return 0;
    if (m <= 15000) return 100;
    if (m <= 20000) return 150;
    return 200;
  },
  Kerala: (m) => {
    if (m <= 12000) return 0;
    if (m <= 18000) return 120;
    if (m <= 25000) return 180;
    return 250;
  },
  Delhi: () => 0,
};

export function calculatePT(monthlySalary: number, state: string, month: string): number {
  const isFeb = month === 'February';
  const fn = PT_SLABS[state];
  if (fn) return fn(monthlySalary, isFeb);
  return monthlySalary <= 10000 ? 0 : 200;
}

// ── TDS Calculation (New Regime FY 2025-26) ─────────────────────────────────

export function calculateTDSNewRegime(annualTaxableIncome: number): number {
  const taxable = annualTaxableIncome - 75000; // Standard deduction
  if (taxable <= 0) return 0;
  let tax = 0;
  if (taxable > 1500000) tax = (taxable - 1500000) * 0.30 + 150000;
  else if (taxable > 1200000) tax = (taxable - 1200000) * 0.20 + 90000;
  else if (taxable > 900000) tax = (taxable - 900000) * 0.15 + 45000;
  else if (taxable > 600000) tax = (taxable - 600000) * 0.10 + 15000;
  else if (taxable > 300000) tax = (taxable - 300000) * 0.05;
  // Section 87A rebate: if taxable <= 7,00,000 then tax = 0 under new regime
  if (taxable <= 700000) tax = 0;
  return Math.max(0, tax);
}

export function calculateTDSOldRegime(
  annualGross: number,
  epfAnnual: number,
  sec80C: number = 0,
  sec80D: number = 0,
  hraExemption: number = 0,
): number {
  const standardDeduction = 50000;
  let taxable = annualGross - standardDeduction - hraExemption;
  const totalSec80C = Math.min(150000, sec80C + epfAnnual);
  taxable -= totalSec80C;
  taxable -= Math.min(25000, sec80D);
  taxable = Math.max(0, taxable);
  if (taxable <= 0) return 0;
  let tax = 0;
  if (taxable > 1500000) tax = (taxable - 1500000) * 0.30 + 262500;
  else if (taxable > 1250000) tax = (taxable - 1250000) * 0.25 + 200000;
  else if (taxable > 1000000) tax = (taxable - 1000000) * 0.20 + 112500;
  else if (taxable > 750000) tax = (taxable - 750000) * 0.15 + 75000;
  else if (taxable > 500000) tax = (taxable - 500000) * 0.10 + 25000;
  else if (taxable > 250000) tax = (taxable - 250000) * 0.05;
  // Section 87A rebate: taxable ≤ 5L → 0 tax
  if (taxable <= 500000) tax = 0;
  tax += tax * 0.04; // 4% Health & Education Cess
  return Math.max(0, tax);
}

// ── ESI Calculation ─────────────────────────────────────────────────────────

const ESI_GROSS_LIMIT = 21000;
const ESI_EMPLOYEE_RATE = 0.0075;
const ESI_EMPLOYER_RATE = 0.0325;

export function calculateESI(monthlyGross: number, esiEnabled: boolean): { employee: number; employer: number } {
  if (!esiEnabled || monthlyGross > ESI_GROSS_LIMIT) return { employee: 0, employer: 0 };
  return {
    employee: Math.round(monthlyGross * ESI_EMPLOYEE_RATE),
    employer: Math.round(monthlyGross * ESI_EMPLOYER_RATE),
  };
}

// ── EPF / EPS / EDLI Calculation ────────────────────────────────────────────

const EPF_CEILING = 15000;
const EPF_EMPLOYEE_RATE = 0.12;
const EPF_EMPLOYER_RATE = 0.0367;
const EPS_RATE = 0.0833;
const EDLI_RATE = 0.005;

export function calculatePF(basicMonthly: number, pfEnabled: boolean): {
  epfEmployee: number;
  epfEmployer: number;
  epsEmployer: number;
  edliEmployer: number;
} {
  if (!pfEnabled) return { epfEmployee: 0, epfEmployer: 0, epsEmployer: 0, edliEmployer: 0 };
  const pfWage = Math.min(basicMonthly, EPF_CEILING);
  return {
    epfEmployee: Math.round(pfWage * EPF_EMPLOYEE_RATE),
    epfEmployer: Math.round(pfWage * EPF_EMPLOYER_RATE),
    epsEmployer: Math.round(pfWage * EPS_RATE),
    edliEmployer: Math.round(pfWage * EDLI_RATE),
  };
}

// ── HRA Exemption (Old Regime) ──────────────────────────────────────────────

export function calculateHRAExemption(basicAnnual: number, hraAnnual: number, rentPaidAnnual: number, isMetro: boolean): number {
  if (rentPaidAnnual <= 0) return 0;
  const a = hraAnnual;
  const b = rentPaidAnnual - 0.10 * basicAnnual;
  const c = (isMetro ? 0.50 : 0.40) * basicAnnual;
  return Math.max(0, Math.min(a, b, c));
}

// ── Minimum Wages Check (simplified, major states) ──────────────────────────

const MIN_WAGES: Record<string, number> = {
  Maharashtra: 14000,
  Karnataka: 13000,
  Delhi: 17494,
  'Tamil Nadu': 12000,
  Telangana: 13000,
  'West Bengal': 10000,
  Gujarat: 11000,
  Kerala: 12500,
  'Andhra Pradesh': 12000,
  Rajasthan: 11000,
};

export function checkMinimumWage(monthlyGross: number, state: string): { compliant: boolean; minimum: number } {
  const min = MIN_WAGES[state] ?? 10000;
  return { compliant: monthlyGross >= min, minimum: min };
}

// ── LOP Calculation ─────────────────────────────────────────────────────────

export function getLOPDays(
  employeeId: string,
  month: string,
  year: number,
  leaveRequests: LeaveRequest[],
  leaveBalances: Record<string, { total: number; used: number; remaining: number }>,
): number {
  const approved = leaveRequests.filter(
    (lr) =>
      lr.employeeId === employeeId &&
      lr.status === 'Approved' &&
      isLeaveInMonth(lr, month, year),
  );
  let lopDays = 0;
  for (const lr of approved) {
    const daysInMonth = getLeaveOverlapDays(lr, month, year);
    const balance = leaveBalances[lr.type];
    if (!balance || balance.remaining <= 0) {
      lopDays += daysInMonth;
    }
  }
  return lopDays;
}

function isLeaveInMonth(lr: LeaveRequest, month: string, year: number): boolean {
  const monthIdx = MONTHS.indexOf(month);
  const startOfMonth = new Date(year, monthIdx, 1);
  const endOfMonth = new Date(year, monthIdx + 1, 0);
  const from = new Date(lr.fromDate);
  const to = new Date(lr.toDate);
  return from <= endOfMonth && to >= startOfMonth;
}

function getLeaveOverlapDays(lr: LeaveRequest, month: string, year: number): number {
  const monthIdx = MONTHS.indexOf(month);
  const startOfMonth = new Date(year, monthIdx, 1);
  const endOfMonth = new Date(year, monthIdx + 1, 0);
  const from = new Date(lr.fromDate);
  const to = new Date(lr.toDate);
  const overlapStart = from > startOfMonth ? from : startOfMonth;
  const overlapEnd = to < endOfMonth ? to : endOfMonth;
  if (overlapStart > overlapEnd) return 0;
  return Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

// ── Full Salary Computation ─────────────────────────────────────────────────

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const FY_MONTHS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
];

export interface FullSalaryResult extends SalarySlip {
  esiEmployee: number;
  esiEmployer: number;
  epfEmployer: number;
  epsEmployer: number;
  edliEmployer: number;
  grossEarnings: number;
  totalDeductions: number;
  totalEmployerCost: number;
  lopDays: number;
  lopDeduction: number;
  workingDays: number;
  paidDays: number;
  minWageCompliant: boolean;
}

export function computeFullSalary(
  emp: Employee,
  config: PayrollConfig,
  month: string,
  year: number,
  lopDays: number = 0,
): FullSalaryResult {
  const workingDays = config.standardWorkingDays;
  const paidDays = Math.max(0, workingDays - lopDays);
  const paidRatio = workingDays > 0 ? paidDays / workingDays : 1;

  const monthlyCtc = emp.ctc / 12;
  const basic = Math.round(monthlyCtc * 0.45);
  const hra = Math.round(basic * 0.4);
  const allowance = Math.round(monthlyCtc - basic - hra);

  const adjustedBasic = Math.round(basic * paidRatio);
  const adjustedHra = Math.round(hra * paidRatio);
  const adjustedAllowance = Math.round(allowance * paidRatio);
  const grossEarnings = adjustedBasic + adjustedHra + adjustedAllowance;
  const lopDeduction = Math.round(monthlyCtc - grossEarnings);

  const pf = calculatePF(adjustedBasic, config.pfEnabled);
  const esi = calculateESI(grossEarnings, config.esiEnabled);
  const pt = calculatePT(grossEarnings, config.ptState, month);

  const regime = emp.taxRegime || 'new';
  const annualGross = emp.ctc;
  let annualTds: number;
  if (regime === 'old') {
    const hraExemption = emp.hraExemptionRent
      ? calculateHRAExemption(basic * 12, hra * 12, emp.hraExemptionRent * 12, ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'West Bengal', 'Telangana'].includes(config.ptState))
      : 0;
    annualTds = calculateTDSOldRegime(annualGross, pf.epfEmployee * 12, emp.section80C ?? 0, emp.section80D ?? 0, hraExemption);
  } else {
    annualTds = calculateTDSNewRegime(annualGross);
  }
  const monthlyTds = Math.round(annualTds / 12);

  const totalDeductions = pf.epfEmployee + esi.employee + pt + monthlyTds;
  const netPay = grossEarnings - totalDeductions;
  const totalEmployerCost = grossEarnings + pf.epfEmployer + pf.epsEmployer + pf.edliEmployer + esi.employer;

  const { compliant } = checkMinimumWage(grossEarnings, config.ptState);

  return {
    employeeId: emp.id,
    month,
    year,
    basic: adjustedBasic,
    hra: adjustedHra,
    allowance: adjustedAllowance,
    epf: pf.epfEmployee,
    pt,
    tds: monthlyTds,
    netPay,
    esiEmployee: esi.employee,
    esiEmployer: esi.employer,
    epfEmployer: pf.epfEmployer,
    epsEmployer: pf.epsEmployer,
    edliEmployer: pf.edliEmployer,
    grossEarnings,
    totalDeductions,
    totalEmployerCost,
    lopDays,
    lopDeduction,
    workingDays,
    paidDays,
    minWageCompliant: compliant,
  };
}

// ── YTD Aggregator ──────────────────────────────────────────────────────────

export interface YTDSummary {
  employeeId: string;
  employeeName: string;
  totalGross: number;
  totalBasic: number;
  totalHRA: number;
  totalAllowance: number;
  totalEPF: number;
  totalESI: number;
  totalPT: number;
  totalTDS: number;
  totalDeductions: number;
  totalNet: number;
  monthsProcessed: number;
}

export function computeYTD(
  employeeId: string,
  employeeName: string,
  slips: PayrollRunSlip[],
): YTDSummary {
  const empSlips = slips.filter((s) => s.employeeId === employeeId);
  return {
    employeeId,
    employeeName,
    totalGross: empSlips.reduce((a, s) => a + s.grossEarnings, 0),
    totalBasic: empSlips.reduce((a, s) => a + s.basic, 0),
    totalHRA: empSlips.reduce((a, s) => a + s.hra, 0),
    totalAllowance: empSlips.reduce((a, s) => a + s.allowance, 0),
    totalEPF: empSlips.reduce((a, s) => a + s.epf, 0),
    totalESI: empSlips.reduce((a, s) => a + s.esiEmployee, 0),
    totalPT: empSlips.reduce((a, s) => a + s.pt, 0),
    totalTDS: empSlips.reduce((a, s) => a + s.tds, 0),
    totalDeductions: empSlips.reduce((a, s) => a + s.totalDeductions, 0),
    totalNet: empSlips.reduce((a, s) => a + s.netPay, 0),
    monthsProcessed: empSlips.length,
  };
}
