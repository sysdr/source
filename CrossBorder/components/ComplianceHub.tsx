
import React, { useState, useEffect } from 'react';
import { VaultDocument } from '../types';
import { getCompanyProfile, getVaultDocuments, getTransactions, getEmployees, getPayrollRuns, getTransferPricingData } from '../services/storageService';
import {
  generateForm24QCSV,
  generateForm26QCSV,
  generatePFECR,
  generateESIReturn,
  generatePTChallan,
  generateBankFile,
  generateForm16PDF,
} from '../services/statutoryReports';
import { getBaseCurrency, getAmountInBase } from '../services/currencyService';
import { analyzeInvoiceWithFallback } from '../services/aiFallback';
import {
  DEFERRED_FILINGS,
  FILING_DISCLAIMER,
  form5472ToCsv,
  generateForm5472,
  generateGstr1,
  gstr1ToJsonString,
} from '../services/filings';
import AsyncStatusBanner from './AsyncStatusBanner';
import { IDLE_ASYNC_STATE, type AsyncOperationState } from '../services/asyncOperation';
import { getAppPublicBaseUrl, getServerBaseUrl } from '../services/serverUrl';
import { useViewport } from '../hooks/useViewport';

const FY_OPTIONS = ['2024-25', '2025-26', '2026-27'];
const QUARTER_OPTIONS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

