/**
 * Payroll batch pre-validation + execution (REQ-011, REQ-035, REQ-059 / T-017, T-018).
 * Row-level failures never silently process; valid employees continue.
 */
import { randomUUID } from 'node:crypto';
import type { CompanyProfile, Employee, PayrollConfig, PayrollRun, PayrollRunSlip } from '../types.js';
import { computeFullSalary, MONTHS } from '../services/payrollCalculator.js';
import { IFSC_RE, PAN_RE } from '../services/employeeFieldValidation.js';

export type PayrollValidationCode =
  | 'MISSING_PAN'
  | 'INVALID_PAN'
  | 'MISSING_BANK_ACCOUNT'
  | 'MISSING_BANK_IFSC'
  | 'INVALID_BANK_IFSC'
  | 'MISSING_TAX_REGIME'
  | 'INVALID_CTC'
  | 'INACTIVE_STATUS';

export interface PayrollRowFailure {
  employeeId: string;
  employeeName: string;
  codes: PayrollValidationCode[];
  messages: string[];
}

export interface PayrollValidationReport {
  ok: boolean;
  totalEmployees: number;
  validCount: number;
  failedCount: number;
  failures: PayrollRowFailure[];
  validEmployeeIds: string[];
}

export interface PayrollBatchInput {
  orgId: string;
  month: string;
  year: number;
  employees: Employee[];
  payrollConfig?: PayrollConfig | null;
  /** Optional per-employee LOP overrides */
  lopByEmployeeId?: Record<string, number>;
  /** When true, refuse to create a run if any employee failed validation */
  failClosed?: boolean;
}

export interface PayrollOutputsBundle {
  payslips: Array<{ employeeId: string; employeeName: string; netPay: number; grossEarnings: number }>;
  suggestedExports: Array<{ kind: string; filename: string; description: string }>;
  summary: {
    processed: number;
    skipped: number;
    totalGross: number;
    totalStatutory: number;
    totalNet: number;
    totalEmployerCost: number;
  };
}

export interface PayrollBatchResult {
  ok: boolean;
  validation: PayrollValidationReport;
  run?: PayrollRun;
  outputs?: PayrollOutputsBundle;
  error?: string;
}

function normalizeMonth(month: string, year: number): { monthName: string; year: number } {
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    const monthName = MONTHS[m - 1];
    if (!monthName) throw new Error(`Invalid month in period: ${month}`);
    return { monthName, year: y || year };
  }
  if (!MONTHS.includes(month)) {
    throw new Error(`month must be a calendar name or YYYY-MM (got ${month})`);
  }
  return { monthName: month, year };
}

/** REQ-059 — validate one employee before payroll processing. */
export function validateEmployeeForPayroll(emp: Employee): PayrollRowFailure | null {
  const codes: PayrollValidationCode[] = [];
  const messages: string[] = [];

  if (emp.status && emp.status !== 'Active') {
    codes.push('INACTIVE_STATUS');
    messages.push(`Employee status is ${emp.status}; only Active employees are paid`);
  }

  const pan = (emp.panNumber || '').trim().toUpperCase();
  if (!pan) {
    codes.push('MISSING_PAN');
    messages.push('PAN is required for TDS (Form 24Q)');
  } else if (!PAN_RE.test(pan)) {
    codes.push('INVALID_PAN');
    messages.push('PAN must match format AAAAA9999A');
  }

  const account = (emp.bankAccountNumber || '').trim();
  if (!account) {
    codes.push('MISSING_BANK_ACCOUNT');
    messages.push('Bank account number is required for salary disbursement');
  }

  const ifsc = (emp.bankIFSC || '').trim().toUpperCase();
  if (!ifsc) {
    codes.push('MISSING_BANK_IFSC');
    messages.push('Bank IFSC is required for salary disbursement');
  } else if (!IFSC_RE.test(ifsc)) {
    codes.push('INVALID_BANK_IFSC');
    messages.push('IFSC must match format AAAA0XXXXXX');
  }

  if (emp.taxRegime !== 'new' && emp.taxRegime !== 'old') {
    codes.push('MISSING_TAX_REGIME');
    messages.push('TDS tax regime (new|old) must be selected');
  }

  if (!(Number(emp.ctc) > 0)) {
    codes.push('INVALID_CTC');
    messages.push('CTC must be a positive number');
  }

  if (codes.length === 0) return null;
  return {
    employeeId: emp.id,
    employeeName: emp.name || emp.id,
    codes,
    messages,
  };
}

export function validatePayrollEmployees(employees: Employee[]): PayrollValidationReport {
  // Only Active employees are payroll-eligible (REQ-011 / REQ-059).
  const eligible = employees.filter((e) => !e.status || e.status === 'Active');
  const failures: PayrollRowFailure[] = [];
  const validEmployeeIds: string[] = [];

  for (const emp of eligible) {
    const failure = validateEmployeeForPayroll(emp);
    if (failure) failures.push(failure);
    else validEmployeeIds.push(emp.id);
  }

  return {
    ok: failures.length === 0 && validEmployeeIds.length > 0,
    totalEmployees: eligible.length,
    validCount: validEmployeeIds.length,
    failedCount: failures.length,
    failures,
    validEmployeeIds,
  };
}

