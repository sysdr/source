/**
 * ESI + vendor TDS rules engine (REQ-012, REQ-062 / T-019).
 * Pure calculation helpers used by payroll batch and AP expense posting.
 */
import { moneyMul, moneyPercent, moneySub, roundMoney } from './decimalMath';

/** ESI wage ceiling (monthly gross) — contributions only at or below this. */
export const ESI_GROSS_CEILING = 21000;
export const ESI_EMPLOYEE_RATE = 0.0075; // 0.75%
export const ESI_EMPLOYER_RATE = 0.0325; // 3.25%

export type VendorTdsSection =
  | '194C'
  | '194J'
  | '194J(tech)'
  | '194J(prof)'
  | '194H'
  | '194I(a)'
  | '194I(b)'
  | '194Q';

export type PayeeType = 'individual' | 'huf' | 'company' | 'other';

export interface EsiEvaluation {
  eligible: boolean;
  reason: string;
  employeeContribution: number;
  employerContribution: number;
  totalContribution: number;
  ceiling: number;
  employeeRate: number;
  employerRate: number;
}

export interface VendorTdsResult {
  section: string;
  rate: number;
  amount: number;
  tdsAmount: number;
  netPayable: number;
  description: string;
  ledgerHint: {
    debitAccount: string;
    creditAccount: string;
    narration: string;
  };
}

export interface TdsSectionInfo {
  section: VendorTdsSection;
  label: string;
  defaultRate: number;
  notes: string;
}

/** Catalog of supported domestic vendor TDS sections (REQ-062). */
export const VENDOR_TDS_SECTIONS: TdsSectionInfo[] = [
  {
    section: '194C',
    label: 'Payments to contractors',
    defaultRate: 1,
    notes: '1% if payee is Individual/HUF; 2% otherwise',
  },
  {
    section: '194J(prof)',
    label: 'Professional / technical services (professional)',
    defaultRate: 10,
    notes: '10% on professional fees',
  },
  {
    section: '194J(tech)',
    label: 'Fees for technical services',
    defaultRate: 2,
    notes: '2% on technical services (reduced rate)',
  },
  {
    section: '194J',
    label: 'Fees for professional / technical services',
    defaultRate: 10,
    notes: 'Defaults to professional 10%; use 194J(tech) for 2%',
  },
  {
    section: '194H',
    label: 'Commission or brokerage',
    defaultRate: 5,
    notes: '5% on commission/brokerage',
  },
  {
    section: '194I(a)',
    label: 'Rent — plant & machinery',
    defaultRate: 2,
    notes: '2% on P&M rent',
  },
  {
    section: '194I(b)',
    label: 'Rent — land / building / furniture',
    defaultRate: 10,
    notes: '10% on land/building/furniture rent',
  },
  {
    section: '194Q',
    label: 'Purchase of goods',
    defaultRate: 0.1,
    notes: '0.1% when buyer turnover threshold met (MVP applies when selected)',
  },
];

export function resolveVendorTdsRate(
  section: string,
  payeeType: PayeeType = 'other',
): { rate: number; description: string } {
  const normalized = section.trim();
  switch (normalized) {
    case '194C': {
      const isIndiv = payeeType === 'individual' || payeeType === 'huf';
      return {
        rate: isIndiv ? 1 : 2,
        description: isIndiv
          ? '194C contractor TDS 1% (Individual/HUF)'
          : '194C contractor TDS 2% (non-Individual)',
      };
    }
    case '194J(tech)':
      return { rate: 2, description: '194J technical services TDS 2%' };
    case '194J(prof)':
    case '194J':
      return { rate: 10, description: '194J professional fees TDS 10%' };
    case '194H':
      return { rate: 5, description: '194H commission TDS 5%' };
    case '194I(a)':
      return { rate: 2, description: '194I(a) rent (P&M) TDS 2%' };
    case '194I(b)':
      return { rate: 10, description: '194I(b) rent (land/building) TDS 10%' };
    case '194Q':
      return { rate: 0.1, description: '194Q purchase of goods TDS 0.1%' };
    default: {
      const known = VENDOR_TDS_SECTIONS.find((s) => s.section === normalized);
      if (known) return { rate: known.defaultRate, description: known.label };
      throw new Error(`Unsupported TDS section: ${section}`);
    }
  }
}

