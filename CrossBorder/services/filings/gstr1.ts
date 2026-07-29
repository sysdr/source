/**
 * GSTR-1 GSTN offline-utility JSON generator (REQ-007, REQ-048).
 */
import type { Transaction } from '../../types';
import { FILING_DISCLAIMER, withDisclaimerMeta } from './disclaimer';
import { validateExport, type ValidationResult } from './validateExport';

export interface Gstr1Input {
  gstin: string;
  /** Filing period MMYYYY */
  fp: string;
  supplierStateCode?: string;
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

function formatIdt(isoDate: string): string {
  // GSTN expects DD-MM-YYYY
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function taxable(t: Transaction): number {
  return Number(t.amount) || 0;
}

export function buildGstr1Payload(input: Gstr1Input) {
  const outward = input.transactions.filter((t) => !t.deleted && t.type === 'Income' && isCompleted(t));
  const stateCode = input.supplierStateCode || '27';

  const b2bMap = new Map<string, {
    ctin: string;
    inv: Array<Record<string, unknown>>;
  }>();
  const expInvs: Array<Record<string, unknown>> = [];
  const b2clByPos = new Map<string, Array<Record<string, unknown>>>();
  const b2csAgg = new Map<string, {
    sply_ty: 'INTRA' | 'INTER';
    rt: number;
    typ: 'OE';
    pos: string;
    txval: number;
    iamt: number;
    camt: number;
    samt: number;
    csamt: number;
  }>();

  for (const t of outward) {
    const txval = taxable(t);
    const rate = t.gstRate ?? 0;
    const gst = txval * rate / 100;
    const pos = isExport(t)
      ? (t.customerCountry || '96')
      : (t.customerLocation || stateCode);
    const isInter = isExport(t) || String(pos) !== String(stateCode);

    if (isExport(t)) {
      expInvs.push({
        inum: t.id,
        idt: formatIdt(t.date),
        val: Number(txval.toFixed(2)),
        sbnum: '',
        sbdt: '',
      });
      continue;
    }

    if (t.recipientGstin) {
      const iamt = isInter ? gst : 0;
      const half = isInter ? 0 : gst / 2;
      const inv = {
        inum: t.id,
        idt: formatIdt(t.date),
        val: Number((txval + gst).toFixed(2)),
        pos: String(pos),
        rchrg: 'N' as const,
        inv_typ: 'R',
        itms: [{
          num: 1,
          itm_det: {
            rt: rate,
            txval: Number(txval.toFixed(2)),
            iamt: Number(iamt.toFixed(2)),
            camt: Number(half.toFixed(2)),
            samt: Number(half.toFixed(2)),
            csamt: 0,
          },
        }],
      };
      const key = t.recipientGstin.toUpperCase();
      const existing = b2bMap.get(key);
      if (existing) existing.inv.push(inv);
      else b2bMap.set(key, { ctin: key, inv: [inv] });
      continue;
    }

    if (txval > 250000 && isInter) {
      const list = b2clByPos.get(String(pos)) || [];
      list.push({
        inum: t.id,
        idt: formatIdt(t.date),
        val: Number((txval + gst).toFixed(2)),
        itms: [{
          num: 1,
          itm_det: {
            rt: rate,
            txval: Number(txval.toFixed(2)),
            iamt: Number(gst.toFixed(2)),
            camt: 0,
            samt: 0,
            csamt: 0,
          },
        }],
      });
      b2clByPos.set(String(pos), list);
      continue;
    }

    const aggKey = `${isInter ? 'INTER' : 'INTRA'}|${rate}|${pos}`;
    const agg = b2csAgg.get(aggKey) || {
      sply_ty: (isInter ? 'INTER' : 'INTRA') as 'INTRA' | 'INTER',
      rt: rate,
      typ: 'OE' as const,
      pos: String(pos),
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0,
    };
    agg.txval += txval;
    if (isInter) agg.iamt += gst;
    else {
      agg.camt += gst / 2;
      agg.samt += gst / 2;
    }
    b2csAgg.set(aggKey, agg);
  }

  const payload = withDisclaimerMeta({
    gstin: input.gstin || 'UNREGISTERED',
    fp: input.fp,
    version: 'GST3.2.2',
    hash: 'hash',
    b2b: Array.from(b2bMap.values()),
    exp: expInvs.length ? [{ exp_typ: 'WOPAY' as const, inv: expInvs }] : [],
    b2cl: Array.from(b2clByPos.entries()).map(([pos, inv]) => ({ pos, inv })),
    b2cs: Array.from(b2csAgg.values()).map((r) => ({
      ...r,
      txval: Number(r.txval.toFixed(2)),
      iamt: Number(r.iamt.toFixed(2)),
      camt: Number(r.camt.toFixed(2)),
      samt: Number(r.samt.toFixed(2)),
      csamt: 0,
    })),
  });

  return payload;
}

export function generateGstr1(input: Gstr1Input): ValidationResult {
  const payload = buildGstr1Payload(input);
  return validateExport('gstr1', payload);
}

export function gstr1ToJsonString(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export { FILING_DISCLAIMER };
