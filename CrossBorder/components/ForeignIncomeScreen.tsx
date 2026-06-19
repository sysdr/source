import React, { useState, useEffect, useCallback } from 'react';
import {
  getForeignIncomeRecords, getWithholdingPayments, getTaxTreaties,
  addWithholdingPayment, addForeignIncomeRecord, addTaxTreaty,
  getRemittanceRecords, addRemittanceRecord,
} from '../services/storageService';
import { getForeignIncomeByPeriod, getOIDARSummary, getExportRevenueSummary } from '../services/foreignIncomeService';
import { generateForeignIncomeScheduleCSV } from '../services/statutoryReports';
import type { ForeignIncomeType, WithholdingPayment, ForeignIncomeRecord, TaxTreaty, RemittanceRecord, RemittanceDirection, RemittancePurpose } from '../types';
import { RevenueCategory } from '../types';

type FITab = 'records' | 'wht' | 'treaties' | 'remittances';

const INCOME_TYPES: { value: ForeignIncomeType; label: string }[] = [
  { value: 'export_of_services',         label: 'Export of Services' },
  { value: 'export_of_goods',            label: 'Export of Goods' },
  { value: 'oidar',                      label: 'OIDAR (Online Services)' },
  { value: 'royalty',                    label: 'Royalty' },
  { value: 'interest',                   label: 'Interest' },
  { value: 'fees_for_technical_services', label: 'Fees for Technical Services' },
  { value: 'other',                      label: 'Other' },
];

const CLASSIFICATION_MAP: Record<ForeignIncomeType, RevenueCategory> = {
  export_of_services:         RevenueCategory.EXPORT,
  export_of_goods:            RevenueCategory.EXPORT,
  oidar:                      RevenueCategory.OIDAR_RISK,
  royalty:                    RevenueCategory.EXPORT,
  interest:                   RevenueCategory.EXPORT,
  fees_for_technical_services: RevenueCategory.EXPORT,
  other:                      RevenueCategory.EXPORT,
};

const WHT_SECTIONS = [
  { value: '195', label: '195 – Non-resident (default)' },
  { value: '194E', label: '194E – Non-resident sportsmen' },
  { value: '115A', label: '115A – Royalty / FTS' },
];

