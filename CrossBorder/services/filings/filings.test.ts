import { describe, expect, it } from 'vitest';
import type { CompanyProfile, Employee, PayrollRun, Transaction } from '../../types';
import {
  DEFERRED_FILINGS,
  FILING_DISCLAIMER,
  FORM24Q_NSDL_HEADERS,
  FORM26Q_NSDL_HEADERS,
  EPF_ECR_FIELDS,
  buildForm24qPayload,
  buildForm26qPayload,
  buildForm5472Payload,
  buildEpfEcrPayload,
  buildGstr1Payload,
  buildGstr3bPayload,
  form5472ToCsv,
  generateForm24q,
  generateForm26q,
  generateForm5472,
  generateEpfEcr,
  generateGstr1,
  generateGstr3b,
  transactionsTo26qDeductees,
  validateExport,
} from './index';

const profile: CompanyProfile = {
  parent: {
    name: 'SystemDR LLP',
    taxId: 'MUMS12345A',
    pan: 'ABCDE1234F',
    state: 'Maharashtra',
    stateCode: '27',
  },
  subsidiary: {
    name: 'SystemDR, Inc.',
    taxId: '35-2939054',
    ein: '35-2939054',
  },
} as CompanyProfile;

function txn(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount'>): Transaction {
  return {
    date: '2026-03-15',
    description: 'Test',
    currency: 'INR',
    source: 'Manual',
    category: 'Services',
    status: 'Completed',
    ...partial,
  } as Transaction;
}

describe('filing export schema validation (REQ-004 / REQ-029 / REQ-038)', () => {
  it('embeds mandatory disclaimer on every export (REQ-055)', () => {
    const g1 = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      supplierStateCode: '27',
      transactions: [],
    });
    expect(g1.meta.disclaimer).toBe(FILING_DISCLAIMER);
    expect(g1.meta.forReviewOnly).toBe(true);
  });

  it('lists deferred filings for Coming Soon UI (REQ-054)', () => {
    expect(DEFERRED_FILINGS.map((d) => d.id)).toEqual(['gstr9', 'form1120']);
  });
});

describe('GSTR-1 JSON (REQ-007 / REQ-048)', () => {
  it('builds GSTN-shaped payload and passes schema validation', () => {
    const transactions = [
      txn({
        id: 'INV-B2B-1',
        type: 'Income',
        amount: 10000,
        gstRate: 18,
        recipientGstin: '29BBBBB0000B1Z5',
        customerLocation: '29',
      }),
      txn({
        id: 'INV-EXP-1',
        type: 'Income',
        amount: 5000,
        gstRate: 0,
        customerCountry: 'US',
        classification: 'Export of Services' as Transaction['classification'],
      }),
      txn({
        id: 'INV-B2C-1',
        type: 'Income',
        amount: 1000,
        gstRate: 18,
        customerLocation: '27',
      }),
    ];

    const result = generateGstr1({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      supplierStateCode: '27',
      transactions,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    const data = result.data as ReturnType<typeof buildGstr1Payload>;
    expect(data.b2b).toHaveLength(1);
    expect(data.b2b[0].ctin).toBe('29BBBBB0000B1Z5');
    expect(data.exp[0].exp_typ).toBe('WOPAY');
    expect(data.exp[0].inv[0].inum).toBe('INV-EXP-1');
    expect(data.b2cs.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid filing period', () => {
    const payload = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '2026-03',
      transactions: [],
    });
    const result = validateExport('gstr1', payload);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'fp')).toBe(true);
  });
});

describe('GSTR-3B JSON (REQ-008 / REQ-048)', () => {
  it('builds summary tables and passes schema validation', () => {
    const result = generateGstr3b({
      gstin: '27AAAAA0000A1Z5',
      retPeriod: '032026',
      transactions: [
        txn({ id: 'I1', type: 'Income', amount: 10000, gstRate: 18, customerLocation: '27' }),
        txn({ id: 'E1', type: 'Income', amount: 2000, gstRate: 0, customerCountry: 'US' }),
        txn({ id: 'P1', type: 'Purchase', amount: 1000, gstRate: 18, gstImpact: 180, itcEligible: true }),
        txn({ id: 'P2', type: 'Purchase', amount: 500, gstRate: 18, gstImpact: 90, itcEligible: false }),
      ],
    });
    expect(result.ok).toBe(true);
    const data = result.data as ReturnType<typeof buildGstr3bPayload>;
    expect(data.sup_details.osup_det.txval).toBe(10000);
    expect(data.sup_details.osup_zero.txval).toBe(2000);
    expect(data.itc_elg.itc_avl[0].camt + data.itc_elg.itc_avl[0].samt).toBeCloseTo(180, 5);
  });
});

