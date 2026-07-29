/**
 * Form 24Q NSDL/Traces-oriented CSV generator (REQ-009, REQ-049).
 * Pure builder — callers decide download vs API response.
 */
import type { CompanyProfile, Employee, PayrollRun } from '../../types';
import { disclaimerCommentLines, withDisclaimerMeta } from './disclaimer';
import { validateExport, type ValidationResult } from './validateExport';

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

const QUARTER_MONTHS: Record<Quarter, string[]> = {
  Q1: ['April', 'May', 'June'],
  Q2: ['July', 'August', 'September'],
  Q3: ['October', 'November', 'December'],
  Q4: ['January', 'February', 'March'],
};

/** NSDL e-TDS deductee detail column order (simplified contract for MVP). */
export const FORM24Q_NSDL_HEADERS = [
  'Line Number',
  'Permanent Account Number (PAN)',
  'Name of Employee',
  'Section Code under which tax deducted',
  'Date of Payment / Credit',
  'Amount Paid / Credited',
  'Total Tax Deducted',
  'Total Tax Deposited',
  'Tax Deduction Account Number (TAN)',
  'Assessment Year',
] as const;

export interface Form24qInput {
  employees: Employee[];
  runs: PayrollRun[];
  quarter: Quarter;
  financialYear: string;
  profile: CompanyProfile;
}

function assessmentYear(financialYear: string): string {
  const [fyStart] = financialYear.split('-').map(Number);
  return `${fyStart + 1}-${String(fyStart + 2).slice(2)}`;
}

export function buildForm24qPayload(input: Form24qInput) {
  const months = QUARTER_MONTHS[input.quarter];
  const [fyStart] = input.financialYear.split('-').map(Number);
  const quarterRuns = input.runs.filter((r) => {
    if (!months.includes(r.month)) return false;
    const expectedYear = ['January', 'February', 'March'].includes(r.month) ? fyStart + 1 : fyStart;
    return r.year === expectedYear;
  });
  const allSlips = quarterRuns.flatMap((r) => r.employeeSlips);
  const tan = input.profile.parent?.taxId || input.profile.parent?.tan || 'TANNOTAVBL';
  const ay = assessmentYear(input.financialYear);
  const paymentDate = quarterRuns[quarterRuns.length - 1]?.runAt?.split('T')[0]
    || new Date().toISOString().slice(0, 10);

  const rows: Array<{
    srNo: number;
    employeePan: string;
    employeeName: string;
    sectionCode: '192';
    paymentDate: string;
    amountPaid: number;
    tdsDeducted: number;
    tdsDeposited: number;
    deductorTan: string;
    assessmentYear: string;
  }> = [];

  let sr = 1;
  for (const emp of input.employees) {
    const empSlips = allSlips.filter((s) => s.employeeId === emp.id);
    if (empSlips.length === 0) continue;
    const totalPaid = empSlips.reduce((a, s) => a + s.grossEarnings, 0);
    const totalTDS = empSlips.reduce((a, s) => a + s.tds, 0);
    if (totalTDS <= 0) continue;
    rows.push({
      srNo: sr++,
      employeePan: emp.panNumber || 'PANNOTAVBL',
      employeeName: emp.name,
      sectionCode: '192',
      paymentDate,
      amountPaid: Math.round(totalPaid),
      tdsDeducted: Math.round(totalTDS),
      tdsDeposited: Math.round(totalTDS),
      deductorTan: tan,
      assessmentYear: ay,
    });
  }

  const csvLines = [
    ...disclaimerCommentLines(),
    `# Form 24Q - Quarterly Statement of TDS on Salary`,
    `# Quarter: ${input.quarter} | Financial Year: ${input.financialYear}`,
    `# Deductor: ${input.profile.parent?.name || ''} | TAN: ${tan}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    FORM24Q_NSDL_HEADERS.join(','),
    ...rows.map((r) => [
      r.srNo,
      r.employeePan,
      `"${r.employeeName.replace(/"/g, '""')}"`,
      r.sectionCode,
      r.paymentDate,
      r.amountPaid,
      r.tdsDeducted,
      r.tdsDeposited,
      r.deductorTan,
      r.assessmentYear,
    ].join(',')),
  ];

  return withDisclaimerMeta({
    form: '24Q' as const,
    quarter: input.quarter,
    financialYear: input.financialYear,
    deductorName: input.profile.parent?.name || 'Unknown Deductor',
    deductorTan: tan,
    rows,
    csv: csvLines.join('\n'),
  });
}

export function generateForm24q(input: Form24qInput): ValidationResult {
  const payload = buildForm24qPayload(input);
  return validateExport('form24q', payload);
}
