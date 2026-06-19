/**
 * US Tax Module – Form 1120 / 1065 computation, 1099 contractor tracking,
 * state tax scheduling. Covers the US parent entity's federal obligations.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  getUSTaxDrafts, addUSTaxDraft, getContractor1099s, addContractor1099,
} from '../services/storageService';
import type { USTaxDraft, Contractor1099 } from '../types';

type USTab = 'overview' | 'computation' | '1099';

const FEDERAL_RATES: Record<'1120' | '1065', { rate: number; label: string; note: string }> = {
  '1120': { rate: 0.21, label: 'C-Corp (Form 1120)', note: 'Flat 21% federal rate under TCJA 2017' },
  '1065': { rate: 0,    label: 'Partnership (Form 1065)', note: 'Pass-through entity; partners pay tax individually' },
};

const STATE_TAX_RATES: Record<string, number> = {
  Delaware: 0, Wyoming: 0, Nevada: 0, Florida: 5.5, Texas: 0,  // Delaware has no corporate income tax
  California: 8.84, 'New York': 6.5, Washington: 0, Colorado: 4.4, Arizona: 4.9,
};

function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function fmtUsd(n: number) {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CURRENT_YEAR = new Date().getFullYear();

const USTaxScreen: React.FC = () => {
  const [tab, setTab] = useState<USTab>('overview');
  const [drafts, setDrafts]           = useState<USTaxDraft[]>([]);
  const [contractors, setContractors] = useState<Contractor1099[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // Computation form
  const [showForm, setShowForm]       = useState(false);
  const [formType, setFormType]       = useState<'1120' | '1065'>('1120');
  const [taxYear, setTaxYear]         = useState(CURRENT_YEAR - 1);
  const [usRevenue, setUsRevenue]     = useState('');
  const [usExpenses, setUsExpenses]   = useState('');
  const [stateName, setStateName]     = useState('Delaware');

  // 1099 form
  const [show1099Form, setShow1099Form] = useState(false);
  const [c1099Name, setC1099Name]     = useState('');
  const [c1099Tin, setC1099Tin]       = useState('');
  const [c1099Address, setC1099Address] = useState('');
  const [c1099Amount, setC1099Amount] = useState('');
  const [c1099Year, setC1099Year]     = useState(CURRENT_YEAR - 1);
  const [c1099Type, setC1099Type]     = useState<'1099-NEC' | '1099-MISC'>('1099-NEC');

  const refresh = useCallback(() => {
    setDrafts(getUSTaxDrafts());
    setContractors(getContractor1099s());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, [refresh]);

  const revenue  = parseFloat(usRevenue) || 0;
  const expenses = parseFloat(usExpenses) || 0;
  const taxableIncome = Math.max(0, revenue - expenses);
  const federalInfo = FEDERAL_RATES[formType];
  const federalTax = formType === '1120' ? taxableIncome * federalInfo.rate : 0;
  const stateRate = STATE_TAX_RATES[stateName] ?? 0;
  const stateTax  = formType === '1120' ? taxableIncome * (stateRate / 100) : 0;
  const totalTax  = federalTax + stateTax;
  const effectiveRate = taxableIncome > 0 ? (totalTax / taxableIncome) * 100 : 0;

  const handleCreateDraft = () => {
    if (!usRevenue) return;
    const draft: USTaxDraft = {
      id: genId('ustax'),
      formType,
      taxYear,
      usRevenue: revenue,
      usExpenses: expenses,
      taxableIncome,
      federalRate: federalInfo.rate,
      federalTax,
      stateName,
      stateRate,
      stateTax,
      totalTax,
      createdAt: new Date().toISOString(),
    };
    addUSTaxDraft(draft);
    setUsRevenue(''); setUsExpenses('');
    setShowForm(false);
    refresh();
  };

  const handleAdd1099 = () => {
    const amount = parseFloat(c1099Amount);
    if (!c1099Name.trim() || !amount || amount <= 0) return;
    const c: Contractor1099 = {
      id: genId('1099'),
      contractorName: c1099Name.trim(),
      tin: c1099Tin.trim() || undefined,
      address: c1099Address.trim() || undefined,
      amount,
      taxYear: c1099Year,
      formType: c1099Type,
      createdAt: new Date().toISOString(),
    };
    addContractor1099(c);
    setC1099Name(''); setC1099Tin(''); setC1099Address('');
    setC1099Amount(''); setC1099Year(CURRENT_YEAR - 1); setC1099Type('1099-NEC');
    setShow1099Form(false);
    refresh();
  };

  const selectedDraft = drafts.find(d => d.id === selectedDraftId);
  const totalOwedByYear: Record<number, number> = drafts.reduce<Record<number, number>>((acc, d) => {
    acc[d.taxYear] = (acc[d.taxYear] ?? 0) + d.totalTax;
    return acc;
  }, {});

  const contractors1099Overdue = contractors.filter(c => c.amount >= 600 && !c.tin);
  const totalContractorPayments = contractors.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>🇺🇸 US Tax (Federal &amp; State)</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Form 1120 · Form 1065 · 1099-NEC / 1099-MISC · State filings
          </p>
        </div>
        <div className="flex gap-2">
          {tab === 'computation' && (
            <button type="button" onClick={() => setShowForm(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--us-600, #1e40af)' }}>
              {showForm ? '✕ Cancel' : '+ New Computation'}
            </button>
          )}
          {tab === '1099' && (
            <button type="button" onClick={() => setShow1099Form(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--us-600, #1e40af)' }}>
              {show1099Form ? '✕ Cancel' : '+ Add Contractor'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
        {(['overview', 'computation', '1099'] as USTab[]).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="font-heading px-4 py-2 rounded-lg text-sm font-semibold transition-all capitalize"
            style={tab === t ? { background: 'var(--us-600, #1e40af)', color: '#fff' } : { color: 'var(--text-secondary)' }}>
            {t === '1099' ? '1099 Tracking' : t === 'computation' ? 'Tax Computation' : 'Overview'}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tax Drafts</p>
              <p className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{drafts.length}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>computations created</p>
            </div>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Total Federal Tax</p>
              <p className="text-2xl font-bold font-mono" style={{ color: '#dc2626' }}>
                {fmtUsd(drafts.reduce((s, d) => s + d.federalTax, 0))}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>across all drafts</p>
            </div>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>1099 Contractors</p>
              <p className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{contractors.length}</p>
              <p className="text-xs mt-0.5" style={{ color: contractors1099Overdue.length > 0 ? '#dc2626' : 'var(--text-muted)' }}>
                {contractors1099Overdue.length > 0 ? `${contractors1099Overdue.length} missing TIN` : 'All TINs collected'}
              </p>
            </div>
            <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p className="text-xs font-heading font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Total 1099 Payments</p>
              <p className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{fmtUsd(totalContractorPayments)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>all years combined</p>
            </div>
          </div>

          {/* Filing obligations */}
          <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <h2 className="font-heading text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Key US Filing Deadlines</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { form: 'Form 1120',  due: 'April 15 (or Oct 15 ext.)', desc: 'US Corporation tax return' },
                { form: 'Form 1065',  due: 'March 15 (or Sep 15 ext.)', desc: 'Partnership return' },
                { form: 'Form 5472', due: 'April 15 with 1120',          desc: 'Foreign ownership reporting' },
                { form: '1099-NEC',  due: 'January 31',                   desc: 'Contractor payments ≥ $600' },
                { form: '1099-MISC', due: 'February 28 / March 31',       desc: 'Miscellaneous income' },
                { form: 'FBAR',      due: 'October 15',                   desc: 'Foreign bank accounts > $10K' },
              ].map(item => (
                <div key={item.form} className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-heading font-bold text-sm" style={{ color: 'var(--us-600, #1e40af)' }}>{item.form}</span>
                    <span className="text-xs font-semibold" style={{ color: '#d97706' }}>{item.due}</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tax by year summary */}
          {Object.keys(totalOwedByYear).length > 0 && (
            <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-base font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Tax Liability by Year</h2>
              <div className="space-y-2">
                {(Object.entries(totalOwedByYear) as [string, number][]).sort((a, b) => Number(b[0]) - Number(a[0])).map(([year, tax]) => (
                  <div key={year} className="flex justify-between items-center p-3 rounded-xl" style={{ background: 'var(--bg-page)' }}>
                    <span className="font-heading font-semibold" style={{ color: 'var(--text-primary)' }}>Tax Year {year}</span>
                    <span className="font-mono font-bold" style={{ color: '#dc2626' }}>{fmtUsd(tax)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info box */}
          <div className="rounded-2xl border p-4" style={{ borderColor: '#bfdbfe', background: '#eff6ff' }}>
            <p className="text-sm font-heading font-semibold mb-2" style={{ color: '#1e40af' }}>Transfer Pricing Note</p>
            <p className="text-xs" style={{ color: '#1d4ed8' }}>
              For cross-border transactions between the Indian LLP and US entity, ensure arm's-length pricing is documented
              per IRC §482 (US) and Indian TP rules. Intercompany service charges, royalties, and loans must be benchmarked
              annually. Keep contemporaneous documentation ready for Form 5471/5472 and Indian TP audit.
            </p>
          </div>
        </div>
      )}

      {/* COMPUTATION TAB */}
      {tab === 'computation' && (
        <div className="space-y-6">
          {showForm && (
            <div className="p-6 rounded-2xl border-2 space-y-5" style={{ borderColor: '#93c5fd', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-lg font-bold" style={{ color: 'var(--text-primary)' }}>New Tax Computation</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Form Type</label>
                  <select value={formType} onChange={e => setFormType(e.target.value as '1120' | '1065')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="1120">Form 1120 (C-Corp)</option>
                    <option value="1065">Form 1065 (Partnership)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Tax Year</label>
                  <input type="number" min={2020} max={CURRENT_YEAR} value={taxYear} onChange={e => setTaxYear(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>State of Incorporation</label>
                  <select value={stateName} onChange={e => setStateName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    {Object.keys(STATE_TAX_RATES).map(s => (
                      <option key={s} value={s}>{s} ({STATE_TAX_RATES[s]}%)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>US Revenue ($) *</label>
                  <input type="number" min={0} step={0.01} placeholder="0.00" value={usRevenue} onChange={e => setUsRevenue(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>US Expenses ($)</label>
                  <input type="number" min={0} step={0.01} placeholder="0.00" value={usExpenses} onChange={e => setUsExpenses(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              {/* Live calculation preview */}
              {revenue > 0 && (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#93c5fd' }}>
                  <div className="px-4 py-2 border-b" style={{ background: '#eff6ff', borderColor: '#93c5fd' }}>
                    <span className="text-xs font-heading font-semibold" style={{ color: '#1e40af' }}>
                      COMPUTATION PREVIEW · {federalInfo.label} · Tax Year {taxYear}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x" style={{ borderColor: 'var(--border-subtle)' }}>
                    {[
                      { label: 'Gross Revenue',     val: fmtUsd(revenue),          dim: false },
                      { label: 'Less: Expenses',    val: fmtUsd(expenses),          dim: true },
                      { label: 'Taxable Income',    val: fmtUsd(taxableIncome),     dim: false },
                      { label: 'Federal Tax (21%)', val: fmtUsd(federalTax),        dim: false },
                    ].map(item => (
                      <div key={item.label} className="p-4 text-center">
                        <p className="text-xs font-heading font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</p>
                        <p className="font-mono font-bold text-base" style={{ color: item.dim ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{item.val}</p>
                      </div>
                    ))}
                  </div>
                  {stateTax > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 border-t gap-0 divide-x" style={{ borderColor: 'var(--border-subtle)' }}>
                      <div className="p-4 text-center">
                        <p className="text-xs font-heading font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>State ({stateName})</p>
                        <p className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{stateRate}%</p>
                      </div>
                      <div className="p-4 text-center">
                        <p className="text-xs font-heading font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>State Tax</p>
                        <p className="font-mono font-bold" style={{ color: '#dc2626' }}>{fmtUsd(stateTax)}</p>
                      </div>
                      <div className="p-4 text-center border-t sm:border-t-0" style={{ borderColor: 'var(--border-subtle)' }}>
                        <p className="text-xs font-heading font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Total Tax</p>
                        <p className="font-mono font-bold text-lg" style={{ color: '#dc2626' }}>{fmtUsd(totalTax)}</p>
                      </div>
                    </div>
                  )}
                  <div className="px-4 py-2 border-t flex justify-between items-center" style={{ borderColor: '#93c5fd', background: '#eff6ff' }}>
                    <span className="text-xs" style={{ color: '#1d4ed8' }}>{federalInfo.note}</span>
                    <span className="text-xs font-semibold" style={{ color: '#1e40af' }}>Effective rate: {effectiveRate.toFixed(1)}%</span>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={handleCreateDraft} disabled={!usRevenue}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--us-600, #1e40af)' }}>
                  Save Draft
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ color: 'var(--text-secondary)', background: 'var(--bg-page)' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Drafts list */}
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-page)' }}>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Form</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Year</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Revenue</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Expenses</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Taxable Inc.</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Federal Tax</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>State Tax</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Total Tax</th>
                  <th className="py-3 px-4 w-8" />
                </tr>
              </thead>
              <tbody>
                {drafts.length === 0 ? (
                  <tr><td colSpan={9} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                    No tax computations. Create a new draft using the button above.
                  </td></tr>
                ) : drafts.map(d => (
                  <React.Fragment key={d.id}>
                    <tr className="border-t cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}
                      onClick={() => setSelectedDraftId(selectedDraftId === d.id ? null : d.id)}>
                      <td className="py-3 px-4">
                        <span className="font-heading font-bold text-xs px-2 py-0.5 rounded-lg" style={{ background: '#dbeafe', color: '#1e40af' }}>
                          {d.formType}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold" style={{ color: 'var(--text-primary)' }}>{d.taxYear}</td>
                      <td className="py-3 px-4 text-right font-mono text-sm hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>{fmtUsd(d.usRevenue)}</td>
                      <td className="py-3 px-4 text-right font-mono text-sm hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>{fmtUsd(d.usExpenses)}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{fmtUsd(d.taxableIncome)}</td>
                      <td className="py-3 px-4 text-right font-mono text-sm hidden lg:table-cell" style={{ color: '#dc2626' }}>{fmtUsd(d.federalTax)}</td>
                      <td className="py-3 px-4 text-right font-mono text-sm hidden lg:table-cell" style={{ color: '#dc2626' }}>{fmtUsd(d.stateTax ?? 0)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-sm" style={{ color: '#dc2626' }}>{fmtUsd(d.totalTax)}</td>
                      <td className="py-3 px-4 text-xs" style={{ color: 'var(--text-muted)' }}>{selectedDraftId === d.id ? '▲' : '▼'}</td>
                    </tr>
                    {selectedDraftId === d.id && (
                      <tr style={{ borderColor: 'var(--border-subtle)' }}>
                        <td colSpan={9} className="px-4 pb-4" style={{ background: 'var(--bg-page)' }}>
                          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div><p className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>FEDERAL RATE</p><p className="font-mono text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>{(d.federalRate * 100).toFixed(0)}%</p></div>
                            <div><p className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>STATE</p><p className="font-mono text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>{d.stateName ?? '—'} {d.stateRate ? `(${d.stateRate}%)` : ''}</p></div>
                            <div><p className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>EFFECTIVE RATE</p><p className="font-mono text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>{d.taxableIncome > 0 ? ((d.totalTax / d.taxableIncome) * 100).toFixed(1) : 0}%</p></div>
                            <div><p className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>CREATED</p><p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{d.createdAt.slice(0, 10)}</p></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 1099 TAB */}
      {tab === '1099' && (
        <div className="space-y-6">
          {contractors1099Overdue.length > 0 && (
            <div className="p-4 rounded-2xl border-2 flex items-start gap-3" style={{ borderColor: '#fbbf24', background: '#fffbeb' }}>
              <span className="text-lg">⚠️</span>
              <div>
                <p className="font-heading font-bold text-sm" style={{ color: '#b45309' }}>
                  {contractors1099Overdue.length} contractor{contractors1099Overdue.length > 1 ? 's' : ''} missing TIN
                </p>
                <p className="text-xs" style={{ color: '#d97706' }}>
                  Contractors paid ≥ $600 require a TIN (SSN / EIN) for 1099 filing. Collect Form W-9 before Jan 31.
                </p>
              </div>
            </div>
          )}

          {show1099Form && (
            <div className="p-6 rounded-2xl border-2 space-y-4" style={{ borderColor: '#93c5fd', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Add Contractor (1099)</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Contractor Name *</label>
                  <input type="text" placeholder="Full legal name" value={c1099Name} onChange={e => setC1099Name(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>TIN (SSN / EIN)</label>
                  <input type="text" placeholder="XXX-XX-XXXX or XX-XXXXXXX" value={c1099Tin} onChange={e => setC1099Tin(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm font-mono" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Address</label>
                  <input type="text" placeholder="Contractor address" value={c1099Address} onChange={e => setC1099Address(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Amount Paid ($) *</label>
                  <input type="number" min={0} step={0.01} placeholder="0.00" value={c1099Amount} onChange={e => setC1099Amount(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Tax Year</label>
                  <input type="number" min={2020} max={CURRENT_YEAR} value={c1099Year} onChange={e => setC1099Year(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Form Type</label>
                  <select value={c1099Type} onChange={e => setC1099Type(e.target.value as '1099-NEC' | '1099-MISC')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="1099-NEC">1099-NEC (Non-employee compensation)</option>
                    <option value="1099-MISC">1099-MISC (Miscellaneous income)</option>
                  </select>
                </div>
              </div>
              {c1099Amount && parseFloat(c1099Amount) >= 600 && !c1099Tin && (
                <p className="text-xs px-3 py-2 rounded-lg" style={{ background: '#fffbeb', color: '#b45309' }}>
                  ⚠️ This contractor will need a 1099 (payment ≥ $600). Please collect Form W-9 for TIN before January 31.
                </p>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={handleAdd1099} disabled={!c1099Name.trim() || !c1099Amount}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--us-600, #1e40af)' }}>
                  Save Contractor
                </button>
                <button type="button" onClick={() => setShow1099Form(false)}
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
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Contractor</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>TIN</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Form</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Year</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Amount</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {contractors.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                    No contractor payments recorded. Add contractors to track 1099 obligations.
                  </td></tr>
                ) : contractors.map(c => {
                  const needs1099 = c.amount >= 600;
                  const missingTin = needs1099 && !c.tin;
                  return (
                    <tr key={c.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="py-3 px-4">
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.contractorName}</div>
                        {c.address && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.address}</div>}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        {c.tin
                          ? <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{c.tin}</span>
                          : <span className="text-xs" style={{ color: missingTin ? '#dc2626' : 'var(--text-muted)' }}>
                              {missingTin ? '⚠️ W-9 required' : 'Not required'}
                            </span>
                        }
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-lg" style={{ background: '#dbeafe', color: '#1e40af' }}>
                          {c.formType}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs" style={{ color: 'var(--text-secondary)' }}>{c.taxYear}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {fmtUsd(c.amount)}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {needs1099
                          ? <span className="text-xs px-2 py-0.5 rounded-lg font-semibold" style={missingTin ? { background: '#fee2e2', color: '#dc2626' } : { background: '#dcfce7', color: '#16a34a' }}>
                              {missingTin ? '1099 required – TIN missing' : '1099 ready'}
                            </span>
                          : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Under $600 – no 1099</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 rounded-xl text-xs" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <p className="font-heading font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>1099 Filing Rules (IRS)</p>
            <p style={{ color: 'var(--text-muted)' }}>
              File 1099-NEC for non-employees paid ≥ $600 for services. File 1099-MISC for rents, royalties, and other
              miscellaneous income ≥ $600. Deadline: January 31 to contractor, February 28 (paper) / March 31 (e-file) to IRS.
              Backup withholding (24%) applies if contractor fails to furnish TIN.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default USTaxScreen;
