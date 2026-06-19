
import React, { useState, useEffect } from 'react';
import { getTaxEngineData, setTaxEngineData, getCompanyProfile } from '../services/storageService';

function downloadFile(content: string, filename: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Generate Form 26Q-style CSV for TDS on payments other than salary (e.g. partner remuneration Sec 194T). */
function generateForm26QCSV() {
  const profile = getCompanyProfile();
  const data = getTaxEngineData();
  const bookProfit = data.bookProfit ?? 0;
  const first3L = Math.min(bookProfit, 300000) * 0.9;
  const balance = Math.max(0, bookProfit - 300000) * 0.6;
  const maxRem = Math.max(150000, first3L + balance);
  const tds194T = maxRem > 20000 ? maxRem * 0.1 : 0;

  const header = ['Sr No', 'PAN of Deductee', 'Name', 'Section Code', 'Payment Date', 'Amount Paid', 'TDS Deducted', 'TAN of Deductor', 'Assessment Year'].join(',');
  const rows: string[] = [];
  if (tds194T > 0) {
    rows.push([
      1,
      profile?.parent?.pan || 'PANNOTAVBL',
      `"Partner Remuneration (Sec 40b)"`,
      '194T',
      new Date().toISOString().split('T')[0],
      Math.round(maxRem),
      Math.round(tds194T),
      profile?.parent?.taxId || '',
      '2026-27',
    ].join(','));
  }

  const content = [
    `# Form 26Q - Quarterly Statement of TDS (Other than Salary)`,
    `# Generated: ${new Date().toISOString()}`,
    `# Deductor: ${profile?.parent?.name || ''} | TAN: ${profile?.parent?.taxId || ''}`,
    '',
    header,
    ...rows,
  ].join('\n');

  downloadFile(content, 'Form26Q_FY2025-26.csv', 'text/csv');
}

const TaxEngine: React.FC = () => {
  const savedData = getTaxEngineData();
  const [bookProfit, setBookProfit] = useState(savedData.bookProfit);

  // Persist inputs when they change
  useEffect(() => {
    setTaxEngineData({ bookProfit });
  }, [bookProfit]); 
  
  const calculateMaxRemuneration = (profit: number) => {
    if (profit <= 0) return 150000;
    const first3L = Math.min(profit, 300000) * 0.9;
    const balance = Math.max(0, profit - 300000) * 0.6;
    return Math.max(150000, first3L + balance);
  };

  const maxRem = calculateMaxRemuneration(bookProfit);
  // TDS Sec 194T logic: Effective April 1, 2025. In January 2026 this is active.
  const tds = maxRem > 20000 ? maxRem * 0.1 : 0;

  return (
    <div className="max-w-4xl space-y-8">
      <header>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-slate-900">Indian Taxation & Payroll</h2>
          <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-bold">FY 2025-26</span>
        </div>
        <p className="text-slate-500">Managing active Partner Remuneration (Sec 40b) and TDS (194T) as of January 2026.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-lg font-bold text-slate-900 uppercase text-xs tracking-widest">Partner Remuneration Planner</h3>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Projected FY25-26 Book Profit (₹)</label>
            <input 
              type="number" 
              value={bookProfit} 
              onChange={(e) => setBookProfit(Number(e.target.value))}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <p className="text-[10px] text-slate-400 mt-1 italic">Profit before Partner Salary and Interest.</p>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 font-bold uppercase text-[10px]">Max Deductible Salary:</span>
              <span className="font-black text-slate-900">₹{maxRem.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm text-emerald-600 font-medium">
              <span className="uppercase text-[10px]">Section 40(b) Status:</span>
              <span className="font-bold">ACTIVE & OPTIMIZED</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-lg font-bold text-slate-900 uppercase text-xs tracking-widest">TDS Watchdog (Sec 194T)</h3>
          
          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg flex items-start gap-3">
            <span className="text-xl">✅</span>
            <div>
              <p className="text-emerald-900 font-bold text-sm uppercase text-xs tracking-tight">Requirement Active (Post Apr 1, 2025)</p>
              <p className="text-emerald-800 text-xs mt-1">10% TDS mandatory on all partner payments. Currently applied in January 2026 cycle.</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600">Monthly Remuneration Draw:</span>
              <span className="font-bold text-slate-900">₹{(maxRem/12).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-rose-600 font-medium uppercase text-[10px] font-black">Monthly TDS (10%):</span>
              <span className="font-bold text-rose-600">₹{(maxRem/12 * 0.1).toLocaleString()}</span>
            </div>
            <div className="pt-3 border-t flex justify-between items-center font-bold">
              <span className="uppercase text-[11px] font-black">Net In-Hand (Monthly):</span>
              <span className="text-emerald-700">₹{(maxRem/12 * 0.9).toLocaleString()}</span>
            </div>
          </div>

          <button
            onClick={() => {
              generateForm26QCSV();
            }}
            className="w-full py-3 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
          >
            Generate Form 26Q Data (CSV)
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaxEngine;