function fmtAmt(n: number, cur = 'INR') {
  const sym = cur === 'USD' ? '$' : '₹';
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const ForeignIncomeScreen: React.FC = () => {
  const [tab, setTab] = useState<FITab>('records');
  const [records, setRecords] = useState<ForeignIncomeRecord[]>([]);
  const [wht, setWht]         = useState<WithholdingPayment[]>([]);
  const [treaties, setTreaties] = useState<TaxTreaty[]>([]);
  const [remittances, setRemittances] = useState<RemittanceRecord[]>([]);

  // Remittance form state
  const [showRemForm, setShowRemForm] = useState(false);
  const [remDate, setRemDate]         = useState(() => new Date().toISOString().slice(0, 10));
  const [remDirection, setRemDirection] = useState<RemittanceDirection>('Inward');
  const [remAmount, setRemAmount]     = useState('');
  const [remCurrency, setRemCurrency] = useState('USD');
  const [remPurpose, setRemPurpose]   = useState<RemittancePurpose>('Export');
  const [remRef, setRemRef]           = useState('');
  const [remSoftEx, setRemSoftEx]     = useState('');
  const [remFIRC, setRemFIRC]         = useState('');
  const [remForm15CA, setRemForm15CA] = useState('');
  const [remForm15CB, setRemForm15CB] = useState('');
  const [periodStart, setPeriodStart] = useState(() => `${new Date().getFullYear() - 1}-04-01`);
  const [periodEnd, setPeriodEnd]     = useState(() => new Date().toISOString().slice(0, 10));
  const [expandedWht, setExpandedWht] = useState<string | null>(null);

  // Foreign income record form
  const [showFIForm, setShowFIForm] = useState(false);
  const [fiDate, setFiDate]         = useState(() => new Date().toISOString().slice(0, 10));
  const [fiDesc, setFiDesc]         = useState('');
  const [fiAmount, setFiAmount]     = useState('');
  const [fiCurrency, setFiCurrency] = useState('USD');
  const [fiCountry, setFiCountry]   = useState('US');
  const [fiType, setFiType]         = useState<ForeignIncomeType>('export_of_services');
  const [fiSourcing, setFiSourcing] = useState<'IN' | 'US'>('IN');

  // WHT form
  const [showWHTForm, setShowWHTForm] = useState(false);
  const [whtDate, setWhtDate]         = useState(() => new Date().toISOString().slice(0, 10));
  const [whtPayeeName, setWhtPayeeName] = useState('');
  const [whtPayeeCountry, setWhtPayeeCountry] = useState('US');
  const [whtAmount, setWhtAmount]     = useState('');
  const [whtCurrency, setWhtCurrency] = useState<'USD' | 'INR'>('USD');
  const [whtSection, setWhtSection]   = useState('195');
  const [whtRate, setWhtRate]         = useState(20);
  const [whtTrcRef, setWhtTrcRef]     = useState('');
  const [whtTreatyUsed, setWhtTreatyUsed] = useState('');
  const [whtDepositDate, setWhtDepositDate] = useState('');
  const [whtCertNumber, setWhtCertNumber]   = useState('');
  const [whtQuarter, setWhtQuarter]   = useState('');
  const [whtFY, setWhtFY]             = useState('');

  // Treaty form
  const [showTreatyForm, setShowTreatyForm] = useState(false);
  const [tCountryCode, setTCountryCode]   = useState('');
  const [tCountryName, setTCountryName]   = useState('');
  const [tArticle, setTArticle]           = useState('');
  const [tDesc, setTDesc]                 = useState('');
  const [tRate, setTRate]                 = useState(10);
  const [tEffFrom, setTEffFrom]           = useState(() => new Date().toISOString().slice(0, 10));

  const refresh = useCallback(() => {
    setRecords(getForeignIncomeRecords());
    setWht(getWithholdingPayments());
    setTreaties(getTaxTreaties());
    setRemittances(getRemittanceRecords());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, [refresh]);

  const summary = getForeignIncomeByPeriod(periodStart, periodEnd);
  const oidar   = getOIDARSummary(periodStart.slice(0, 7));
  const exportRev = getExportRevenueSummary(periodStart.slice(0, 7));
  const totalWht = wht.reduce((s, w) => s + w.withheldAmount, 0);

  const handleAddFI = () => {
    const amt = parseFloat(fiAmount);
    if (!fiDesc.trim() || !amt || amt <= 0) return;
    const record: ForeignIncomeRecord = {
      id: genId('fir'),
      date: fiDate,
      description: fiDesc.trim(),
      amount: amt,
      currency: fiCurrency,
      customerCountry: fiCountry.trim().toUpperCase(),
      incomeType: fiType,
      classification: CLASSIFICATION_MAP[fiType],
      sourcingCountry: fiSourcing,
      createdAt: new Date().toISOString(),
    };
    addForeignIncomeRecord(record);
    setFiDate(new Date().toISOString().slice(0, 10));
    setFiDesc(''); setFiAmount(''); setFiCurrency('USD'); setFiCountry('US');
    setFiType('export_of_services'); setFiSourcing('IN');
    setShowFIForm(false);
    refresh();
  };

  const handleAddWHT = () => {
    const amt = parseFloat(whtAmount);
    if (!whtPayeeName.trim() || !amt || amt <= 0) return;
    const withheld = amt * (whtRate / 100);
    const payment: WithholdingPayment = {
      id: genId('wht'),
      date: whtDate,
      payeeId: genId('payee'),
      payeeName: whtPayeeName.trim(),
      payeeCountry: whtPayeeCountry.trim().toUpperCase(),
      amount: amt,
      currency: whtCurrency,
      section: whtSection,
      rate: whtRate,
      withheldAmount: withheld,
      trcReference: whtTrcRef.trim() || undefined,
      treatyUsed: whtTreatyUsed.trim() || undefined,
      depositDate: whtDepositDate || undefined,
      certificateNumber: whtCertNumber.trim() || undefined,
      quarter: whtQuarter.trim() || undefined,
      financialYear: whtFY.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    addWithholdingPayment(payment);
    setWhtDate(new Date().toISOString().slice(0, 10));
    setWhtPayeeName(''); setWhtPayeeCountry('US'); setWhtAmount('');
    setWhtCurrency('USD'); setWhtSection('195'); setWhtRate(20);
    setWhtTrcRef(''); setWhtTreatyUsed(''); setWhtDepositDate('');
    setWhtCertNumber(''); setWhtQuarter(''); setWhtFY('');
    setShowWHTForm(false);
    refresh();
  };

  const handleAddTreaty = () => {
    if (!tCountryCode.trim() || !tArticle.trim()) return;
    const treaty: TaxTreaty = {
      id: genId('treaty'),
      countryCode: tCountryCode.trim().toUpperCase(),
      countryName: tCountryName.trim(),
      article: tArticle.trim(),
      description: tDesc.trim(),
      rate: tRate,
      effectiveFrom: tEffFrom,
    };
    addTaxTreaty(treaty);
    setTCountryCode(''); setTCountryName(''); setTArticle('');
    setTDesc(''); setTRate(10); setTEffFrom(new Date().toISOString().slice(0, 10));
    setShowTreatyForm(false);
    refresh();
  };

  const handleAddRemittance = () => {
    const amt = parseFloat(remAmount);
    if (!amt || amt <= 0 || !remDate) return;
    const record: RemittanceRecord = {
      id: genId('rem'),
      direction: remDirection,
      date: remDate,
      amount: amt,
      currency: remCurrency,
      purpose: remPurpose,
      reference: remRef.trim() || undefined,
      softExNumber: remSoftEx.trim() || undefined,
      documentIds: [remFIRC, remForm15CA, remForm15CB].filter(Boolean),
      createdAt: new Date().toISOString(),
    };
    addRemittanceRecord(record);
    setRemAmount(''); setRemRef(''); setRemSoftEx('');
    setRemFIRC(''); setRemForm15CA(''); setRemForm15CB('');
    setRemDate(new Date().toISOString().slice(0, 10));
    setShowRemForm(false);
    refresh();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Foreign Income & WHT</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>FEMA · DTAA · Withholding Tax · OIDAR</p>
        </div>
        <div className="flex gap-2">
          {tab === 'records' && (
            <button type="button" onClick={() => setShowFIForm(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
              {showFIForm ? '✕ Cancel' : '+ Record Income'}
            </button>
          )}
          {tab === 'wht' && (
            <button type="button" onClick={() => setShowWHTForm(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
              {showWHTForm ? '✕ Cancel' : '+ Record WHT'}
            </button>
          )}
          {tab === 'treaties' && (
            <button type="button" onClick={() => setShowTreatyForm(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
              {showTreatyForm ? '✕ Cancel' : '+ Add Treaty'}
            </button>
          )}
          {tab === 'remittances' && (
            <button type="button" onClick={() => setShowRemForm(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
              {showRemForm ? '✕ Cancel' : '+ Record Remittance'}
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Foreign Income (Period)</p>
          <p className="text-xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{fmtAmt(summary.total)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{records.length} records</p>
        </div>
        <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Export Revenue</p>
          <p className="text-xl font-bold font-mono" style={{ color: '#16a34a' }}>{fmtAmt(exportRev)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>GST 0% (LUT/Bond)</p>
        </div>
        <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>OIDAR GST Liability</p>
          <p className="text-xl font-bold font-mono" style={{ color: oidar.gstLiability > 0 ? '#dc2626' : 'var(--text-primary)' }}>
            {fmtAmt(oidar.gstLiability)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>18% on {fmtAmt(oidar.totalOIDAR)}</p>
        </div>
        <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Total WHT Withheld</p>
          <p className="text-xl font-bold font-mono" style={{ color: '#d97706' }}>{fmtAmt(totalWht)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{wht.length} records · {treaties.length} treaties</p>
        </div>
      </div>

      {/* Period filter + Export */}
      <div className="flex flex-wrap gap-3 items-center p-4 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
        <span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>PERIOD</span>
        <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>to</span>
        <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
        <button type="button" onClick={() => generateForeignIncomeScheduleCSV(periodStart, periodEnd)}
          className="font-heading px-4 py-2 rounded-xl text-sm font-semibold text-white ml-auto" style={{ background: 'var(--bg-sidebar)' }}>
          Export Schedule (CSV)
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
        {(['records', 'wht', 'treaties', 'remittances'] as FITab[]).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="font-heading px-4 py-2 rounded-lg text-sm font-semibold transition-all capitalize"
            style={tab === t ? { background: 'var(--bg-sidebar)', color: '#fff' } : { color: 'var(--text-secondary)' }}>
            {t === 'wht' ? 'Withholding Tax' : t === 'treaties' ? 'DTAA Treaties' : t === 'remittances' ? 'FEMA Remittances' : 'Income Records'}
          </button>
        ))}
      </div>

      {/* FOREIGN INCOME RECORDS */}
      {tab === 'records' && (
        <>
          {showFIForm && (
            <div className="p-6 rounded-2xl border-2 space-y-4" style={{ borderColor: 'var(--brand-400)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Record Foreign Income</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Date</label>
                  <input type="date" value={fiDate} onChange={e => setFiDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Description *</label>
                  <input type="text" placeholder="e.g. Software export to US client" value={fiDesc} onChange={e => setFiDesc(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Amount *</label>
                  <input type="number" min={0} step={0.01} placeholder="0.00" value={fiAmount} onChange={e => setFiAmount(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Currency</label>
                  <input type="text" placeholder="USD, EUR, GBP..." value={fiCurrency} onChange={e => setFiCurrency(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm uppercase" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Customer Country</label>
                  <input type="text" placeholder="US, GB, DE..." value={fiCountry} onChange={e => setFiCountry(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm uppercase" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Income Type</label>
                  <select value={fiType} onChange={e => setFiType(e.target.value as ForeignIncomeType)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    {INCOME_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Sourcing Country</label>
                  <select value={fiSourcing} onChange={e => setFiSourcing(e.target.value as 'IN' | 'US')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="IN">India (IN)</option>
                    <option value="US">USA (US)</option>
                  </select>
                </div>
              </div>
              <div className="p-3 rounded-xl text-xs" style={{ background: 'var(--bg-page)', color: 'var(--text-muted)' }}>
                <strong>Classification:</strong> {CLASSIFICATION_MAP[fiType]} ·
                <strong> GST:</strong> {fiType === 'oidar' ? '18% OIDAR liability' : '0% (Export)'}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={handleAddFI} disabled={!fiDesc.trim() || !fiAmount}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--bg-sidebar)' }}>
                  Save Record
                </button>
                <button type="button" onClick={() => setShowFIForm(false)}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ color: 'var(--text-secondary)', background: 'var(--bg-page)' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Summary by type */}
          {Object.keys(summary.byType).length > 0 && (
            <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Income by Type (Period)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {Object.entries(summary.byType).map(([type, amt]) => (
                  <div key={type} className="p-3 rounded-xl" style={{ background: 'var(--bg-page)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{type.replace(/_/g, ' ')}</p>
                    <p className="font-mono font-semibold text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>{fmtAmt(amt)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-page)' }}>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Description</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Country</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Type</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Class.</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No foreign income records. Record income from the button above.</td></tr>
                ) : records.slice(0, 50).map(r => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="py-3 px-4 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.date}</td>
                    <td className="py-3 px-4 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {r.description}
                      {r.transactionId && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>(linked tx)</span>}
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-lg font-semibold" style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)' }}>{r.customerCountry}</span>
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {r.incomeType.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-lg" style={
                        r.classification === RevenueCategory.OIDAR_RISK
                          ? { background: '#fee2e2', color: '#dc2626' }
                          : { background: '#dcfce7', color: '#16a34a' }
                      }>{r.classification === RevenueCategory.OIDAR_RISK ? 'OIDAR Risk' : 'Export'}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {r.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} {r.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* WHT TAB */}
      {tab === 'wht' && (
        <>
          {showWHTForm && (
            <div className="p-6 rounded-2xl border-2 space-y-4" style={{ borderColor: 'var(--india-500)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Record WHT Payment</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Payment Date</label>
                  <input type="date" value={whtDate} onChange={e => setWhtDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Payee Name *</label>
                  <input type="text" placeholder="Vendor / contractor name" value={whtPayeeName} onChange={e => setWhtPayeeName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Payee Country</label>
                  <input type="text" placeholder="US, GB..." value={whtPayeeCountry} onChange={e => setWhtPayeeCountry(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm uppercase" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Gross Amount *</label>
                  <input type="number" min={0} step={0.01} placeholder="0.00" value={whtAmount} onChange={e => setWhtAmount(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Currency</label>
                  <select value={whtCurrency} onChange={e => setWhtCurrency(e.target.value as 'USD' | 'INR')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="USD">USD</option>
                    <option value="INR">INR</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Section</label>
                  <select value={whtSection} onChange={e => setWhtSection(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    {WHT_SECTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>WHT Rate (%)</label>
                  <input type="number" min={0} max={100} step={0.5} value={whtRate} onChange={e => setWhtRate(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>TRC Reference</label>
                  <input type="text" placeholder="Tax Residency Certificate #" value={whtTrcRef} onChange={e => setWhtTrcRef(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Treaty Used</label>
                  <select value={whtTreatyUsed} onChange={e => setWhtTreatyUsed(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="">None</option>
                    {treaties.map(t => <option key={t.id} value={t.id}>{t.countryName} – Art. {t.article} ({t.rate}%)</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Challan Deposit Date</label>
                  <input type="date" value={whtDepositDate} onChange={e => setWhtDepositDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Certificate Number</label>
                  <input type="text" placeholder="Form 15CA/CB ref." value={whtCertNumber} onChange={e => setWhtCertNumber(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Quarter (e.g. Q1)</label>
                  <input type="text" placeholder="Q1, Q2, Q3, Q4" value={whtQuarter} onChange={e => setWhtQuarter(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Financial Year</label>
                  <input type="text" placeholder="2024-25" value={whtFY} onChange={e => setWhtFY(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              {whtAmount && parseFloat(whtAmount) > 0 && (
                <div className="p-3 rounded-xl grid grid-cols-3 gap-4" style={{ background: 'var(--bg-page)' }}>
                  <div>
                    <p className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>GROSS PAYMENT</p>
                    <p className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{fmtAmt(parseFloat(whtAmount), whtCurrency)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>WHT @ {whtRate}%</p>
                    <p className="font-mono font-bold" style={{ color: '#dc2626' }}>{fmtAmt(parseFloat(whtAmount) * (whtRate / 100), whtCurrency)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>NET TO PAYEE</p>
                    <p className="font-mono font-bold" style={{ color: '#16a34a' }}>{fmtAmt(parseFloat(whtAmount) * (1 - whtRate / 100), whtCurrency)}</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={handleAddWHT} disabled={!whtPayeeName.trim() || !whtAmount}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--bg-sidebar)' }}>
                  Save WHT Record
                </button>
                <button type="button" onClick={() => setShowWHTForm(false)}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ color: 'var(--text-secondary)', background: 'var(--bg-page)' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-page)' }}>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Payee</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Section</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Rate</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Gross</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Withheld</th>
                  <th className="py-3 px-4 w-8" />
                </tr>
              </thead>
              <tbody>
                {wht.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No WHT payments recorded.</td></tr>
                ) : wht.map(w => (
                  <React.Fragment key={w.id}>
                    <tr className="border-t cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}
                      onClick={() => setExpandedWht(expandedWht === w.id ? null : w.id)}>
                      <td className="py-3 px-4 text-xs" style={{ color: 'var(--text-secondary)' }}>{w.date}</td>
                      <td className="py-3 px-4">
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{w.payeeName}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{w.payeeCountry}</div>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{w.section}</td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs" style={{ color: 'var(--text-secondary)' }}>{w.rate}%</td>
                      <td className="py-3 px-4 text-right font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{fmtAmt(w.amount, w.currency)}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-sm" style={{ color: '#dc2626' }}>{fmtAmt(w.withheldAmount, w.currency)}</td>
                      <td className="py-3 px-4 text-xs" style={{ color: 'var(--text-muted)' }}>{expandedWht === w.id ? '▲' : '▼'}</td>
                    </tr>
                    {expandedWht === w.id && (
                      <tr style={{ borderColor: 'var(--border-subtle)' }}>
                        <td colSpan={7} className="px-4 pb-4" style={{ background: 'var(--bg-page)' }}>
                          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            {w.trcReference && <div><strong style={{ color: 'var(--text-muted)' }}>TRC Ref:</strong> <span style={{ color: 'var(--text-secondary)' }}>{w.trcReference}</span></div>}
                            {w.certificateNumber && <div><strong style={{ color: 'var(--text-muted)' }}>Cert #:</strong> <span style={{ color: 'var(--text-secondary)' }}>{w.certificateNumber}</span></div>}
                            {w.depositDate && <div><strong style={{ color: 'var(--text-muted)' }}>Challan Date:</strong> <span style={{ color: 'var(--text-secondary)' }}>{w.depositDate}</span></div>}
                            {w.quarter && <div><strong style={{ color: 'var(--text-muted)' }}>Quarter:</strong> <span style={{ color: 'var(--text-secondary)' }}>{w.quarter} {w.financialYear}</span></div>}
                            {w.treatyUsed && <div><strong style={{ color: 'var(--text-muted)' }}>Treaty:</strong> <span style={{ color: 'var(--text-secondary)' }}>{treaties.find(t => t.id === w.treatyUsed)?.countryName ?? w.treatyUsed}</span></div>}
                            <div><strong style={{ color: 'var(--text-muted)' }}>Net to Payee:</strong> <span className="font-mono text-green-600">{fmtAmt(w.amount - w.withheldAmount, w.currency)}</span></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* TREATIES TAB */}
      {tab === 'treaties' && (
        <>
          {showTreatyForm && (
            <div className="p-6 rounded-2xl border-2 space-y-4" style={{ borderColor: 'var(--us-500)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Add Tax Treaty (DTAA)</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Country Code *</label>
                  <input type="text" placeholder="US, GB, SG..." value={tCountryCode} onChange={e => setTCountryCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm uppercase" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Country Name</label>
                  <input type="text" placeholder="United States" value={tCountryName} onChange={e => setTCountryName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Article *</label>
                  <input type="text" placeholder="e.g. Art. 12(2)" value={tArticle} onChange={e => setTArticle(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
                  <input type="text" placeholder="e.g. Royalties and fees for technical services" value={tDesc} onChange={e => setTDesc(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Treaty Rate (%)</label>
                  <input type="number" min={0} max={100} step={0.5} value={tRate} onChange={e => setTRate(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Effective From</label>
                  <input type="date" value={tEffFrom} onChange={e => setTEffFrom(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={handleAddTreaty} disabled={!tCountryCode.trim() || !tArticle.trim()}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--bg-sidebar)' }}>
                  Save Treaty
                </button>
                <button type="button" onClick={() => setShowTreatyForm(false)}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ color: 'var(--text-secondary)', background: 'var(--bg-page)' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-page)' }}>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Country</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Article</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Description</th>
                  <th className="text-center py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Treaty Rate</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Effective From</th>
                </tr>
              </thead>
              <tbody>
                {treaties.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No treaties configured. Add DTAA treaty rates to apply lower WHT rates.</td></tr>
                ) : treaties.map(t => (
                  <tr key={t.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="py-3 px-4">
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t.countryName || t.countryCode}</div>
                      <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{t.countryCode}</div>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{t.article}</td>
                    <td className="py-3 px-4 text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>{t.description}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-sm font-bold font-mono px-2 py-0.5 rounded-lg" style={{ background: '#e0f2fe', color: '#0369a1' }}>{t.rate}%</span>
                    </td>
                    <td className="py-3 px-4 text-xs hidden lg:table-cell" style={{ color: 'var(--text-muted)' }}>{t.effectiveFrom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── FEMA REMITTANCES TAB ── */}
      {tab === 'remittances' && (
        <>
          {/* Info strip */}
          <div className="p-4 rounded-2xl border" style={{ borderColor: '#bfdbfe', background: '#eff6ff' }}>
            <p className="text-sm font-semibold" style={{ color: '#1d4ed8' }}>FEMA Compliance — Inward & Outward Remittances</p>
            <p className="text-xs mt-1" style={{ color: '#3b82f6' }}>
              Record all inward (FIRC) and outward remittances for FEMA/RBI reporting. Attach SoftEx numbers for software exports, Form 15CA/15CB references for outward remittances, and FIRC numbers for inward receipts.
            </p>
          </div>

          {/* Summary chips */}
          <div className="flex gap-3 flex-wrap">
            <div className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: '#d1fae5', color: '#065f46' }}>
              Inward: {remittances.filter(r => r.direction === 'Inward').length} remittances · {remittances.filter(r => r.direction === 'Inward').reduce((s, r) => s + r.amount, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} USD
            </div>
            <div className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: '#fee2e2', color: '#991b1b' }}>
              Outward: {remittances.filter(r => r.direction === 'Outward').length} remittances · {remittances.filter(r => r.direction === 'Outward').reduce((s, r) => s + r.amount, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} USD
            </div>
          </div>

          {/* Add remittance form */}
          {showRemForm && (
            <div className="p-5 rounded-2xl border-2 space-y-4" style={{ borderColor: 'var(--brand-400)', background: 'var(--bg-elevated)' }}>
              <h3 className="font-heading font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Record Remittance</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Date</label>
                  <input className="form-input w-full" type="date" value={remDate} onChange={e => setRemDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Direction</label>
                  <select className="form-input w-full" value={remDirection} onChange={e => setRemDirection(e.target.value as RemittanceDirection)}>
                    <option value="Inward">Inward (received in India)</option>
                    <option value="Outward">Outward (sent from India)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Purpose</label>
                  <select className="form-input w-full" value={remPurpose} onChange={e => setRemPurpose(e.target.value as RemittancePurpose)}>
                    <option value="Export">Export of Services</option>
                    <option value="Software">Software / IT Services</option>
                    <option value="Royalty">Royalty / IP</option>
                    <option value="TransferPricing">Transfer Pricing Fee</option>
                    <option value="Dividend">Dividend Repatriation</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Amount</label>
                  <input className="form-input w-full" type="number" min="0" step="0.01" value={remAmount} onChange={e => setRemAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Currency</label>
                  <select className="form-input w-full" value={remCurrency} onChange={e => setRemCurrency(e.target.value)}>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="INR">INR</option>
                    <option value="SGD">SGD</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Bank Reference / UTR</label>
                  <input className="form-input w-full" value={remRef} onChange={e => setRemRef(e.target.value)} placeholder="UTR / Bank Ref No." />
                </div>
              </div>
              {/* FEMA-specific fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: '#0369a1' }}>
                    {remDirection === 'Inward' ? 'FIRC Number (Foreign Inward Remittance Certificate)' : 'Form 15CA Acknowledgement No.'}
                  </label>
                  <input className="form-input w-full" value={remFIRC} onChange={e => setRemFIRC(e.target.value)}
                    placeholder={remDirection === 'Inward' ? 'FIRC-XXXXXXXXXX' : '15CA-XXXXXXX'} />
                </div>
                {remDirection === 'Outward' && (
                  <div>
                    <label className="text-xs font-semibold block mb-1" style={{ color: '#0369a1' }}>Form 15CB CA Certificate No.</label>
                    <input className="form-input w-full" value={remForm15CB} onChange={e => setRemForm15CB(e.target.value)} placeholder="15CB-XXXXXXX" />
                  </div>
                )}
                {(remPurpose === 'Software' || remPurpose === 'Export') && (
                  <div>
                    <label className="text-xs font-semibold block mb-1" style={{ color: '#0369a1' }}>SoftEx / STPI Form No.</label>
                    <input className="form-input w-full" value={remSoftEx} onChange={e => setRemSoftEx(e.target.value)} placeholder="SoftEx XXXXX" />
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleAddRemittance}
                  className="font-heading px-5 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
                  Save Remittance
                </button>
                <button type="button" onClick={() => setShowRemForm(false)}
                  className="font-heading px-5 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Remittances table */}
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-page)' }}>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Direction</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Purpose</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Amount</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>References</th>
                </tr>
              </thead>
              <tbody>
                {remittances.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                      No remittances recorded. Click "+ Record Remittance" to log inward FIRC receipts or outward 15CA/15CB payments.
                    </td>
                  </tr>
                ) : [...remittances].sort((a, b) => b.date.localeCompare(a.date)).map(r => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="py-3 px-4 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{r.date}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-lg text-xs font-bold"
                        style={{ background: r.direction === 'Inward' ? '#d1fae5' : '#fee2e2', color: r.direction === 'Inward' ? '#065f46' : '#991b1b' }}>
                        {r.direction === 'Inward' ? '↓ Inward' : '↑ Outward'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm" style={{ color: 'var(--text-primary)' }}>{r.purpose}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold" style={{ color: r.direction === 'Inward' ? '#059669' : '#dc2626' }}>
                      {r.direction === 'Inward' ? '+' : '-'}{r.currency} {r.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-xs hidden md:table-cell space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                      {r.reference && <div>UTR: <span className="font-mono">{r.reference}</span></div>}
                      {r.softExNumber && <div className="text-blue-600 font-mono">SoftEx: {r.softExNumber}</div>}
                      {r.documentIds?.filter(Boolean).map((d, i) => <div key={i} className="font-mono">{d}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default ForeignIncomeScreen;