/** Compute vendor/contractor TDS for a payment (REQ-062). */
export function computeVendorTds(input: {
  amount: number;
  section: string;
  payeeType?: PayeeType;
  payeeName?: string;
}): VendorTdsResult {
  if (!(input.amount > 0)) {
    throw new Error('amount must be positive');
  }
  const { rate, description } = resolveVendorTdsRate(input.section, input.payeeType ?? 'other');
  const tdsAmount = moneyPercent(input.amount, rate);
  const netPayable = moneySub(input.amount, tdsAmount);
  const payee = input.payeeName || 'vendor';
  return {
    section: input.section,
    rate,
    amount: input.amount,
    tdsAmount,
    netPayable,
    description,
    ledgerHint: {
      debitAccount: 'Expense / Purchase',
      creditAccount: 'TDS Payable',
      narration: `TDS u/s ${input.section} on payment to ${payee}`,
    },
  };
}

/**
 * ESI contribution evaluation (REQ-012).
 * Eligible only when ESI is enabled and monthly gross ≤ ceiling.
 */
export function evaluateEsi(input: {
  monthlyGross: number;
  esiEnabled: boolean;
}): EsiEvaluation {
  const ceiling = ESI_GROSS_CEILING;
  if (!input.esiEnabled) {
    return {
      eligible: false,
      reason: 'ESI is disabled in payroll config',
      employeeContribution: 0,
      employerContribution: 0,
      totalContribution: 0,
      ceiling,
      employeeRate: ESI_EMPLOYEE_RATE,
      employerRate: ESI_EMPLOYER_RATE,
    };
  }
  if (!(input.monthlyGross > 0)) {
    return {
      eligible: false,
      reason: 'Monthly gross must be positive',
      employeeContribution: 0,
      employerContribution: 0,
      totalContribution: 0,
      ceiling,
      employeeRate: ESI_EMPLOYEE_RATE,
      employerRate: ESI_EMPLOYER_RATE,
    };
  }
  if (input.monthlyGross > ceiling) {
    return {
      eligible: false,
      reason: `Monthly gross ${input.monthlyGross} exceeds ESI ceiling ${ceiling}`,
      employeeContribution: 0,
      employerContribution: 0,
      totalContribution: 0,
      ceiling,
      employeeRate: ESI_EMPLOYEE_RATE,
      employerRate: ESI_EMPLOYER_RATE,
    };
  }
  const employeeContribution = roundMoney(moneyMul(input.monthlyGross, ESI_EMPLOYEE_RATE));
  const employerContribution = roundMoney(moneyMul(input.monthlyGross, ESI_EMPLOYER_RATE));
  return {
    eligible: true,
    reason: 'Within ESI wage ceiling',
    employeeContribution,
    employerContribution,
    totalContribution: employeeContribution + employerContribution,
    ceiling,
    employeeRate: ESI_EMPLOYEE_RATE,
    employerRate: ESI_EMPLOYER_RATE,
  };
}

/**
 * Enrich a transaction-like payload with computed TDS fields when applicable.
 * Does not mutate when tdsApplicable is false or section missing.
 */
export function applyVendorTdsToTransaction(
  tx: Record<string, unknown>,
  payeeType: PayeeType = 'other',
): Record<string, unknown> {
  if (tx.tdsApplicable !== true) return tx;
  const section = typeof tx.tdsSection === 'string' ? tx.tdsSection : '';
  if (!section) return tx;
  const amount = Number(tx.amount) || 0;
  if (!(amount > 0)) return tx;
  try {
    const computed = computeVendorTds({
      amount,
      section,
      payeeType,
      payeeName: typeof tx.description === 'string' ? tx.description : undefined,
    });
    return {
      ...tx,
      tdsSection: computed.section,
      tdsRate: computed.rate,
      tdsAmount: computed.tdsAmount,
    };
  } catch {
    return tx;
  }
}
