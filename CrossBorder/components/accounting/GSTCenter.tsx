import React, { useState } from 'react';
import { Transaction } from '../../types';
import { getBaseCurrency, formatAmountInDisplay, getAmountInBase, getGstImpactInBase } from '../../services/currencyService';
import { getCompanyProfile } from '../../services/storageService';
import { useDisplayCurrency } from '../../contexts/DisplayCurrencyContext';

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

// ─── Props ────────────────────────────────────────────────────────────────────
interface GSTCenterProps {
  transactions: Transaction[];
}

const GSTCenter: React.FC<GSTCenterProps> = ({ transactions }) => {
  const baseCurrency = getBaseCurrency();
  const { displayCurrency } = useDisplayCurrency();
  const [isDownloading, setIsDownloading] = useState(false);

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

  const downloadReport = (name: string) => {
    setIsDownloading(true);
    try {
      const profile = getCompanyProfile();
      const gstin = profile?.parent?.taxId || '';
      const generatedAt = new Date().toISOString();

      if (name === 'gst_r1') {
        const outward = activeTxns.filter((t) => t.type === 'Income' && isCompletedForTotal(t));
        const isExport = (t: Transaction) =>
          (t.customerCountry && t.customerCountry.toUpperCase() !== 'IN') ||
          (t.customerLocation && t.customerLocation.toUpperCase() !== 'IN') ||
          (t.classification && String(t.classification).toLowerCase().includes('export'));
        const isInterState = (t: Transaction) =>
          !!(t.customerCountry && t.customerCountry.toUpperCase() !== 'IN') ||
          (profile?.parent?.state && t.customerLocation && t.customerLocation !== profile.parent.state);

        const lines: string[] = [
          '# GSTR-1 (Draft — aligned to GST filing tables per CGST Act §37)',
          `# GSTIN: ${gstin}`,
          `# GeneratedAt: ${generatedAt}`,
          '# Table 4A = B2B (registered), Table 5 = B2CL (>2.5L inter-state), Table 6A = Exports, Table 7 = B2CS',
          'Table,InvoiceNo,InvoiceDate,RecipientGSTIN,POS,SupplyType,TaxableValue,Rate%,IGST,CGST,SGST,Cess',
        ];

        outward.forEach((t) => {
          const taxable = getAmountInBase(t, baseCurrency);
          const rate = t.gstRate ?? 0;
          const gst = taxable * rate / 100;
          const pos = t.customerCountry && t.customerCountry.toUpperCase() !== 'IN'
            ? (t.customerCountry || '96')
            : (profile?.parent?.stateCode || profile?.parent?.state || '27');
          if (isExport(t)) {
            lines.push(['6A', t.id, t.date, '', pos, 'Export-LUT', taxable.toFixed(2), '0', '0.00', '0.00', '0.00', '0.00'].join(','));
          } else if (t.recipientGstin) {
            const igst = isInterState(t) ? gst : 0;
            lines.push(['4A', t.id, t.date, t.recipientGstin, pos, 'B2B', taxable.toFixed(2), String(rate), igst.toFixed(2), igst ? '0.00' : (gst/2).toFixed(2), igst ? '0.00' : (gst/2).toFixed(2), '0.00'].join(','));
          } else if (taxable > 250000 && isInterState(t)) {
            lines.push(['5', t.id, t.date, '', pos, 'B2CL', taxable.toFixed(2), String(rate), gst.toFixed(2), '0.00', '0.00', '0.00'].join(','));
          } else {
            lines.push(['7', t.id, t.date, '', pos, 'B2CS', taxable.toFixed(2), String(rate), '0.00', (gst/2).toFixed(2), (gst/2).toFixed(2), '0.00'].join(','));
          }
        });

        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `GSTR1_Draft_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        setIsDownloading(false);
        return;
      }

      if (name === 'gst_3b') {
        const outward = activeTxns.filter((t) => t.type === 'Income' && isCompletedForTotal(t));
        const inward = activeTxns.filter((t) => t.type === 'Purchase' && isCompletedForTotal(t));
        const isExport = (t: Transaction) =>
          (t.customerCountry && t.customerCountry.toUpperCase() !== 'IN') ||
          (t.customerLocation && t.customerLocation.toUpperCase() !== 'IN') ||
          (t.classification && String(t.classification).toLowerCase().includes('export'));

        const exportTaxable = outward.filter(isExport).reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
        const domesticTaxable = outward.filter((t) => !isExport(t)).reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
        const domesticGst = outward.filter((t) => !isExport(t)).reduce((s, t) => {
          const amt = getAmountInBase(t, baseCurrency); return s + amt * (t.gstRate ?? 0) / 100;
        }, 0);
        const totalItc = inward.filter(t => t.itcEligible !== false).reduce((s, t) => s + getGstImpactInBase(t, baseCurrency), 0);
        const blockedItcAmt = inward.filter(t => t.itcEligible === false).reduce((s, t) => s + getGstImpactInBase(t, baseCurrency), 0);

        const lines: string[] = [
          '# GSTR-3B (Draft summary format aligned to GST filing sections)',
          `# GSTIN: ${gstin}`,
          `# GeneratedAt: ${generatedAt}`,
          'Table,Description,TaxableValue,IGST,CGST,SGST,Cess',
          `3.1(a),Outward taxable supplies (other than zero rated),${domesticTaxable.toFixed(2)},0.00,${(domesticGst / 2).toFixed(2)},${(domesticGst / 2).toFixed(2)},0.00`,
          `3.1(b),Outward taxable supplies (zero rated),${exportTaxable.toFixed(2)},0.00,0.00,0.00,0.00`,
          '3.1(c),Other outward supplies (Nil/exempt),0.00,0.00,0.00,0.00,0.00',
          '3.1(d),Inward supplies liable to reverse charge,0.00,0.00,0.00,0.00,0.00',
          '3.1(e),Non-GST outward supplies,0.00,0.00,0.00,0.00,0.00',
          '',
          'Table,ITC Description,IGST,CGST,SGST,Cess',
          `4A(5),All other ITC (eligible only),0.00,${(totalItc / 2).toFixed(2)},${(totalItc / 2).toFixed(2)},0.00`,
          `4B(1),Sec 17(5) blocked ITC (ineligible — do not claim),0.00,${(blockedItcAmt / 2).toFixed(2)},${(blockedItcAmt / 2).toFixed(2)},0.00`,
          '4B(2),Others (reversal),0.00,0.00,0.00,0.00',
          `4C,Net ITC Available,0.00,${(totalItc / 2).toFixed(2)},${(totalItc / 2).toFixed(2)},0.00`,
          '',
          'Table,Tax payable after ITC,IGST,CGST,SGST,Cess',
          `6.1,Net tax payable,0.00,${Math.max(0, (domesticGst - totalItc) / 2).toFixed(2)},${Math.max(0, (domesticGst - totalItc) / 2).toFixed(2)},0.00`,
        ];

        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `GSTR3B_Draft_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
        <div>
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">GSTR-1 (Outward Supplies)</h3>
          <p className="text-xs text-slate-400 font-medium mt-1">{fyLabel} · CGST Act §37</p>
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
          disabled={isDownloading}
          className="w-full bg-slate-900 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all"
        >
          Download GSTR-1 CSV (Offline Utility)
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
          disabled={isDownloading}
          className="w-full border-2 border-slate-200 text-slate-900 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
        >
          Generate Draft GSTR-3B CSV
        </button>
      </div>
    </div>
  );
};

export default GSTCenter;
