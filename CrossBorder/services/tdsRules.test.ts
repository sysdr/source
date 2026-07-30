import { describe, expect, it } from 'vitest';
import {
  ESI_GROSS_CEILING,
  applyVendorTdsToTransaction,
  computeVendorTds,
  evaluateEsi,
  resolveVendorTdsRate,
  VENDOR_TDS_SECTIONS,
} from './tdsRules';

describe('ESI rules (REQ-012 / T-019)', () => {
  it('computes employee 0.75% and employer 3.25% when eligible', () => {
    const result = evaluateEsi({ monthlyGross: 20000, esiEnabled: true });
    expect(result.eligible).toBe(true);
    expect(result.employeeContribution).toBe(150);
    expect(result.employerContribution).toBe(650);
    expect(result.totalContribution).toBe(800);
  });

  it('returns zero when gross exceeds ceiling', () => {
    const result = evaluateEsi({ monthlyGross: ESI_GROSS_CEILING + 1, esiEnabled: true });
    expect(result.eligible).toBe(false);
    expect(result.employeeContribution).toBe(0);
    expect(result.employerContribution).toBe(0);
  });

  it('returns zero when ESI disabled', () => {
    const result = evaluateEsi({ monthlyGross: 15000, esiEnabled: false });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
  });
});

describe('vendor TDS rules (REQ-062 / T-019)', () => {
  it('exposes the supported section catalog with exact rates and labels', () => {
    expect(VENDOR_TDS_SECTIONS).toEqual([
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
    ]);
  });

  it('applies 194C 1% for individuals and 2% for companies', () => {
    expect(resolveVendorTdsRate('194C', 'individual')).toEqual({
      rate: 1,
      description: '194C contractor TDS 1% (Individual/HUF)',
    });
    expect(resolveVendorTdsRate('194C', 'company')).toEqual({
      rate: 2,
      description: '194C contractor TDS 2% (non-Individual)',
    });
    const ind = computeVendorTds({ amount: 100000, section: '194C', payeeType: 'individual' });
    expect(ind.tdsAmount).toBe(1000);
    expect(ind.netPayable).toBe(99000);
    const co = computeVendorTds({ amount: 100000, section: '194C', payeeType: 'company' });
    expect(co.tdsAmount).toBe(2000);
  });

  it('applies 194J / 194H / 194I rates from REQ-062', () => {
    expect(resolveVendorTdsRate('194J').description).toBe('194J professional fees TDS 10%');
    expect(resolveVendorTdsRate('194J(tech)').description).toBe('194J technical services TDS 2%');
    expect(resolveVendorTdsRate('194H').description).toBe('194H commission TDS 5%');
    expect(resolveVendorTdsRate('194I(a)').description).toBe('194I(a) rent (P&M) TDS 2%');
    expect(resolveVendorTdsRate('194I(b)').description).toBe('194I(b) rent (land/building) TDS 10%');
    expect(resolveVendorTdsRate('194Q').description).toBe('194Q purchase of goods TDS 0.1%');
    expect(computeVendorTds({ amount: 50000, section: '194J' }).rate).toBe(10);
    expect(computeVendorTds({ amount: 50000, section: '194J(tech)' }).rate).toBe(2);
    expect(computeVendorTds({ amount: 50000, section: '194H' }).tdsAmount).toBe(2500);
    expect(computeVendorTds({ amount: 50000, section: '194I(a)' }).rate).toBe(2);
    expect(computeVendorTds({ amount: 50000, section: '194I(b)' }).rate).toBe(10);
  });

  it('builds TDS Payable ledger hint', () => {
    const result = computeVendorTds({
      amount: 10000,
      section: '194J',
      payeeName: 'CA Firm',
    });
    expect(result.ledgerHint.creditAccount).toBe('TDS Payable');
    expect(result.ledgerHint.debitAccount).toBe('Expense / Purchase');
    expect(result.ledgerHint.narration).toBe('TDS u/s 194J on payment to CA Firm');
    const anon = computeVendorTds({ amount: 10000, section: '194J' });
    expect(anon.ledgerHint.narration).toBe('TDS u/s 194J on payment to vendor');
  });

  it('enriches transaction payloads when tdsApplicable', () => {
    const enriched = applyVendorTdsToTransaction({
      id: 'tx-1',
      amount: 20000,
      tdsApplicable: true,
      tdsSection: '194H',
      description: 'Referral fee',
    });
    expect(enriched.tdsRate).toBe(5);
    expect(enriched.tdsAmount).toBe(1000);
  });

  it('uses vendor label when description is not a string', () => {
    const enriched = applyVendorTdsToTransaction({
      amount: 10000,
      tdsApplicable: true,
      tdsSection: '194H',
      description: 42,
    });
    expect(enriched.tdsAmount).toBe(500);
    expect(
      computeVendorTds({ amount: 10000, section: '194H', payeeName: undefined }).ledgerHint.narration,
    ).toContain('vendor');
  });

  it('trims section codes before resolving rates', () => {
    expect(resolveVendorTdsRate('  194C  ', 'individual').rate).toBe(1);
    expect(computeVendorTds({ amount: 100000, section: ' 194Q ' }).rate).toBe(0.1);
  });

  it('leaves non-TDS transactions unchanged', () => {
    const tx = { id: 'tx-2', amount: 100, tdsApplicable: false };
    expect(applyVendorTdsToTransaction(tx)).toEqual(tx);
  });

  it('rejects non-positive amounts and unknown sections', () => {
    expect(() => computeVendorTds({ amount: 0, section: '194C' })).toThrow(/positive/i);
    expect(() => computeVendorTds({ amount: -1, section: '194C' })).toThrow(/positive/i);
    expect(() => resolveVendorTdsRate('999X')).toThrow(/Unsupported TDS section/i);
    expect(resolveVendorTdsRate('194Q').rate).toBe(0.1);
    expect(resolveVendorTdsRate('194C', 'huf').rate).toBe(1);
  });

  it('handles ESI boundary at ceiling and non-positive gross', () => {
    const atCeiling = evaluateEsi({ monthlyGross: ESI_GROSS_CEILING, esiEnabled: true });
    expect(atCeiling.eligible).toBe(true);
    expect(atCeiling.employeeContribution).toBeGreaterThan(0);
    const zero = evaluateEsi({ monthlyGross: 0, esiEnabled: true });
    expect(zero.eligible).toBe(false);
    expect(zero.reason).toMatch(/positive/i);
  });

  it('skips enrichment when section missing, amount invalid, or section unsupported', () => {
    expect(
      applyVendorTdsToTransaction({ amount: 100, tdsApplicable: true, tdsSection: '' }),
    ).toEqual({ amount: 100, tdsApplicable: true, tdsSection: '' });
    expect(
      applyVendorTdsToTransaction({ amount: 0, tdsApplicable: true, tdsSection: '194H' }),
    ).toEqual({ amount: 0, tdsApplicable: true, tdsSection: '194H' });
    expect(
      applyVendorTdsToTransaction({ amount: 100, tdsApplicable: true, tdsSection: 'NOPE' }),
    ).toEqual({ amount: 100, tdsApplicable: true, tdsSection: 'NOPE' });
  });
});
