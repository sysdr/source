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
  it('exposes the supported section catalog', () => {
    expect(VENDOR_TDS_SECTIONS.map((s) => s.section)).toContain('194C');
    expect(VENDOR_TDS_SECTIONS.map((s) => s.section)).toContain('194J');
    expect(VENDOR_TDS_SECTIONS.map((s) => s.section)).toContain('194H');
    expect(VENDOR_TDS_SECTIONS.map((s) => s.section)).toContain('194I(b)');
  });

  it('applies 194C 1% for individuals and 2% for companies', () => {
    expect(resolveVendorTdsRate('194C', 'individual').rate).toBe(1);
    expect(resolveVendorTdsRate('194C', 'company').rate).toBe(2);
    const ind = computeVendorTds({ amount: 100000, section: '194C', payeeType: 'individual' });
    expect(ind.tdsAmount).toBe(1000);
    expect(ind.netPayable).toBe(99000);
    const co = computeVendorTds({ amount: 100000, section: '194C', payeeType: 'company' });
    expect(co.tdsAmount).toBe(2000);
  });

  it('applies 194J / 194H / 194I rates from REQ-062', () => {
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
    expect(result.ledgerHint.narration).toContain('194J');
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

  it('leaves non-TDS transactions unchanged', () => {
    const tx = { id: 'tx-2', amount: 100, tdsApplicable: false };
    expect(applyVendorTdsToTransaction(tx)).toEqual(tx);
  });
});