describe('Form 24Q CSV (REQ-009 / REQ-049)', () => {
  it('emits NSDL header order and validates rows', () => {
    const employees: Employee[] = [{
      id: 'emp-1',
      name: 'Ada Lovelace',
      designation: 'Engineer',
      ctc: 1200000,
      doj: '2025-01-01',
      status: 'Active',
      email: 'ada@example.com',
      documents: { pan: true, aadhaar: true, contract: true },
      panNumber: 'ABCDE1234F',
    } as Employee];

    const runs: PayrollRun[] = [{
      id: 'run-1',
      month: 'January',
      year: 2026,
      runAt: '2026-01-31T10:00:00.000Z',
      employeeCount: 1,
      totalNet: 80000,
      employeeSlips: [{
        employeeId: 'emp-1',
        employeeName: 'Ada Lovelace',
        workingDays: 31,
        paidDays: 31,
        lopDays: 0,
        basic: 50000,
        hra: 20000,
        allowance: 10000,
        grossEarnings: 80000,
        epf: 1800,
        esiEmployee: 0,
        pt: 200,
        tds: 5000,
        totalDeductions: 7000,
        netPay: 73000,
        epfEmployer: 1800,
        epsEmployer: 1250,
        esiEmployer: 0,
      }],
    } as PayrollRun];

    const result = generateForm24q({
      employees,
      runs,
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
    });

    expect(result.ok).toBe(true);
    const data = result.data as ReturnType<typeof buildForm24qPayload>;
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].sectionCode).toBe('192');
    expect(data.csv.split('\n').find((l) => l.startsWith('Line Number'))).toBe(FORM24Q_NSDL_HEADERS.join(','));
    expect(data.csv).toContain(FILING_DISCLAIMER);
  });
});

describe('Form 26Q CSV (REQ-010 / REQ-049 / T-020)', () => {
  it('emits NSDL header order and validates non-salary TDS rows', () => {
    const result = generateForm26q({
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
      deductees: [
        {
          pan: 'ABCDE1234F',
          name: 'Vendor CA LLP',
          section: '194J',
          amountPaid: 50000,
          tdsDeducted: 5000,
          paymentDate: '2026-01-15',
        },
        {
          name: 'Contractor',
          section: '194C',
          amountPaid: 100000,
          tdsDeducted: 1000,
          paymentDate: '2026-02-01',
        },
      ],
    });

    expect(result.ok).toBe(true);
    const data = result.data as ReturnType<typeof buildForm26qPayload>;
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0].sectionCode).toBe('194J');
    expect(data.rows[1].deducteePan).toBe('PANNOTAVBL');
    expect(data.csv.split('\n').find((l) => l.startsWith('Line Number'))).toBe(FORM26Q_NSDL_HEADERS.join(','));
    expect(data.csv).toContain(FILING_DISCLAIMER);
  });

  it('maps ledger TDS transactions into deductee rows', () => {
    const deductees = transactionsTo26qDeductees([
      txn({
        id: 'tx-tds-1',
        type: 'Expense',
        amount: 20000,
        description: 'Referral fee',
        tdsApplicable: true,
        tdsSection: '194H',
        tdsAmount: 1000,
        date: '2026-03-01',
      }),
      txn({
        id: 'tx-salary',
        type: 'Expense',
        amount: 50000,
        tdsApplicable: true,
        tdsSection: '192',
        tdsAmount: 5000,
      }),
    ]);
    expect(deductees).toHaveLength(1);
    expect(deductees[0].section).toBe('194H');
  });
});

describe('EPF ECR text (REQ-013 / REQ-050 / T-020)', () => {
  it('emits # delimited member lines and validates wage ceiling', () => {
    const employees: Employee[] = [{
      id: 'emp-1',
      name: 'Ada Lovelace',
      designation: 'Engineer',
      ctc: 1200000,
      doj: '2025-01-01',
      status: 'Active',
      email: 'ada@example.com',
      documents: { pan: true, aadhaar: true, contract: true },
      uan: '100200300400',
    } as Employee];

    const run: PayrollRun = {
      id: 'run-1',
      month: 'January',
      year: 2026,
      runAt: '2026-01-31T10:00:00.000Z',
      employeeCount: 1,
      totalNet: 80000,
      employeeSlips: [{
        employeeId: 'emp-1',
        employeeName: 'Ada Lovelace',
        workingDays: 31,
        paidDays: 31,
        lopDays: 0,
        basic: 50000,
        hra: 20000,
        allowance: 10000,
        grossEarnings: 80000,
        epf: 1800,
        esiEmployee: 0,
        pt: 200,
        tds: 0,
        totalDeductions: 2000,
        netPay: 78000,
        epfEmployer: 550,
        epsEmployer: 1250,
        esiEmployer: 0,
      }],
    } as PayrollRun;

    const result = generateEpfEcr({ employees, run, profile });
    expect(result.ok).toBe(true);
    const data = result.data as ReturnType<typeof buildEpfEcrPayload>;
    expect(data.members).toHaveLength(1);
    expect(data.members[0].epfWages).toBe(15000);
    expect(data.members[0].uan).toBe('100200300400');
    expect(data.fieldOrder).toEqual([...EPF_ECR_FIELDS]);
    expect(data.text).toContain('100200300400#ADA LOVELACE#80000#15000#');
    expect(data.meta.forReviewOnly).toBe(true);
    expect(data.meta.disclaimer.length).toBeGreaterThan(20);
  });
});

describe('Form 5472 (REQ-014)', () => {
  it('maps related-party ledger rows and validates payload', () => {
    const result = generateForm5472({
      profile,
      taxYear: '2025',
      transferPricing: { usRevenue: 10000, usExpenses: 2000 },
      transactions: [
        txn({
          id: 'tp-1',
          type: 'Expense',
          amount: 1500,
          currency: 'USD',
          category: 'Transfer Pricing',
          description: 'Intercompany management fee',
          date: '2025-06-01',
        }),
      ],
    });
    expect(result.ok).toBe(true);
    const data = result.data as ReturnType<typeof buildForm5472Payload>;
    expect(data.reportingCorporation.ein).toBe('35-2939054');
    expect(data.transactions.length).toBeGreaterThanOrEqual(2);
    const csv = form5472ToCsv(data);
    expect(csv).toContain(FILING_DISCLAIMER);
    expect(csv).toContain('service_fees');
  });
});
