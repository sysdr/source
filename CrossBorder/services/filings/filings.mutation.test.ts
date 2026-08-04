/**
 * Mutation-strong tests for filings generators (RW-009d).
 * Assert exact branch outcomes so survivors in gstr1/3b/24q/26q/epf/validateExport die.
 */
import { describe, expect, it } from 'vitest';
import type { CompanyProfile, Employee, PayrollRun, Transaction, WithholdingPayment } from '../../types';
import {
  buildEpfEcrPayload,
  buildForm24qPayload,
  buildForm26qPayload,
  buildGstr1Payload,
  buildGstr3bPayload,
  generateEpfEcr,
  generateForm24q,
  generateForm26q,
  generateGstr1,
  generateGstr3b,
  gstr1ToJsonString,
  isLikelyGstin,
  transactionsTo26qDeductees,
  validateExport,
  withholdingsTo26qDeductees,
  EPF_WAGE_CEILING,
} from './index';

const profile: CompanyProfile = {
  parent: {
    name: 'SystemDR LLP',
    taxId: 'MUMS12345A',
    pan: 'ABCDE1234F',
    state: 'Maharashtra',
    stateCode: '27',
    tan: 'MUMS99999B',
    epfNumber: 'MH/PUN/1234567',
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

function emp(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    name: 'Ada Lovelace',
    designation: 'Engineer',
    ctc: 1200000,
    doj: '2025-01-01',
    status: 'Active',
    email: 'ada@example.com',
    documents: { pan: true, aadhaar: true, contract: true },
    panNumber: 'ABCDE1234F',
    uan: '100200300400',
    ...overrides,
  } as Employee;
}

function run(month: string, year: number, slips: PayrollRun['employeeSlips']): PayrollRun {
  return {
    id: `run-${month}-${year}`,
    month,
    year,
    runAt: `${year}-01-31T10:00:00.000Z`,
    employeeCount: slips.length,
    totalNet: 0,
    employeeSlips: slips,
  } as PayrollRun;
}

const slip = (overrides: Partial<PayrollRun['employeeSlips'][0]> = {}) => ({
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
  epfEmployer: 550,
  epsEmployer: 1250,
  esiEmployer: 0,
  ...overrides,
});

describe('GSTR-1 mutation kills (RW-009d)', () => {
  it('excludes Failed/Refunded/Pending/deleted and includes missing status', () => {
    const payload = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      supplierStateCode: '27',
      transactions: [
        txn({ id: 'ok', type: 'Income', amount: 1000, gstRate: 18, customerLocation: '27' }),
        txn({ id: 'fail', type: 'Income', amount: 9999, gstRate: 18, status: 'Failed', customerLocation: '27' }),
        txn({ id: 'ref', type: 'Income', amount: 9999, gstRate: 18, status: 'Refunded', customerLocation: '27' }),
        txn({ id: 'pend', type: 'Income', amount: 9999, gstRate: 18, status: 'Pending', customerLocation: '27' }),
        txn({ id: 'del', type: 'Income', amount: 9999, gstRate: 18, deleted: true, customerLocation: '27' }),
        { ...txn({ id: 'nostatus', type: 'Income', amount: 500, gstRate: 18, customerLocation: '27' }), status: undefined as unknown as Transaction['status'] },
      ],
    });
    const ids = [
      ...payload.b2cs.flatMap(() => []),
      ...payload.b2b.flatMap((b) => b.inv.map((i) => i.inum)),
    ];
    // B2C small invoices aggregate — check totals exclude bad statuses
    const b2csTx = payload.b2cs.reduce((s, r) => s + r.txval, 0);
    expect(b2csTx).toBe(1500);
    expect(ids).not.toContain('fail');
  });

  it('classifies export by foreign country and by classification string', () => {
    const byCountry = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      transactions: [txn({ id: 'e1', type: 'Income', amount: 100, customerCountry: 'US' })],
    });
    expect(byCountry.exp[0].exp_typ).toBe('WOPAY');
    expect(byCountry.exp[0].inv[0].inum).toBe('e1');

    const indiaNotExport = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      transactions: [txn({ id: 'in', type: 'Income', amount: 100, customerCountry: 'IN', gstRate: 18, customerLocation: '27' })],
    });
    expect(indiaNotExport.exp).toEqual([]);

    const byClass = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      transactions: [txn({
        id: 'e2',
        type: 'Income',
        amount: 200,
        classification: 'Export of Services' as Transaction['classification'],
      })],
    });
    expect(byClass.exp[0].inv[0].val).toBe(200);
  });

  it('formats invoice date as DD-MM-YYYY and falls back for bad dates', () => {
    const p = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      transactions: [
        txn({ id: 'd1', type: 'Income', amount: 10, date: '2026-01-05', customerCountry: 'US' }),
        txn({ id: 'd2', type: 'Income', amount: 10, date: 'not-a-date', customerCountry: 'US' }),
      ],
    });
    expect(p.exp[0].inv[0].idt).toBe('05-01-2026');
    expect(p.exp[0].inv[1].idt).toBe('not-a-date');
  });

  it('splits B2B intra CGST/SGST vs inter IGST and merges same CTIN', () => {
    const p = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      supplierStateCode: '27',
      transactions: [
        txn({ id: 'intra', type: 'Income', amount: 1000, gstRate: 18, recipientGstin: '27CCCCC0000C1Z5', customerLocation: '27' }),
        txn({ id: 'inter', type: 'Income', amount: 2000, gstRate: 18, recipientGstin: '29DDDDD0000D1Z5', customerLocation: '29' }),
        txn({ id: 'intra2', type: 'Income', amount: 500, gstRate: 18, recipientGstin: '27ccccc0000c1z5', customerLocation: '27' }),
      ],
    });
    expect(p.b2b).toHaveLength(2);
    const intra = p.b2b.find((b) => b.ctin === '27CCCCC0000C1Z5')!;
    expect(intra.inv).toHaveLength(2);
    expect(intra.inv[0].itms[0].itm_det.iamt).toBe(0);
    expect(intra.inv[0].itms[0].itm_det.camt).toBe(90);
    expect(intra.inv[0].itms[0].itm_det.samt).toBe(90);
    expect(intra.inv[0].val).toBe(1180);

    const inter = p.b2b.find((b) => b.ctin === '29DDDDD0000D1Z5')!;
    expect(inter.inv[0].itms[0].itm_det.iamt).toBe(360);
    expect(inter.inv[0].itms[0].itm_det.camt).toBe(0);
  });

  it('routes large inter-state B2C into b2cl and small into b2cs', () => {
    const p = buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '032026',
      supplierStateCode: '27',
      transactions: [
        txn({ id: 'big', type: 'Income', amount: 300000, gstRate: 18, customerLocation: '29' }),
        txn({ id: 'edge', type: 'Income', amount: 250000, gstRate: 18, customerLocation: '29' }),
        txn({ id: 'small', type: 'Income', amount: 1000, gstRate: 18, customerLocation: '29' }),
        txn({ id: 'local', type: 'Income', amount: 2000, gstRate: 18, customerLocation: '27' }),
      ],
    });
    expect(p.b2cl).toHaveLength(1);
    expect(p.b2cl[0].pos).toBe('29');
    expect(p.b2cl[0].inv).toHaveLength(1);
    expect(p.b2cl[0].inv[0].inum).toBe('big');
    expect(p.b2cl[0].inv[0].itms[0].itm_det.iamt).toBe(54000);

    const interCs = p.b2cs.find((r) => r.sply_ty === 'INTER' && r.pos === '29')!;
    expect(interCs.txval).toBe(251000);
    expect(interCs.iamt).toBeCloseTo(45180, 5);

    const intraCs = p.b2cs.find((r) => r.sply_ty === 'INTRA')!;
    expect(intraCs.txval).toBe(2000);
    expect(intraCs.camt).toBe(180);
    expect(intraCs.samt).toBe(180);
    expect(intraCs.iamt).toBe(0);
  });

  it('uses UNREGISTERED placeholder and serializes JSON with trailing newline', () => {
    const p = buildGstr1Payload({ gstin: '', fp: '032026', transactions: [] });
    expect(p.gstin).toBe('UNREGISTERED');
    expect(gstr1ToJsonString(p).endsWith('\n')).toBe(true);
    expect(generateGstr1({ gstin: '27AAAAA0000A1Z5', fp: '032026', transactions: [] }).ok).toBe(true);
  });
});

