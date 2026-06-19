
import React, { useState, useEffect, useMemo } from 'react';
import { getBaseCurrency, formatAmount, getFxRateForDate } from '../services/currencyService';
import { Transaction } from '../types';
import {
  getTransferPricingData,
  setTransferPricingData,
  getTransactions,
  setTransactions,
} from '../services/storageService';
import {
  type ExportInvoiceConfig,
  getDefaultExportInvoiceConfig,
  buildExportInvoiceData,
  openExportInvoicePrint,
  buildInvoiceRecordFromExport,
  generateExportInvoiceNumber,
  peekExportInvoiceNumber,
  EXPORT_SAC_CODE,
  EXPORT_PURPOSE_CODE,
} from '../services/exportInvoiceService';
import ExportInvoicePreview from './ExportInvoicePreview';
import { useUpsertInvoice } from '../hooks/useInvoices';

const TransferPricing: React.FC = () => {
  const baseCurrency = getBaseCurrency();
  const savedData = getTransferPricingData();
  const [usRevenue, setUsRevenue] = useState(savedData.usRevenue);
  const [usExpenses, setUsExpenses] = useState(savedData.usExpenses);
  const [margin, setMargin] = useState(savedData.margin);
  const [isPosting, setIsPosting] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [liveRate, setLiveRate] = useState<number>(84.0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'calculator' | 'invoice'>('calculator');
  const [invoiceNumber, setInvoiceNumber] = useState(
    () => savedData.exportInvoice?.lastSeq
      ? `EXP-${new Date().getFullYear()}-${String(savedData.exportInvoice.lastSeq).padStart(3, '0')}`
      : peekExportInvoiceNumber(),
  );
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);

  const [exportConfig, setExportConfig] = useState<ExportInvoiceConfig>(() =>
    getDefaultExportInvoiceConfig(savedData.exportInvoice),
  );

  const { mutate: upsertInvoice } = useUpsertInvoice();

  const invoiceAmount = (usRevenue - usExpenses) * (1 - margin / 100);
  const amountInBase = baseCurrency === 'INR' ? invoiceAmount * liveRate : invoiceAmount;

  const exportInvoiceData = useMemo(
    () => buildExportInvoiceData(exportConfig, invoiceAmount, { invoiceNumber, invoiceDate }),
    [exportConfig, invoiceAmount, invoiceNumber, invoiceDate],
  );

  useEffect(() => {
    setTransferPricingData({ usRevenue, usExpenses, margin, exportInvoice: exportConfig });
  }, [usRevenue, usExpenses, margin, exportConfig]);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    getFxRateForDate(today, 'USD', 'INR')
      .then((rate) => { if (rate > 0) setLiveRate(rate); })
      .catch(() => { /* fallback stays at 84.0 */ });
  }, []);

  const updateConfig = <K extends keyof ExportInvoiceConfig>(key: K, value: ExportInvoiceConfig[K]) => {
    setExportConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateBank = <K extends keyof ExportInvoiceConfig['bank']>(
    key: K,
    value: ExportInvoiceConfig['bank'][K],
  ) => {
    setExportConfig((prev) => ({ ...prev, bank: { ...prev.bank, [key]: value } }));
  };

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handlePostToLedger = () => {
    setIsPosting(true);
    setTimeout(() => {
      const txs = getTransactions();
      const newTx: Transaction = {
        id: `TP-${Date.now()}`,
        date: invoiceDate,
        description: `Intercompany Service Fee: ${exportInvoiceData.invoiceNumber}`,
        amount: amountInBase,
        currency: baseCurrency,
        source: 'Manual',
        category: 'Transfer Pricing',
        status: 'Completed',
        type: 'Income',
        gstImpact: 0,
        customerLocation: 'US',
        narration: `B2B export of services — ${exportInvoiceData.invoiceNumber}`,
      };

      setTransactions([newTx, ...txs]);
      setIsPosting(false);
      showSuccess('Intercompany invoice posted to Global Ledger.');
    }, 600);
  };

  const handleExportPdf = () => {
    setIsExportingPdf(true);
    openExportInvoicePrint(exportInvoiceData);
    setTimeout(() => setIsExportingPdf(false), 500);
  };

  const handleSaveToInvoices = () => {
    setIsSavingInvoice(true);
    const record = buildInvoiceRecordFromExport(exportInvoiceData);
    upsertInvoice(record, {
      onSuccess: () => {
        showSuccess(`Saved as ${record.number} in Invoice Ledger.`);
        setIsSavingInvoice(false);
      },
      onError: () => {
        showSuccess(`Saved locally as ${record.number}.`);
        setIsSavingInvoice(false);
      },
    });
  };

  const handleNewInvoiceNumber = () => {
    const next = generateExportInvoiceNumber();
    setInvoiceNumber(next);
    updateConfig('lastSeq', Number(next.split('-').pop()));
  };

  const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm';
  const labelClass = 'block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide';

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-slate-900">Transfer Pricing Engine</h2>
          <span className="bg-indigo-100 text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded uppercase border border-indigo-200">
            B2B Export of Services
          </span>
        </div>
        <p className="text-slate-500 mt-1">
          Generate arm&apos;s-length commercial invoices from your Indian LLP to the US C-Corp — LUT zero-rated export, FIRC-ready wire instructions, IRS-deductible expenses.
        </p>
      </header>

      <div className="flex gap-2 border-b border-slate-200">
        {(['calculator', 'invoice'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveSection(tab)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              activeSection === tab
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'calculator' ? 'TP Calculator' : 'Commercial Invoice'}
          </button>
        ))}
      </div>

      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium px-4 py-3 rounded-lg">
          {successMessage}
        </div>
      )}

      {activeSection === 'calculator' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Calculator (Monthly)</h3>

            <div className="space-y-4">
              <div>
                <label className={labelClass}>Total US Revenue (Stripe + MoR)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400">$</span>
                  <input
                    type="number"
                    value={usRevenue}
                    onChange={(e) => setUsRevenue(Number(e.target.value))}
                    className={`${inputClass} pl-8`}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Direct US Expenses (Hosting/Fees)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400">$</span>
                  <input
                    type="number"
                    value={usExpenses}
                    onChange={(e) => setUsExpenses(Number(e.target.value))}
                    className={`${inputClass} pl-8`}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Configurable US Margin (%)</label>
                <input
                  type="range"
                  min="3"
                  max="25"
                  step="0.5"
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>3% (Aggressive)</span>
                  <span className="font-bold text-slate-700">{margin}%</span>
                  <span>25% (Cost-Plus)</span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Cost-Plus (15–25%) is the standard safe harbor. Profit Split applies when the LLP owns IP and bears operational risk.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-emerald-900 font-bold mb-1">Invoice Summary</h3>
              <p className="text-emerald-700 text-sm mb-6">Optimized for IRS Arm&apos;s Length compliance.</p>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-800">Invoice Amount:</span>
                  <span className="font-bold text-emerald-900">${invoiceAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-800">In {baseCurrency}:</span>
                  <span className="font-bold text-emerald-900">{formatAmount(amountInBase, baseCurrency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-800">Live USD/INR Rate:</span>
                  <span className="font-bold text-emerald-900">₹{liveRate.toFixed(2)}</span>
                </div>
                <div className="pt-3 border-t border-emerald-200 flex justify-between text-sm">
                  <span className="text-emerald-800">US Tax Exposure Reduced by (~21%):</span>
                  <span className="font-bold text-emerald-600">${(invoiceAmount * 0.21).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveSection('invoice')}
              className="mt-6 w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700 text-sm"
            >
              Configure Commercial Invoice →
            </button>
          </div>
        </div>
      )}

      {activeSection === 'invoice' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-900">Invoice Details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Invoice Number</label>
                  <div className="flex gap-2">
                    <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                    <button type="button" onClick={handleNewInvoiceNumber} className="px-2 py-1 text-xs bg-slate-100 rounded border hover:bg-slate-200" title="Generate next number">+</button>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Invoice Date</label>
                  <input type="date" className={inputClass} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>LUT ARN Number</label>
                  <input className={inputClass} value={exportConfig.lutNumber} onChange={(e) => updateConfig('lutNumber', e.target.value)} placeholder="2026-2027 LUT ARN" />
                </div>
                <div>
                  <label className={labelClass}>Payment Terms</label>
                  <input className={inputClass} value={exportConfig.paymentTerms} onChange={(e) => updateConfig('paymentTerms', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Place of Supply</label>
                  <input className={inputClass} value={exportConfig.placeOfSupply} onChange={(e) => updateConfig('placeOfSupply', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-900">Service &amp; Agreement</h3>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Service Description</label>
                  <textarea
                    className={`${inputClass} min-h-[72px]`}
                    value={exportConfig.serviceDescription}
                    onChange={(e) => updateConfig('serviceDescription', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>SAC Code</label>
                    <input className={inputClass} value={exportConfig.sacCode} onChange={(e) => updateConfig('sacCode', e.target.value)} />
                    <p className="text-[10px] text-slate-400 mt-1">{EXPORT_SAC_CODE} = IT design &amp; development</p>
                  </div>
                  <div>
                    <label className={labelClass}>Purpose Code (RBI)</label>
                    <input className={inputClass} value={exportConfig.purposeCode} onChange={(e) => updateConfig('purposeCode', e.target.value)} />
                    <p className="text-[10px] text-slate-400 mt-1">{EXPORT_PURPOSE_CODE} = Software consultancy</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Agreement Reference</label>
                    <input className={inputClass} value={exportConfig.agreementReference} onChange={(e) => updateConfig('agreementReference', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Agreement Date</label>
                    <input type="date" className={inputClass} value={exportConfig.agreementDate} onChange={(e) => updateConfig('agreementDate', e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="useCalc"
                    checked={exportConfig.useCalculatedAmount}
                    onChange={(e) => updateConfig('useCalculatedAmount', e.target.checked)}
                    className="accent-emerald-600"
                  />
                  <label htmlFor="useCalc" className="text-sm text-slate-700">
                    Use TP calculator amount (${invoiceAmount.toLocaleString()})
                  </label>
                </div>
                {!exportConfig.useCalculatedAmount && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Qty / Hours</label>
                      <input type="number" className={inputClass} value={exportConfig.qty} onChange={(e) => updateConfig('qty', Number(e.target.value))} />
                    </div>
                    <div>
                      <label className={labelClass}>Rate (USD)</label>
                      <input type="number" className={inputClass} value={exportConfig.rateUsd} onChange={(e) => updateConfig('rateUsd', Number(e.target.value))} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-900">Wire Transfer (FIRC)</h3>
              <p className="text-xs text-slate-500">Bank details prefill from Invoice → Company profile when configured.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelClass}>Beneficiary Name</label>
                  <input className={inputClass} value={exportConfig.bank.beneficiaryName} onChange={(e) => updateBank('beneficiaryName', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Account Number</label>
                  <input className={inputClass} value={exportConfig.bank.accountNumber} onChange={(e) => updateBank('accountNumber', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Bank Name</label>
                  <input className={inputClass} value={exportConfig.bank.bankName} onChange={(e) => updateBank('bankName', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Branch Address</label>
                  <input className={inputClass} value={exportConfig.bank.branchAddress} onChange={(e) => updateBank('branchAddress', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>SWIFT Code</label>
                  <input className={inputClass} value={exportConfig.bank.swiftCode} onChange={(e) => updateBank('swiftCode', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>AD Code</label>
                  <input className={inputClass} value={exportConfig.bank.adCode} onChange={(e) => updateBank('adCode', e.target.value)} placeholder="Authorized Dealer Code" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExportingPdf}
                className="bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700 text-xs uppercase tracking-wide disabled:opacity-50"
              >
                {isExportingPdf ? '…' : 'Export PDF'}
              </button>
              <button
                type="button"
                onClick={handleSaveToInvoices}
                disabled={isSavingInvoice}
                className="bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 text-xs uppercase tracking-wide disabled:opacity-50"
              >
                {isSavingInvoice ? '…' : 'Save Invoice'}
              </button>
              <button
                type="button"
                onClick={handlePostToLedger}
                disabled={isPosting}
                className="bg-slate-900 text-white py-3 rounded-lg font-bold hover:bg-slate-800 text-xs uppercase tracking-wide disabled:opacity-50"
              >
                {isPosting ? '…' : 'Post Ledger'}
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900 space-y-2">
              <p><strong>LUT Declaration</strong> — Mandatory at top of invoice. Missing it makes the supply domestic (18% IGST liability).</p>
              <p><strong>SAC {EXPORT_SAC_CODE}</strong> — IT design &amp; development classification for GST audits.</p>
              <p><strong>Purpose {EXPORT_PURPOSE_CODE}</strong> — Required for RBI FIRC when USD hits your Indian account.</p>
              <p><strong>Agreement Reference</strong> — Ties invoice to Intercompany Agreement for IRS deductibility.</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-auto max-h-[calc(100vh-200px)] sticky top-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Live Preview</h3>
            <ExportInvoicePreview data={exportInvoiceData} />
          </div>
        </div>
      )}
    </div>
  );
};

export default TransferPricing;