function defaultConfig(cfg?: PayrollConfig | null): PayrollConfig {
  return cfg || {
    pfEnabled: true,
    esiEnabled: false,
    ptState: 'Maharashtra',
    standardWorkingDays: 22,
  };
}

function buildOutputsBundle(
  run: PayrollRun,
  skipped: number,
): PayrollOutputsBundle {
  const fyStart = run.month === 'January' || run.month === 'February' || run.month === 'March'
    ? run.year - 1
    : run.year;
  const fy = `${fyStart}-${String(fyStart + 1).slice(2)}`;
  return {
    payslips: run.employeeSlips.map((s) => ({
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      netPay: s.netPay,
      grossEarnings: s.grossEarnings,
    })),
    suggestedExports: [
      {
        kind: 'form24q',
        filename: `Form24Q_${run.month}_${fy}.csv`,
        description: 'NSDL/Traces Form 24Q salary TDS extract',
      },
      {
        kind: 'pf_ecr',
        filename: `PF_ECR_${run.month}_${run.year}.txt`,
        description: 'EPFO Electronic Challan-cum-Return',
      },
      {
        kind: 'payroll_register',
        filename: `Payroll_Register_${run.month}_${run.year}.csv`,
        description: 'Full payroll register for the run',
      },
      {
        kind: 'bank_neft',
        filename: `Bank_Payment_${run.month}_${run.year}.csv`,
        description: 'NEFT salary disbursement file',
      },
    ],
    summary: {
      processed: run.employeeCount,
      skipped,
      totalGross: run.totalGross,
      totalStatutory: run.totalStatutory,
      totalNet: run.totalNet,
      totalEmployerCost: run.totalEmployerCost,
    },
  };
}

/**
 * Execute payroll for valid employees only (REQ-011 / REQ-059).
 * Failed rows are reported; they are never silently included.
 */
export function runPayrollBatch(input: PayrollBatchInput): PayrollBatchResult {
  let monthName: string;
  let year: number;
  try {
    const normalized = normalizeMonth(input.month, input.year);
    monthName = normalized.monthName;
    year = normalized.year;
  } catch (err) {
    return {
      ok: false,
      validation: {
        ok: false,
        totalEmployees: 0,
        validCount: 0,
        failedCount: 0,
        failures: [],
        validEmployeeIds: [],
      },
      error: (err as Error).message,
    };
  }

  const validation = validatePayrollEmployees(input.employees);
  if (input.failClosed && validation.failedCount > 0) {
    return {
      ok: false,
      validation,
      error: `${validation.failedCount} employee(s) failed pre-validation; failClosed=true`,
    };
  }
  if (validation.validCount === 0) {
    return {
      ok: false,
      validation,
      error: 'No employees passed pre-validation; payroll run not created',
    };
  }

  const config = defaultConfig(input.payrollConfig);
  const byId = new Map(input.employees.map((e) => [e.id, e]));
  const employeeSlips: PayrollRunSlip[] = [];
  let totalEmployerCost = 0;

  for (const empId of validation.validEmployeeIds) {
    const emp = byId.get(empId);
    if (!emp) continue;
    const lopDays = Number(input.lopByEmployeeId?.[empId] ?? 0) || 0;
    const slip = computeFullSalary(emp, config, monthName, year, lopDays);
    employeeSlips.push({
      employeeId: emp.id,
      employeeName: emp.name,
      basic: slip.basic,
      hra: slip.hra,
      allowance: slip.allowance,
      grossEarnings: slip.grossEarnings,
      epf: slip.epf,
      esiEmployee: slip.esiEmployee,
      pt: slip.pt,
      tds: slip.tds,
      totalDeductions: slip.totalDeductions,
      netPay: slip.netPay,
      epfEmployer: slip.epfEmployer,
      epsEmployer: slip.epsEmployer,
      esiEmployer: slip.esiEmployer,
      lopDays: slip.lopDays,
      paidDays: slip.paidDays,
      workingDays: slip.workingDays,
    });
    totalEmployerCost += slip.totalEmployerCost;
  }

  const totals = employeeSlips.reduce(
    (a, s) => ({
      gross: a.gross + s.grossEarnings,
      stat: a.stat + s.totalDeductions,
      net: a.net + s.netPay,
    }),
    { gross: 0, stat: 0, net: 0 },
  );

  const run: PayrollRun = {
    id: `RUN-${randomUUID()}`,
    month: monthName,
    year,
    runAt: new Date().toISOString(),
    employeeCount: employeeSlips.length,
    totalGross: totals.gross,
    totalStatutory: totals.stat,
    totalNet: totals.net,
    totalEmployerCost,
    employeeSlips,
  };

  const outputs = buildOutputsBundle(run, validation.failedCount);

  return {
    ok: true,
    validation,
    run,
    outputs,
  };
}