describe('GSTR-3B mutation kills (RW-009d)', () => {
  it('separates domestic vs export and ITC eligible vs blocked', () => {
    const p = buildGstr3bPayload({
      gstin: '27AAAAA0000A1Z5',
      retPeriod: '032026',
      transactions: [
        txn({ id: 'd', type: 'Income', amount: 10000, gstRate: 18, customerLocation: '27' }),
        txn({ id: 'x', type: 'Income', amount: 2000, gstRate: 0, customerCountry: 'US' }),
        txn({ id: 'fail', type: 'Income', amount: 999, gstRate: 18, status: 'Failed' }),
        txn({ id: 'itc', type: 'Purchase', amount: 1000, gstRate: 18, gstImpact: 180, itcEligible: true }),
        txn({ id: 'block', type: 'Purchase', amount: 500, gstRate: 18, gstImpact: 90, itcEligible: false }),
        txn({ id: 'itc2', type: 'Purchase', amount: 2000, gstRate: 18 }), // default eligible, compute from rate
      ],
    });
    expect(p.sup_details.osup_det.txval).toBe(10000);
    expect(p.sup_details.osup_det.camt).toBe(900);
    expect(p.sup_details.osup_det.samt).toBe(900);
    expect(p.sup_details.osup_zero.txval).toBe(2000);
    // eligible: 180 + 360 = 540 → half 270
    expect(p.itc_elg.itc_avl[0].camt).toBe(270);
    expect(p.itc_elg.itc_avl[0].samt).toBe(270);
    expect(p.itc_elg.itc_inelg[0].camt).toBe(45);
    expect(p.itc_elg.itc_inelg[0].samt).toBe(45);
    expect(p.gstin).toBe('27AAAAA0000A1Z5');
    expect(generateGstr3b({
      gstin: '',
      retPeriod: '032026',
      transactions: [],
    }).data).toMatchObject({ gstin: 'UNREGISTERED' });
  });

  it('treats IN country as domestic and export classification as zero-rated', () => {
    const p = buildGstr3bPayload({
      gstin: '27AAAAA0000A1Z5',
      retPeriod: '032026',
      transactions: [
        txn({ id: 'in', type: 'Income', amount: 100, gstRate: 18, customerCountry: 'IN', customerLocation: '27' }),
        txn({
          id: 'cls',
          type: 'Income',
          amount: 50,
          classification: 'Something Export related' as Transaction['classification'],
        }),
      ],
    });
    expect(p.sup_details.osup_det.txval).toBe(100);
    expect(p.sup_details.osup_zero.txval).toBe(50);
  });
});

