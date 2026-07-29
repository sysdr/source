/**
 * Form 26Q NSDL/Traces-oriented CSV generator (REQ-010, REQ-049 / T-020).
 * Non-salary TDS deductee detail — pure builder; callers download or respond.
 */
import type { CompanyProfile, Transaction, WithholdingPayment } from '../../types';
import { disclaimerCommentLines, withDisclaimerMeta } from './disclaimer';
import { validateExport, type ValidationResult } from './validateExport';
import type { Quarter } from './form24q';

/** NSDL e-TDS 26Q deductee detail column order (simplified MVP contract). */
export const FORM26Q_NSDL_HEADERS = [
  'Line Number',
  'Permanent Account Number (PAN)',
  'Name of Deductee',
  'Section Code under which tax deducted',
  'Date of Payment / Credit',
  'Amount Paid / Credited',
  'Total Tax Deducted',
  'Total Tax Deposited',
  'Tax Deduction Account Number (TAN)',
  'Assessment Year',
] as const;

export interface Form26qDeducteeInput {
  pan?: string;
  name: string;
  section: string;
  amountPaid: number;
  tdsDeducted: number;
  paymentDate: string;
}

export interface Form26qInput {
  quarter: Quarter;
  financialYear: string;
  profile: CompanyProfile;
  deductees: Form26qDeducteeInput[];
}

function assessmentYear(financialYear: string): string {
  const [fyStart] = financialYear.split('-').map(Number);
  return `${fyStart + 1}-${String(fyStart + 2).slice(2)}`;
}

/** Map stored withholding payments (exclude salary Sec 192) into 26Q deductee rows. */
export function withholdingsTo26qDeductees(
  withholdings: WithholdingPayment[],
  quarter: string,
  financialYear: string,
): Form26qDeducteeInput[] {
  return withholdings
    .filter(
      (w) =>
        w.quarter === quarter
        && w.financialYear === financialYear
        && w.section !== '192'
        && (w.withheldAmount || 0) > 0,
    )
    .map((w) => ({
      pan: '',
      name: w.payeeName,
      section: w.section,
      amountPaid: w.amount,
      tdsDeducted: w.withheldAmount,
      paymentDate: w.date,
    }));
}

/** Map ledger transactions with vendor TDS into 26Q deductee rows. */
export function transactionsTo26qDeductees(transactions: Transaction[]): Form26qDeducteeInput[] {
  return transactions
    .filter(
      (tx) =>
        tx.tdsApplicable === true
        && typeof tx.tdsSection === 'string'
        && tx.tdsSection !== '192'
        && (tx.tdsAmount || 0) > 0
        && (tx.type === 'Expense' || tx.type === 'Purchase'),
    )
    .map((tx) => ({
      pan: '',
      name: tx.description,
      section: tx.tdsSection as string,
      amountPaid: tx.amount,
      tdsDeducted: tx.tdsAmount || 0,
      paymentDate: tx.date,
    }));
}

export function buildForm26qPayload(input: Form26qInput) {
  const tan = input.profile.parent?.taxId || input.profile.parent?.tan || 'TANNOTAVBL';
  const ay = assessmentYear(input.financialYear);

  const rows = input.deductees
    .filter((d) => d.tdsDeducted > 0 && d.amountPaid > 0)
    .map((d, idx) => ({
      srNo: idx + 1,
      deducteePan: (d.pan && d.pan.trim()) || 'PANNOTAVBL',
      deducteeName: d.name,
      sectionCode: d.section,
      paymentDate: d.paymentDate,
      amountPaid: Math.round(d.amountPaid),
      tdsDeducted: Math.round(d.tdsDeducted),
      tdsDeposited: Math.round(d.tdsDeducted),
      deductorTan: tan,
      assessmentYear: ay,
    }));

  const csvLines = [
    ...disclaimerCommentLines(),
    `# Form 26Q - Quarterly Statement of TDS (Other than Salary)`,
    `# Quarter: ${input.quarter} | Financial Year: ${input.financialYear}`,
    `# Deductor: ${input.profile.parent?.name || ''} | TAN: ${tan}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    FORM26Q_NSDL_HEADERS.join(','),
    ...rows.map((r) => [
      r.srNo,
      r.deducteePan,
      `"${r.deducteeName.replace(/"/g, '""')}"`,
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
    form: '26Q' as const,
    quarter: input.quarter,
    financialYear: input.financialYear,
    deductorName: input.profile.parent?.name || 'Unknown Deductor',
    deductorTan: tan,
    rows,
    csv: csvLines.join('\n'),
  });
}

export function generateForm26q(input: Form26qInput): ValidationResult {
  const payload = buildForm26qPayload(input);
  return validateExport('form26q', payload);
}