const ComplianceHub: React.FC = () => {
  const [loadingReport, setLoadingReport] = useState<number | null>(null);
  const [vault, setVault] = useState<VaultDocument[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [exportAsync, setExportAsync] = useState<AsyncOperationState>(IDLE_ASYNC_STATE);
  const { isMobile } = useViewport();
  const [selectedFY, setSelectedFY] = useState('2025-26');
  const [selectedQuarter, setSelectedQuarter] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q3');
  const [invoiceText, setInvoiceText] = useState('');
  const [invoiceResult, setInvoiceResult] = useState<{ isCompliant?: boolean; missingElements?: string[]; suggestedRemedy?: string; provider?: string } | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [showInvoiceCheck, setShowInvoiceCheck] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  useEffect(() => {
    setVault(getVaultDocuments());
    const refresh = () => setVault(getVaultDocuments());
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, []);

  const reports = [
    { id: 'tax_audit', title: 'Tax Audit Report (Sec 44AB)', region: 'India', status: 'Drafting', urgency: 'Low', icon: '📝', type: 'tax_audit_44ab' as const },
    { id: '5472', title: 'Form 5472 Transaction Data', region: 'US', status: 'Ready', urgency: 'Critical', icon: '🇺🇸', type: '5472' as const },
    { id: 'gstr1', title: 'GSTR-1 Export Register', region: 'India', status: 'Complete', urgency: 'Normal', icon: '🧾', type: 'gstr1' as const },
    { id: '24q', title: 'Form 24Q (Employee TDS)', region: 'India', status: 'Ready', urgency: 'Normal', icon: '👥', type: '24q' as const },
    { id: '26q', title: 'Form 26Q (Non-salary TDS)', region: 'India', status: 'Ready', urgency: 'Normal', icon: '📑', type: '26q' as const },
    { id: 'pf_ecr', title: 'PF ECR (EPFO)', region: 'India', status: 'Ready', urgency: 'Normal', icon: '🏛️', type: 'pf_ecr' as const },
    { id: 'esi', title: 'ESI Monthly Return', region: 'India', status: 'Ready', urgency: 'Normal', icon: '🏥', type: 'esi' as const },
    { id: 'pt', title: 'PT Challan', region: 'India', status: 'Ready', urgency: 'Normal', icon: '📋', type: 'pt' as const },
    { id: 'bank_file', title: 'Bank Payment (NEFT)', region: 'India', status: 'Ready', urgency: 'Normal', icon: '🏦', type: 'bank_file' as const },
    { id: 'form16', title: 'Form 16 (Employee)', region: 'India', status: 'Ready', urgency: 'Normal', icon: '📄', type: 'form16' as const },
    { id: 'capital', title: 'Capital Account Summary', region: 'Internal', status: 'Review', urgency: 'Normal', icon: '📈', type: 'capital_summary' as const },
    { id: 'mt940', title: 'Mercury Bank Export (MT940)', region: 'US', status: 'Synced', urgency: 'Low', icon: '🏦', type: 'mt940' as const },
  ];

  const handleDownload = (idx: number, report: typeof reports[number]) => {
    if (!acknowledged) {
      showToast('Acknowledge the filing disclaimer before downloading.');
      return;
    }
    setLoadingReport(idx);
    const baseCurrency = getBaseCurrency();

    if (report.type === '24q') {
      const profile = getCompanyProfile();
      const employees = getEmployees();
      const runs = getPayrollRuns();
      try {
        generateForm24QCSV(employees, runs, selectedQuarter, selectedFY, profile!);
      } catch (err) {
        showToast((err as Error).message);
      } finally {
        setLoadingReport(null);
      }
      return;
    }

    if (report.type === '26q') {
      const profile = getCompanyProfile();
      try {
        generateForm26QCSV(selectedQuarter, selectedFY, profile);
      } catch (err) {
        showToast((err as Error).message);
      } finally {
        setLoadingReport(null);
      }
      return;
    }

    if (report.type === 'pf_ecr' || report.type === 'esi' || report.type === 'pt' || report.type === 'bank_file') {
      const profile = getCompanyProfile();
      const employees = getEmployees();
      const runs = getPayrollRuns();
      const latestRun = runs.length > 0 ? runs[runs.length - 1] : null;
      if (!latestRun) {
        showToast('No payroll runs found. Run payroll first from the Payroll module.');
        setLoadingReport(null);
        return;
      }
      try {
        if (report.type === 'pf_ecr') generatePFECR(employees, latestRun, profile!);
        else if (report.type === 'esi') generateESIReturn(employees, latestRun);
        else if (report.type === 'pt') generatePTChallan(employees, latestRun, profile!);
        else generateBankFile(employees, latestRun, profile!);
      } finally {
        setLoadingReport(null);
      }
      return;
    }

    if (report.type === 'form16') {
      const profile = getCompanyProfile();
      const employees = getEmployees();
      const runs = getPayrollRuns();
      const empWithSlips = employees.find((e) => runs.some((r) => r.employeeSlips.some((s) => s.employeeId === e.id)));
      if (!empWithSlips || runs.length === 0) {
        showToast('No employee with payroll data found. Run payroll first.');
        setLoadingReport(null);
        return;
      }
      try {
        generateForm16PDF(empWithSlips, runs, selectedFY, profile!);
      } finally {
        setLoadingReport(null);
      }
      return;
    }

    if (report.type === '5472') {
      const profile = getCompanyProfile();
      const tp = getTransferPricingData();
      const txs = getTransactions();
      const result = generateForm5472({
        profile: profile!,
        taxYear: selectedFY.split('-')[0],
        transactions: txs,
        transferPricing: tp,
      });
      if (!result.ok) {
        showToast(result.issues.map((i) => i.message).join('; '));
        setLoadingReport(null);
        return;
      }
      const csv = form5472ToCsv(result.data as Parameters<typeof form5472ToCsv>[0]);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Form5472_RelatedParty_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      setLoadingReport(null);
      return;
    }

    if (report.type === 'gstr1') {
      const profile = getCompanyProfile();
      const transactions = getTransactions();
      const now = new Date();
      const fp = `${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
      const result = generateGstr1({
        gstin: profile?.parent?.taxId || 'UNREGISTERED',
        fp,
        supplierStateCode: profile?.parent?.stateCode || '27',
        transactions,
      });
      if (!result.ok) {
        showToast(result.issues.map((i) => i.message).join('; '));
        setLoadingReport(null);
        return;
      }
      const blob = new Blob([gstr1ToJsonString(result.data)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GSTR1_${fp}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      setLoadingReport(null);
      return;
    }

    if (report.type === 'tax_audit_44ab') {
      const profile = getCompanyProfile();
      const txs = getTransactions();
      const income = txs.filter((t) => t.type === 'Income' && t.status !== 'Failed').reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
      const purchases = txs.filter((t) => t.type === 'Purchase').reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
      const expenses = txs.filter((t) => t.type === 'Expense').reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
      const profit = income - purchases - expenses;
      const content = [
        `TAX AUDIT REPORT (Sec 44AB) - DRAFT`,
        `Entity: ${profile?.parent?.name || 'N/A'} | PAN: ${profile?.parent?.pan || 'N/A'}`,
        `Generated: ${new Date().toISOString()}`,
        ``,
        `Gross Receipts/Turnover: ${income.toFixed(2)} ${baseCurrency}`,
        `Less: Purchases/Cost: ${purchases.toFixed(2)}`,
        `Less: Operating Expenses: ${expenses.toFixed(2)}`,
        `Net Profit/(Loss): ${profit.toFixed(2)}`,
        ``,
        `This is a draft summary. Use for tax audit preparation.`,
      ].join('\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `TaxAudit_Sec44AB_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      window.URL.revokeObjectURL(url);
      setLoadingReport(null);
      return;
    }

    if (report.type === 'capital_summary') {
      const profile = getCompanyProfile();
      const txs = getTransactions();
      const parentTx = txs.filter((t) => t.entity === 'parent');
      const subTx = txs.filter((t) => t.entity === 'subsidiary');
      const parentIncome = parentTx.filter((t) => t.type === 'Income').reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
      const parentExp = parentTx.filter((t) => t.type !== 'Income').reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
      const subIncome = subTx.filter((t) => t.type === 'Income').reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
      const subExp = subTx.filter((t) => t.type !== 'Income').reduce((s, t) => s + getAmountInBase(t, baseCurrency), 0);
      const content = [
        `CAPITAL ACCOUNT SUMMARY`,
        `Generated: ${new Date().toLocaleString()}`,
        ``,
        `${profile?.parent?.name || 'Parent'} (India):`,
        `  Total Income: ${parentIncome.toFixed(2)} ${baseCurrency}`,
        `  Total Outgo: ${parentExp.toFixed(2)}`,
        `  Net: ${(parentIncome - parentExp).toFixed(2)}`,
        ``,
        `${profile?.subsidiary?.name || 'Subsidiary'} (US):`,
        `  Total Income: ${subIncome.toFixed(2)} ${baseCurrency}`,
        `  Total Outgo: ${subExp.toFixed(2)}`,
        `  Net: ${(subIncome - subExp).toFixed(2)}`,
      ].join('\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Capital_Account_Summary_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      window.URL.revokeObjectURL(url);
      setLoadingReport(null);
      return;
    }

    if (report.type === 'mt940') {
      const profile = getCompanyProfile();
      const txs = getTransactions().filter((t) => t.status !== 'Failed').slice(0, 500);
      const lines: string[] = [
        ':20:SUEZMT940',
        ':25:XXXXXXXX/USD',
        `:28C:${new Date().getFullYear()}01`,
        ':60F:C250131USD0,00',
      ];
      let runningBalance = 0;
      txs.forEach((t) => {
        const amt = getAmountInBase(t, baseCurrency);
        if (t.type === 'Income') runningBalance += amt;
        else runningBalance -= amt;
        const drcr = t.type === 'Income' ? 'C' : 'D';
        const date = (t.date || '').replace(/-/g, '');
        lines.push(`:61:${date}${drcr}${Math.abs(amt).toFixed(2)}NTRF${(t.description || '').slice(0, 35)}`);
      });
      lines.push(`:62F:C${new Date().toISOString().slice(0, 10).replace(/-/g, '')}USD${runningBalance.toFixed(2)}`);
      lines.push('-');
      const content = lines.join('\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MT940_${profile?.subsidiary?.name || 'US'}_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      window.URL.revokeObjectURL(url);
      setLoadingReport(null);
      return;
    }

    setTimeout(() => {
      const r = report as { title: string; status: string };
      const content = `COMPLIANCE REPORT: ${r.title}\nEntity: Suez Global\nStatus: ${r.status}\nGenerated by Project Suez OS on ${new Date().toLocaleDateString()}\n\n-- CONFIDENTIAL DATA --`;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Suez_Report_${r.title.replace(/\s/g, '_')}.txt`;
      a.click();
      setLoadingReport(null);
    }, 800);
  };

  const handleInviteAccountant = async () => {
    if (!inviteEmail?.trim()) {
      showToast('Please enter an email address.');
      return;
    }
    const profile = getCompanyProfile();
    const orgId = localStorage.getItem('suez_active_org_id') ?? 'default';
    const BASE = getServerBaseUrl();
    try {
      setInviteBusy(true);
      const res = await fetch(`${BASE}/api/accountant-invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SUEZ-ROLE': 'owner' },
        body: JSON.stringify({
          orgId,
          email: inviteEmail.trim(),
          orgName: profile?.projectName,
          appBase: getAppPublicBaseUrl(),
        }),
      });
      const json = await res.json() as { ok?: boolean; inviteUrl?: string; error?: string; invite?: { expiresAt: string } };
      if (!res.ok || !json.ok || !json.inviteUrl) {
        showToast(json.error || 'Failed to create accountant invite');
        return;
      }
      setInviteLink(json.inviteUrl);
      const subject = encodeURIComponent(`72-hour read-only access — ${profile?.projectName || 'Project Suez'}`);
      const body = encodeURIComponent(
        `Hi,\n\nYou have been invited to review books for ${profile?.projectName || 'Project Suez'} in read-only mode (valid 72 hours).\n\nOpen this link:\n${json.inviteUrl}\n\nYou can export filing-ready data but cannot create or modify records.\n\nBest regards`,
      );
      window.location.href = `mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`;
      showToast('Invite link created (72h). Email client opened — copy the link if needed.');
    } catch (err) {
      showToast((err as Error).message || 'Invite failed');
    } finally {
      setInviteBusy(false);
    }
  };

  const downloadVaultDoc = (doc: VaultDocument) => {
    const blob = new Blob([doc.content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.replace(/\s/g, '_')}.txt`;
    a.click();
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-500">
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-[200] px-5 py-3 rounded-xl text-sm font-medium shadow-lg bg-slate-800 text-white animate-in slide-in-from-right duration-300">
          {toastMsg}
        </div>
      )}
      {loadingReport !== null && (
        <AsyncStatusBanner
          state={{
            phase: 'loading',
            step: reports[loadingReport]?.title ?? 'Export',
            message: `Generating ${reports[loadingReport]?.title ?? 'export'}…`,
            remediation: null,
            detail: null,
            result: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
          }}
        />
      )}
      {exportAsync.phase !== 'idle' && exportAsync.phase !== 'loading' && (
        <AsyncStatusBanner state={exportAsync} onDismiss={() => setExportAsync(IDLE_ASYNC_STATE)} />
      )}
      {isMobile && (
        <div role="status" className="p-3 rounded-xl text-sm font-medium" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          Mobile view — downloads work; interactive data entry (payroll run, journal) is desktop-only.
        </div>
      )}
      <header>
        <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Compliance Hub</h2>
        <p className="text-slate-500 mt-1 font-medium">Download reports for final tax filing and audit preparation.</p>
      </header>

      <section className="space-y-6">
        <h3 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Statutory Reports</h3>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span className="text-xs text-amber-950 leading-relaxed">
              <span className="font-black uppercase tracking-wide text-[10px] block mb-1">Filing disclaimer</span>
              {FILING_DISCLAIMER}
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <span className="text-[10px] font-black text-slate-400 uppercase">Form 24Q options:</span>
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">FY</span>
            <select value={selectedFY} onChange={(e) => setSelectedFY(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium bg-white">
              {FY_OPTIONS.map((fy) => (
                <option key={fy} value={fy}>{fy}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Quarter</span>
            <select value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value as typeof selectedQuarter)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium bg-white">
              {QUARTER_OPTIONS.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reports.map((report, idx) => (
            <div key={report.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-lg transition-all group">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-2xl">{report.icon}</span>
                  <span className={`text-[9px] font-black uppercase px-2 py-1 rounded border ${
                    report.urgency === 'Critical' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-slate-50 text-slate-500 border-slate-100'
                  }`}>
                    {report.urgency}
                  </span>
                </div>
                <h4 className="font-black text-slate-900 uppercase text-xs tracking-tight group-hover:text-indigo-600 transition-colors">{report.title}</h4>
                <p className="text-[10px] font-bold text-slate-400 mt-1">{report.region} ENTITY • {report.status}</p>
              </div>
              <div className="mt-8 flex gap-2">
                <button 
                  onClick={() => handleDownload(idx, report)}
                  disabled={loadingReport === idx || !acknowledged}
                  className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loadingReport === idx ? (
                    <span className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></span>
                  ) : 'Download'}
                </button>
              </div>
            </div>
          ))}
          {DEFERRED_FILINGS.map((item) => (
            <div key={item.id} className="bg-slate-50 p-6 rounded-3xl border border-dashed border-slate-300 flex flex-col justify-between opacity-80">
              <div>
                <h4 className="font-black text-slate-700 uppercase text-xs tracking-tight">{item.title}</h4>
                <p className="text-[10px] font-bold text-slate-400 mt-1">DEFERRED • {item.reason}</p>
              </div>
              <div className="mt-8">
                <button
                  type="button"
                  disabled
                  className="w-full bg-slate-200 text-slate-500 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest cursor-not-allowed"
                >
                  Coming Soon
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Invoice compliance check */}
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => setShowInvoiceCheck((v) => !v)}
          className="text-sm font-black text-slate-400 uppercase tracking-[0.2em] hover:text-indigo-600 transition-colors flex items-center gap-2"
        >
          {showInvoiceCheck ? '▼' : '▶'} Check invoice compliance (AI)
        </button>
        {showInvoiceCheck && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <p className="text-xs text-slate-500">Paste invoice or receipt text to check cross-border compliance (GST, export, OIDAR).</p>
            <textarea
              value={invoiceText}
              onChange={(e) => { setInvoiceText(e.target.value); setInvoiceResult(null); }}
              placeholder="Paste invoice text here..."
              rows={4}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <button
              type="button"
              disabled={invoiceLoading || !invoiceText.trim()}
              onClick={async () => {
                setInvoiceLoading(true);
                setInvoiceResult(null);
                try {
                  const res = await analyzeInvoiceWithFallback(invoiceText.trim());
                  setInvoiceResult(res && typeof res === 'object' ? res : { suggestedRemedy: String(res) });
                } catch {
                  setInvoiceResult({ suggestedRemedy: 'Analysis failed. Please try again.', provider: 'heuristic' });
                } finally {
                  setInvoiceLoading(false);
                }
              }}
              className="bg-slate-900 text-white px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {invoiceLoading ? 'Analyzing...' : 'Check compliance'}
            </button>
            {invoiceResult && (
              <div className={`p-4 rounded-xl border text-sm ${invoiceResult.isCompliant ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                <p className="font-bold uppercase text-[10px] mb-1">
                  {invoiceResult.isCompliant ? 'Compliant' : 'Review required'}
                  {invoiceResult.provider ? ` · via ${invoiceResult.provider}` : ''}
                </p>
                {invoiceResult.missingElements?.length ? (
                  <p className="text-xs mb-2"><strong>Missing:</strong> {invoiceResult.missingElements.join(', ')}</p>
                ) : null}
                {invoiceResult.suggestedRemedy && <p className="text-xs">{invoiceResult.suggestedRemedy}</p>}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Digital Vault Section */}
      <section className="space-y-6">
        <h3 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Digital Instrument Vault</h3>
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          {vault.length === 0 ? (
            <div className="p-20 text-center text-slate-400 italic text-xs font-medium">
              No instruments issued yet. Use the Admin Panel to generate letters.
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-8 py-4">Date</th>
                  <th className="px-8 py-4">Document Title</th>
                  <th className="px-8 py-4">Recipient</th>
                  <th className="px-8 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {vault.map(doc => (
                  <tr key={doc.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">{doc.date}</td>
                    <td className="px-8 py-5 font-black text-slate-900 uppercase text-xs">{doc.title}</td>
                    <td className="px-8 py-5 text-xs font-bold text-slate-500 uppercase">{doc.candidateName || 'N/A'}</td>
                    <td className="px-8 py-5 text-right">
                      <button onClick={() => downloadVaultDoc(doc)} className="text-[10px] font-black text-indigo-600 uppercase underline">Download Copy</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="bg-indigo-900 p-10 rounded-[2.5rem] text-white flex flex-col lg:flex-row gap-12 items-center relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -mr-48 -mt-48 animate-pulse"></div>
        <div className="flex-1 relative z-10">
          <h3 className="text-2xl font-black uppercase tracking-tighter mb-4">Final Tax Filing Prep (FY 2025-26)</h3>
          <p className="text-sm text-indigo-200 font-medium leading-relaxed max-w-xl">
            As of January 2026, your Suez Media LLP books are audit-ready. We've matched intercompany invoices, categorized OIDAR vs Export revenue, and synced all partner capital accounts. 
          </p>
          <div className="mt-8 flex gap-4">
             <div className="bg-white/10 px-4 py-2 rounded-xl border border-white/10">
                <p className="text-[10px] font-black text-indigo-300 uppercase">India Deadline</p>
                <p className="text-sm font-bold">Oct 31, 2026</p>
             </div>
             <div className="bg-white/10 px-4 py-2 rounded-xl border border-white/10">
                <p className="text-[10px] font-black text-indigo-300 uppercase">US Deadline</p>
                <p className="text-sm font-bold">Apr 15, 2026</p>
             </div>
          </div>
        </div>
        <button onClick={() => setShowInviteModal(true)} className="bg-emerald-500 text-white px-10 py-5 rounded-3xl font-black text-xs uppercase tracking-widest shadow-2xl hover:bg-emerald-400 hover:scale-105 transition-all active:scale-95">
          Invite Accountant →
        </button>
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Invite Accountant</h3>
              <button onClick={() => { setShowInviteModal(false); setInviteEmail(''); }} className="text-2xl text-slate-400 hover:text-slate-900">×</button>
            </div>
            <p className="text-sm text-slate-500">Creates a 72-hour read-only access link. Accountant can export filings but cannot modify records.</p>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="accountant@firm.com"
              className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm focus:ring-2 focus:ring-indigo-200"
            />
            {inviteLink && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Invite link</p>
                <p className="text-xs font-mono break-all text-slate-700">{inviteLink}</p>
              </div>
            )}
            <button onClick={() => void handleInviteAccountant()} disabled={inviteBusy}
              className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50">
              {inviteBusy ? 'Creating…' : 'Create 72h link & email'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComplianceHub;