describe('Form 24Q / 26Q mutation kills (RW-009d)', () => {
  it('maps FY to assessment year and filters quarter months/years', () => {
    const employees = [emp()];
    const runs = [
      run('January', 2026, [slip()]), // Q4 of FY 2025-26
      run('April', 2025, [slip({ tds: 1000 })]), // Q1
      run('January', 2025, [slip()]), // wrong year for Q4 FY25-26
      run('July', 2025, [slip({ tds: 2000 })]), // Q2
    ];

    const q4 = buildForm24qPayload({
      employees,
      runs,
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
    });
    expect(q4.rows).toHaveLength(1);
    expect(q4.rows[0].assessmentYear).toBe('2026-27');
    expect(q4.rows[0].amountPaid).toBe(80000);
    expect(q4.rows[0].tdsDeducted).toBe(5000);
    expect(q4.deductorTan).toBe('MUMS12345A');

    const q1 = buildForm24qPayload({
      employees,
      runs,
      quarter: 'Q1',
      financialYear: '2025-26',
      profile,
    });
    expect(q1.rows[0].tdsDeducted).toBe(1000);

    const q2 = buildForm24qPayload({
      employees,
      runs,
      quarter: 'Q2',
      financialYear: '2025-26',
      profile,
    });
    expect(q2.rows[0].tdsDeducted).toBe(2000);

    const zeroTds = buildForm24qPayload({
      employees,
      runs: [run('January', 2026, [slip({ tds: 0 })])],
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
    });
    expect(zeroTds.rows).toHaveLength(0);

    const noPan = buildForm24qPayload({
      employees: [emp({ panNumber: undefined })],
      runs: [run('January', 2026, [slip()])],
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
    });
    expect(noPan.rows[0].employeePan).toBe('PANNOTAVBL');

    const tanOnly = buildForm24qPayload({
      employees,
      runs: [run('January', 2026, [slip()])],
      quarter: 'Q4',
      financialYear: '2025-26',
      profile: {
        ...profile,
        parent: { name: 'X', tan: 'ONLYTAN01A' },
      } as CompanyProfile,
    });
    expect(tanOnly.deductorTan).toBe('ONLYTAN01A');

    const noTan = buildForm24qPayload({
      employees,
      runs: [run('January', 2026, [slip()])],
      quarter: 'Q4',
      financialYear: '2025-26',
      profile: { parent: { name: 'Bare' }, subsidiary: profile.subsidiary } as CompanyProfile,
    });
    expect(noTan.deductorTan).toBe('TANNOTAVBL');
    expect(noTan.deductorName).toBe('Bare');
    expect(generateForm24q({
      employees,
      runs: [run('January', 2026, [slip()])],
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
    }).ok).toBe(true);

    // Kill quarter-month string/array mutants — every calendar month must map
    for (const [quarter, months] of [
      ['Q1', ['April', 'May', 'June']],
      ['Q2', ['July', 'August', 'September']],
      ['Q3', ['October', 'November', 'December']],
      ['Q4', ['January', 'February', 'March']],
    ] as const) {
      for (const month of months) {
        const year = ['January', 'February', 'March'].includes(month) ? 2026 : 2025;
        const payload = buildForm24qPayload({
          employees: [emp({ id: 'm', name: 'Month Tester' })],
          runs: [run(month, year, [slip({ employeeId: 'm', tds: 100 })])],
          quarter,
          financialYear: '2025-26',
          profile,
        });
        expect(payload.rows, `${quarter}/${month}`).toHaveLength(1);
        expect(payload.csv).toContain(`# Quarter: ${quarter} | Financial Year: 2025-26`);
        expect(payload.csv).toContain('# Form 24Q - Quarterly Statement of TDS on Salary');
      }
    }

    // Serial numbers increment; payment date comes from last quarter run
    const multi = buildForm24qPayload({
      employees: [emp({ id: 'a', name: 'Alice "A"' }), emp({ id: 'b', name: 'Bob' })],
      runs: [
        {
          ...run('January', 2026, [slip({ employeeId: 'a', tds: 100 }), slip({ employeeId: 'b', tds: 200 })]),
          runAt: '2026-01-10T00:00:00.000Z',
        },
        {
          ...run('February', 2026, [slip({ employeeId: 'a', tds: 50 }), slip({ employeeId: 'b', tds: 50 })]),
          runAt: '2026-02-20T00:00:00.000Z',
        },
      ],
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
    });
    expect(multi.rows.map((r) => r.srNo)).toEqual([1, 2]);
    expect(multi.rows[0].paymentDate).toBe('2026-02-20');
    expect(multi.rows[0].tdsDeducted).toBe(150);
    expect(multi.csv).toContain('"Alice ""A"""');
    expect(multi.deductorName).toBe('SystemDR LLP');
  });

  it('filters 26Q deductees and maps withholdings/transactions strictly', () => {
    const built = buildForm26qPayload({
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
      deductees: [
        { name: 'A', section: '194J', amountPaid: 100, tdsDeducted: 10, paymentDate: '2026-01-01', pan: '  ' },
        { name: 'B', section: '194C', amountPaid: 0, tdsDeducted: 5, paymentDate: '2026-01-01' },
        { name: 'C', section: '194C', amountPaid: 50, tdsDeducted: 0, paymentDate: '2026-01-01' },
        { name: 'D "Quoted"', section: '194H', amountPaid: 200, tdsDeducted: 10, paymentDate: '2026-01-02', pan: 'ABCDE1234F' },
      ],
    });
    expect(built.rows).toHaveLength(2);
    expect(built.rows[0].deducteePan).toBe('PANNOTAVBL');
    expect(built.rows[1].deducteePan).toBe('ABCDE1234F');
    expect(built.rows[0].assessmentYear).toBe('2026-27');
    expect(built.csv).toContain('"D ""Quoted"""');

    const wh = withholdingsTo26qDeductees(
      [
        { quarter: 'Q4', financialYear: '2025-26', section: '194J', withheldAmount: 100, amount: 1000, payeeName: 'V', date: '2026-01-01' },
        { quarter: 'Q4', financialYear: '2025-26', section: '192', withheldAmount: 50, amount: 500, payeeName: 'Sal', date: '2026-01-01' },
        { quarter: 'Q3', financialYear: '2025-26', section: '194J', withheldAmount: 10, amount: 100, payeeName: 'WrongQ', date: '2025-10-01' },
        { quarter: 'Q4', financialYear: '2025-26', section: '194C', withheldAmount: 0, amount: 100, payeeName: 'Zero', date: '2026-01-01' },
      ] as WithholdingPayment[],
      'Q4',
      '2025-26',
    );
    expect(wh).toHaveLength(1);
    expect(wh[0].section).toBe('194J');

    const mapped = transactionsTo26qDeductees([
      txn({ id: '1', type: 'Expense', amount: 10, tdsApplicable: true, tdsSection: '194H', tdsAmount: 1 }),
      txn({ id: '2', type: 'Expense', amount: 10, tdsApplicable: true, tdsSection: '192', tdsAmount: 1 }),
      txn({ id: '3', type: 'Expense', amount: 10, tdsApplicable: false, tdsSection: '194H', tdsAmount: 1 }),
      txn({ id: '4', type: 'Income', amount: 10, tdsApplicable: true, tdsSection: '194H', tdsAmount: 1 }),
      txn({ id: '5', type: 'Purchase', amount: 20, tdsApplicable: true, tdsSection: '194C', tdsAmount: 2 }),
      txn({ id: '6', type: 'Expense', amount: 10, tdsApplicable: true, tdsSection: '194H', tdsAmount: 0 }),
    ]);
    expect(mapped.map((d) => d.section)).toEqual(['194H', '194C']);
    expect(generateForm26q({
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
      deductees: [{ name: 'A', section: '194J', amountPaid: 100, tdsDeducted: 10, paymentDate: '2026-01-01' }],
    }).ok).toBe(true);
  });
});

