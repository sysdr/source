import React, { useState } from 'react';
import { Transaction } from '../../types';
import { getBaseCurrency, formatAmountInDisplay, getAmountInBase, getGstImpactInBase } from '../../services/currencyService';
import { getCompanyProfile } from '../../services/storageService';
import { useDisplayCurrency } from '../../contexts/DisplayCurrencyContext';
import {
  FILING_DISCLAIMER,
  generateGstr1,
  generateGstr3b,
  gstr1ToJsonString,
} from '../../services/filings';

// ─── Indian FY helpers ────────────────────────────────────────────────────────
const getFYBounds = (offset = 0): { start: Date; end: Date; label: string } => {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyYear = year + offset;
  return {
    start: new Date(fyYear, 3, 1),
    end: new Date(fyYear + 1, 2, 31),
    label: `FY ${fyYear}-${String(fyYear + 1).slice(-2)}`,
  };
};

function currentFp(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${mm}${now.getFullYear()}`;
}

function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface GSTCenterProps {
  transactions: Transaction[];
}

const GSTCenter: React.FC<GSTCenterProps> = ({ transactions }) => {
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();
  const [isDownloading, setIsDownloading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const isCompletedForTotal = (t: { status?: string }) =>
    !t.status || (t.status !== 'Failed' && t.status !== 'Refunded' && t.status !== 'Pending');

  const activeTxns = transactions.filter(t => !t.deleted);

  const stats = activeTxns.filter(isCompletedForTotal).reduce((acc, curr) => {
    const amt = getAmountInBase(curr, baseCurrency);
    const gst = getGstImpactInBase(curr, baseCurrency);
    if (curr.type === 'Income') {
      acc.income += amt;
      const gstOut = curr.gstRate ? amt * curr.gstRate / 100 : (curr.gstImpact ?? 0);
      acc.outwardGst += gstOut;
    } else if (curr.type === 'Purchase') {
      if (curr.itcEligible !== false) acc.eligibleItc += gst;
      else acc.blockedItc += gst;
    }
    acc.tdsPayable += curr.tdsAmount ?? 0;
    return acc;
  }, { income: 0, eligibleItc: 0, blockedItc: 0, outwardGst: 0, tdsPayable: 0 });

  const fyLabel = getFYBounds(0).label;
  const b2bCount = activeTxns.filter(t => t.type === 'Income' && t.recipientGstin && isCompletedForTotal(t)).length;
  const exportCount = activeTxns.filter(t =>
    t.type === 'Income' && isCompletedForTotal(t) &&
    ((t.customerCountry && t.customerCountry.toUpperCase() !== 'IN') || (t.classification && String(t.classification).toLowerCase().includes('export')))
  ).length;
  const netGstPayable = Math.max(0, stats.outwardGst - stats.eligibleItc);

  const downloadReport = (name: 'gst_r1' | 'gst_3b') => {
    if (!acknowledged) {
      setExportError('Acknowledge the filing disclaimer before downloading.');
      return;
    }
    setIsDownloading(true);
    setExportError(null);
    try {
      const profile = getCompanyProfile();
      const gstin = profile?.parent?.taxId || 'UNREGISTERED';
      const fp = currentFp();
      const stateCode = profile?.parent?.stateCode || '27';

      if (name === 'gst_r1') {
        const result = generateGstr1({
          gstin,
          fp,
          supplierStateCode: stateCode,
          transactions: activeTxns,
        });
        if (!result.ok) {
          setExportError(result.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
          return;
        }
        downloadText(
          gstr1ToJsonString(result.data),
          `GSTR1_${fp}.json`,
          'application/json',
        );
        return;
      }

      const result = generateGstr3b({
        gstin,
        retPeriod: fp,
        transactions: activeTxns,
      });
      if (!result.ok) {
        setExportError(result.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
        return;
      }
      downloadText(
        `${JSON.stringify(result.data, null, 2)}\n`,
        `GSTR3B_${fp}.json`,
        'application/json',
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={acknowledged}
            onChange={(e) => {
              setAcknowledged(e.target.checked);
              setExportError(null);
            }}
          />
          <span className="text-xs text-amber-950 leading-relaxed">
            <span className="font-black uppercase tracking-wide text-[10px] block mb-1">Filing disclaimer</span>
            {FILING_DISCLAIMER}
          </span>
        </label>
        {exportError && (
          <p className="mt-2 text-xs font-bold text-rose-700">{exportError}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
        <div>
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">GSTR-1 (Outward Supplies)</h3>
          <p className="text-xs text-slate-400 font-medium mt-1">{fyLabel} · CGST Act §37 · GSTN JSON</p>
        </div>
        <div className="space-y-2">
          <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 flex justify-between">
            <span className="text-[10px] font-black text-indigo-800 uppercase">Table 4A — B2B (registered buyers)</span>
            <span className="text-xs font-black text-indigo-900">{b2bCount} txns</span>
          </div>
          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex justify-between">
            <span className="text-[10px] font-black text-emerald-800 uppercase">Table 6A — Exports (LUT, zero-rated)</span>
            <span className="text-xs font-black text-emerald-900">{exportCount} txns · ₹0 IGST</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between">
            <span className="text-[10px] font-black text-slate-600 uppercase">Table 7 — B2CS / Table 5 — B2CL</span>
            <span className="text-xs font-black text-slate-700">{activeTxns.filter(t=>t.type==='Income' && isCompletedForTotal(t)).length - b2bCount - exportCount} txns</span>
          </div>
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 flex justify-between">
            <span className="text-[10px] font-black text-amber-800 uppercase">Total Outward Tax Liability</span>
            <span className="text-xs font-black text-amber-900">{formatAmountInDisplay(stats.outwardGst, baseCurrency, displayCurrency)}</span>
          </div>
        </div>
        <button
          onClick={() => downloadReport('gst_r1')}
          disabled={isDownloading || !acknowledged}
          className="w-full bg-slate-900 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all disabled:opacity-50"
        >
          Download GSTR-1 JSON (Offline Utility)
        </button>
      </div>
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
        <div>
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">GSTR-3B (ITC & Net Liability)</h3>
          <p className="text-xs text-slate-400 font-medium mt-1">Sec 16(2)(aa) — only GSTR-2B matched ITC is claimable</p>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600 font-bold uppercase text-[10px]">3.1(a) Outward Tax (Domestic)</span>
            <span className="font-black text-slate-900">{formatAmountInDisplay(stats.outwardGst, baseCurrency, displayCurrency)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-emerald-600 font-bold uppercase text-[10px]">4A(5) Eligible ITC (Sec 16)</span>
            <span className="font-black text-emerald-600">−{formatAmountInDisplay(stats.eligibleItc, baseCurrency, displayCurrency)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-amber-600 font-bold uppercase text-[10px]">4B(1) Blocked ITC (Sec 17(5))</span>
            <span className="font-black text-amber-600">{formatAmountInDisplay(stats.blockedItc, baseCurrency, displayCurrency)} (not claimable)</span>
          </div>
          <div className="pt-3 border-t flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-900 uppercase">6.1 Net Tax Payable</span>
            <span className={`text-lg font-black ${netGstPayable > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatAmountInDisplay(netGstPayable, baseCurrency, displayCurrency)}</span>
          </div>
          {stats.tdsPayable > 0 && (
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-100 flex justify-between mt-2">
              <span className="text-[10px] font-black text-rose-800 uppercase">TDS Payable (26Q/24Q)</span>
              <span className="text-xs font-black text-rose-900">{formatAmountInDisplay(stats.tdsPayable, baseCurrency, displayCurrency)}</span>
            </div>
          )}
        </div>
        <button
          onClick={() => downloadReport('gst_3b')}
          disabled={isDownloading || !acknowledged}
          className="w-full border-2 border-slate-200 text-slate-900 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all disabled:opacity-50"
        >
          Download GSTR-3B JSON (Offline Utility)
        </button>
      </div>
      </div>
    </div>
  );
};

export default GSTCenter;
