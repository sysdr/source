/**
 * GSTR-3B GSTN offline-utility JSON generator (REQ-008, REQ-048).
 */
import type { Transaction } from '../../types';
import { withDisclaimerMeta } from './disclaimer';
import { validateExport, type ValidationResult } from './validateExport';

export interface Gstr3bInput {
  gstin: string;
  /** Filing period MMYYYY */
  retPeriod: string;
  transactions: Transaction[];
}

function isCompleted(t: Transaction): boolean {
  return !t.status || (t.status !== 'Failed' && t.status !== 'Refunded' && t.status !== 'Pending');
}

function isExport(t: Transaction): boolean {
  if (t.customerCountry && t.customerCountry.toUpperCase() !== 'IN') return true;
  if (t.classification && String(t.classification).toLowerCase().includes('export')) return true;
  return false;
}

function zeroTax() {
  return { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
}

export function buildGstr3bPayload(input: Gstr3bInput) {
  const active = input.transactions.filter((t) => !t.deleted && isCompleted(t));
  const outward = active.filter((t) => t.type === 'Income');
  const inward = active.filter((t) => t.type === 'Purchase');

  const domestic = outward.filter((t) => !isExport(t));
  const exports = outward.filter(isExport);

  const domesticTaxable = domestic.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const domesticGst = domestic.reduce((s, t) => {
    const amt = Number(t.amount) || 0;
    return s + amt * (t.gstRate ?? 0) / 100;
  }, 0);
  const exportTaxable = exports.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const eligibleItc = inward
    .filter((t) => t.itcEligible !== false)
    .reduce((s, t) => s + (Number(t.gstImpact) || ((Number(t.amount) || 0) * (t.gstRate ?? 0) / 100)), 0);
  const blockedItc = inward
    .filter((t) => t.itcEligible === false)
    .reduce((s, t) => s + (Number(t.gstImpact) || ((Number(t.amount) || 0) * (t.gstRate ?? 0) / 100)), 0);

  const halfDom = domesticGst / 2;
  const halfItc = eligibleItc / 2;
  const halfBlocked = blockedItc / 2;

  const payload = withDisclaimerMeta({
    gstin: input.gstin || 'UNREGISTERED',
    ret_period: input.retPeriod,
    sup_details: {
      osup_det: {
        txval: Number(domesticTaxable.toFixed(2)),
        iamt: 0,
        camt: Number(halfDom.toFixed(2)),
        samt: Number(halfDom.toFixed(2)),
        csamt: 0,
      },
      osup_zero: {
        txval: Number(exportTaxable.toFixed(2)),
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
      },
      osup_nil_exmp: zeroTax(),
      isup_rev: zeroTax(),
      osup_nongst: zeroTax(),
    },
    itc_elg: {
      itc_avl: [{
        ty: 'oth',
        iamt: 0,
        camt: Number(halfItc.toFixed(2)),
        samt: Number(halfItc.toFixed(2)),
        csamt: 0,
      }],
      itc_rev: [{
        ty: 'oth',
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
      }],
      itc_net: {
        iamt: 0,
        camt: Number(halfItc.toFixed(2)),
        samt: Number(halfItc.toFixed(2)),
        csamt: 0,
      },
      itc_inelg: [{
        ty: 'oth',
        iamt: 0,
        camt: Number(halfBlocked.toFixed(2)),
        samt: Number(halfBlocked.toFixed(2)),
        csamt: 0,
      }],
    },
  });

  return payload;
}

export function generateGstr3b(input: Gstr3bInput): ValidationResult {
  const payload = buildGstr3bPayload(input);
  return validateExport('gstr3b', payload);
}