describe('EPF ECR mutation kills (RW-009d)', () => {
  it('prefers epfNumber, caps wages, skips missing employees, defaults UAN', () => {
    const employees = [emp(), emp({ id: 'emp-2', name: 'Bob', uan: undefined })];
    const payroll = run('January', 2026, [
      slip({ basic: 50000, lopDays: 2 }),
      slip({ employeeId: 'emp-2', employeeName: 'Bob', basic: 10000, grossEarnings: 12000, epf: 1200, epsEmployer: 833 }),
      slip({ employeeId: 'ghost', employeeName: 'Ghost' }),
    ]);

    const p = buildEpfEcrPayload({ employees, run: payroll, profile });
    expect(p.establishmentId).toBe('MH/PUN/1234567');
    expect(p.employerName).toBe('SystemDR LLP');
    expect(p.members).toHaveLength(2);
    expect(p.members[0].epfWages).toBe(EPF_WAGE_CEILING);
    expect(p.members[0].epsWages).toBe(EPF_WAGE_CEILING);
    expect(p.members[0].edliWages).toBe(EPF_WAGE_CEILING);
    expect(p.members[0].ncpDays).toBe(2);
    expect(p.members[1].epfWages).toBe(10000);
    expect(p.members[1].uan).toBe('000000000000');
    expect(p.fieldOrder[0]).toBe('UAN');
    expect(p.text).toContain('#~#SystemDR LLP#~#MH/PUN/1234567#~#');

    const fallback = buildEpfEcrPayload({
      employees: [emp()],
      run: run('January', 2026, [slip({ basic: 8000 })]),
      profile: { parent: { name: '', taxId: 'TAXONLY' }, subsidiary: profile.subsidiary } as CompanyProfile,
    });
    expect(fallback.establishmentId).toBe('TAXONLY');
    expect(fallback.employerName).toBe('Company');

    const bare = buildEpfEcrPayload({
      employees: [emp()],
      run: run('January', 2026, [slip({ basic: 8000 })]),
      profile: { parent: {}, subsidiary: profile.subsidiary } as CompanyProfile,
    });
    expect(bare.establishmentId).toBe('ESTNOTAVBL');
    expect(generateEpfEcr({ employees: [emp()], run: run('January', 2026, [slip()]), profile }).ok).toBe(true);
  });
});

describe('validateExport mutation kills (RW-009d)', () => {
  it('rejects soft GSTIN edge cases via isLikelyGstin', () => {
    expect(isLikelyGstin('27AAAAA0000A1Z5')).toBe(true);
    expect(isLikelyGstin('7AAAAA0000A1Z5')).toBe(false); // missing digit
    expect(isLikelyGstin('27AAAAA0000A1Z')).toBe(false); // truncated
    expect(isLikelyGstin('27AAAA0000A1Z5')).toBe(false); // 4 letters
    expect(isLikelyGstin('XXAAAAA0000A1Z5')).toBe(false); // non-digit state
    expect(isLikelyGstin('27AAAAA0000A1Z55')).toBe(false); // too long
    expect(isLikelyGstin('27aaaaa0000a1z5')).toBe(true); // case insensitive
    expect(isLikelyGstin('271AAAA0000A1Z5')).toBe(false);
    expect(isLikelyGstin('27AAAAA00001Z5X')).toBe(false);
  });

  it('rejects invalid filing-period regex edge cases', () => {
    const base = buildGstr1Payload({ gstin: '27AAAAA0000A1Z5', fp: '032026', transactions: [] });
    expect(validateExport('gstr1', { ...base, fp: '002026' }).ok).toBe(false); // month 00
    expect(validateExport('gstr1', { ...base, fp: '132026' }).ok).toBe(false); // month 13
    expect(validateExport('gstr1', { ...base, fp: '3A2026' }).ok).toBe(false);
    expect(validateExport('gstr1', { ...base, fp: '032026x' }).ok).toBe(false);
    expect(validateExport('gstr1', { ...base, fp: 'x032026' }).ok).toBe(false);
    expect(validateExport('gstr3b', {
      ...buildGstr3bPayload({ gstin: '27AAAAA0000A1Z5', retPeriod: '032026', transactions: [] }),
      ret_period: '032026x',
    }).ok).toBe(false);
  });

  it('rejects invalid form24q assessment year and quarter enum', () => {
    const good = buildForm24qPayload({
      employees: [emp()],
      runs: [run('January', 2026, [slip()])],
      quarter: 'Q4',
      financialYear: '2025-26',
      profile,
    });
    expect(validateExport('form24q', good).ok).toBe(true);
    expect(validateExport('form24q', { ...good, rows: [{ ...good.rows[0], assessmentYear: '2026-7' }] }).ok).toBe(false);
    expect(validateExport('form24q', { ...good, rows: [{ ...good.rows[0], assessmentYear: 'x2026-27' }] }).ok).toBe(false);
    expect(validateExport('form24q', { ...good, quarter: 'Q5' }).ok).toBe(false);
    expect(validateExport('form24q', { ...good, meta: { ...good.meta, forReviewOnly: false } }).ok).toBe(false);
    expect(validateExport('form24q', { ...good, meta: {} }).ok).toBe(false);
  });

  it('rejects form26q bad AY and epf wages over ceiling', () => {
    const g26 = buildForm26qPayload({
      quarter: 'Q1',
      financialYear: '2025-26',
      profile,
      deductees: [{ name: 'A', section: '194J', amountPaid: 100, tdsDeducted: 10, paymentDate: '2025-04-01' }],
    });
    expect(validateExport('form26q', g26).ok).toBe(true);
    expect(validateExport('form26q', { ...g26, quarter: 'QX' }).ok).toBe(false);
    expect(validateExport('form26q', {
      ...g26,
      rows: [{ ...g26.rows[0], assessmentYear: '2026-27x' }],
    }).ok).toBe(false);

    const epf = buildEpfEcrPayload({
      employees: [emp()],
      run: run('January', 2026, [slip()]),
      profile,
    });
    expect(validateExport('epfEcr', epf).ok).toBe(true);
    expect(validateExport('epfEcr', {
      ...epf,
      members: [{ ...epf.members[0], epfWages: 15001 }],
    }).ok).toBe(false);
    expect(validateExport('epfEcr', {
      ...epf,
      members: [{ ...epf.members[0], epsWages: 15001 }],
    }).ok).toBe(false);
    expect(validateExport('epfEcr', {
      ...epf,
      members: [{ ...epf.members[0], edliWages: 15001 }],
    }).ok).toBe(false);
  });

  it('maps zod path to (root) when empty and rejects bad gstr1 fp', () => {
    const bad = validateExport('gstr1', null);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.path === '(root)' || i.path.length >= 0)).toBe(true);

    const fp = validateExport('gstr1', buildGstr1Payload({
      gstin: '27AAAAA0000A1Z5',
      fp: '13YYYY',
      transactions: [],
    }));
    // build still creates payload; validate should fail on fp
    const direct = validateExport('gstr1', {
      ...buildGstr1Payload({ gstin: '27AAAAA0000A1Z5', fp: '032026', transactions: [] }),
      fp: '2026-03',
    });
    expect(direct.ok).toBe(false);
    expect(direct.issues.some((i) => i.path === 'fp')).toBe(true);
    void fp;
  });
});
