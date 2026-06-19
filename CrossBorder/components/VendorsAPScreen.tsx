import React, { useState, useEffect, useCallback } from 'react';
import { getVendors, getBills, getPaymentRuns, updateVendor } from '../services/storageService';
import { createVendor, createBill, createPaymentRun, processPaymentRun, getUnpaidBills, getBillsByVendor } from '../services/apService';
import type { Vendor, Bill, PaymentRun } from '../types';

type APTab = 'vendors' | 'bills' | 'payment-runs';

const TDS_SECTIONS = [
  { value: '194Q', label: '194Q – Purchase of goods (1%)' },
  { value: '194A', label: '194A – Interest (10%)' },
  { value: '194J', label: '194J – Professional/Technical (10%)' },
  { value: '194T', label: '194T – Partners (10%)' },
  { value: '195',  label: '195 – Non-resident (20%)' },
];

const BILL_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Draft:         { bg: 'var(--bg-page)',    color: 'var(--text-muted)' },
  Pending:       { bg: '#fef9c3',           color: '#a16207' },
  PartiallyPaid: { bg: '#e0f2fe',           color: '#0369a1' },
  Paid:          { bg: '#dcfce7',           color: '#16a34a' },
  Overdue:       { bg: '#fee2e2',           color: '#dc2626' },
  Cancelled:     { bg: '#f3f4f6',           color: '#6b7280' },
};

interface BillLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  glAccountCode: string;
}

const EMPTY_LINE: BillLineInput = { description: '', quantity: 1, unitPrice: 0, gstRate: 0, glAccountCode: '' };

function fmtAmt(n: number, cur: string) {
  const sym = cur === 'INR' ? '₹' : '$';
  return `${sym}${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const VendorsAPScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<APTab>('vendors');
  const [vendors, setVendors]       = useState<Vendor[]>([]);
  const [bills, setBills]           = useState<Bill[]>([]);
  const [paymentRuns, setPaymentRuns] = useState<PaymentRun[]>([]);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [expandedBill, setExpandedBill]     = useState<string | null>(null);

  // Vendor form
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [vName, setVName]       = useState('');
  const [vEmail, setVEmail]     = useState('');
  const [vPhone, setVPhone]     = useState('');
  const [vAddress, setVAddress] = useState('');
  const [vCountry, setVCountry] = useState('IN');
  const [vGstin, setVGstin]     = useState('');
  const [vPan, setVPan]         = useState('');
  const [vNonResident, setVNonResident] = useState(false);
  const [vBankAccount, setVBankAccount] = useState('');
  const [vBankIfsc, setVBankIfsc]       = useState('');
  const [vBankName, setVBankName]       = useState('');

  // Bill form
  const [showBillForm, setShowBillForm] = useState(false);
  const [bVendorId, setBVendorId]       = useState('');
  const [bDate, setBDate]               = useState(() => new Date().toISOString().slice(0, 10));
  const [bDueDays, setBDueDays]         = useState(30);
  const [bCurrency, setBCurrency]       = useState<'USD' | 'INR'>('INR');
  const [bEntity, setBEntity]           = useState<'parent' | 'subsidiary'>('subsidiary');
  const [bTdsSection, setBTdsSection]   = useState('194Q');
  const [bLines, setBLines]             = useState<BillLineInput[]>([{ ...EMPTY_LINE }]);

  // Payment run form
  const [showPRForm, setShowPRForm]     = useState(false);
  const [prVendorId, setPrVendorId]     = useState('');
  const [prDate, setPrDate]             = useState(() => new Date().toISOString().slice(0, 10));
  const [prCurrency, setPrCurrency]     = useState<'USD' | 'INR'>('INR');
  const [prSelectedBills, setPrSelectedBills] = useState<Set<string>>(new Set());
  const [prPaymentEntity, setPrPaymentEntity] = useState<'parent' | 'subsidiary'>('subsidiary');

  const refresh = useCallback(() => {
    setVendors(getVendors());
    setBills(getBills());
    setPaymentRuns(getPaymentRuns());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, [refresh]);

  // Vendor CRUD
  const handleAddVendor = () => {
    if (!vName.trim()) return;
    createVendor({
      name: vName.trim(), email: vEmail.trim() || undefined, phone: vPhone.trim() || undefined,
      address: vAddress.trim() || undefined, country: vCountry.trim() || 'IN',
      gstin: vGstin.trim() || undefined, pan: vPan.trim() || undefined,
      isNonResident: vNonResident,
      bankAccount: vBankAccount.trim() || undefined, bankIfsc: vBankIfsc.trim() || undefined,
      bankName: vBankName.trim() || undefined,
    });
    setVName(''); setVEmail(''); setVPhone(''); setVAddress(''); setVCountry('IN');
    setVGstin(''); setVPan(''); setVNonResident(false);
    setVBankAccount(''); setVBankIfsc(''); setVBankName('');
    setShowVendorForm(false);
    refresh();
  };

  const handleArchiveVendor = (v: Vendor) => {
    updateVendor(v.id, { archived: !v.archived });
    refresh();
  };

  // Bill CRUD
  const updateBillLine = (idx: number, field: keyof BillLineInput, val: string | number) => {
    setBLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l));
  };

  const handleCreateBill = () => {
    if (!bVendorId || bLines.every(l => l.unitPrice <= 0)) return;
    const tdsSectionInfo = TDS_SECTIONS.find(s => s.value === bTdsSection);
    createBill({
      vendorId: bVendorId,
      date: bDate,
      dueDays: bDueDays,
      currency: bCurrency,
      lines: bLines.filter(l => l.description.trim() || l.unitPrice > 0).map(l => ({
        description: l.description || 'Service',
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        gstRate: l.gstRate || undefined,
        glAccountCode: l.glAccountCode || undefined,
      })),
      entity: bEntity,
      tdsSection: bTdsSection,
    });
    setBVendorId(''); setBDate(new Date().toISOString().slice(0, 10));
    setBDueDays(30); setBCurrency('INR'); setBTdsSection('194Q');
    setBLines([{ ...EMPTY_LINE }]);
    setShowBillForm(false);
    refresh();
  };

  // Payment run
  const vendorUnpaidBills = prVendorId ? getBillsByVendor(prVendorId).filter(b => b.status === 'Pending' || b.status === 'Overdue') : [];

  const toggleBillSelect = (id: string) => {
    setPrSelectedBills(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedBillObjects = vendorUnpaidBills.filter(b => prSelectedBills.has(b.id));
  const prTotalGross = selectedBillObjects.reduce((s, b) => s + (b.netPayable ?? b.total), 0);
  const prTotalTds   = selectedBillObjects.reduce((s, b) => s + (b.tdsAmount ?? 0), 0);

  const handleCreatePR = () => {
    if (!prVendorId || prSelectedBills.size === 0) return;
    createPaymentRun({
      date: prDate,
      vendorId: prVendorId,
      currency: prCurrency,
      lines: selectedBillObjects.map(b => ({
        billId: b.id,
        amountPaid: b.netPayable ?? b.total,
        tdsDeducted: b.tdsAmount ?? 0,
      })),
    });
    setPrVendorId(''); setPrDate(new Date().toISOString().slice(0, 10));
    setPrCurrency('INR'); setPrSelectedBills(new Set());
    setShowPRForm(false);
    refresh();
  };

  const handleProcessPR = (id: string) => {
    processPaymentRun(id, prPaymentEntity);
    refresh();
  };

  const unpaid = getUnpaidBills();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Vendors & AP (P2P)</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Procure-to-Pay · {vendors.filter(v => !v.archived).length} vendors · {unpaid.length} unpaid bills
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'vendors' && (
            <button type="button" onClick={() => setShowVendorForm(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
              {showVendorForm ? '✕ Cancel' : '+ Add Vendor'}
            </button>
          )}
          {activeTab === 'bills' && (
            <button type="button" onClick={() => setShowBillForm(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
              {showBillForm ? '✕ Cancel' : '+ New Bill'}
            </button>
          )}
          {activeTab === 'payment-runs' && (
            <button type="button" onClick={() => setShowPRForm(v => !v)}
              className="font-heading px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
              {showPRForm ? '✕ Cancel' : '+ Payment Run'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
        {(['vendors', 'bills', 'payment-runs'] as APTab[]).map(t => (
          <button key={t} type="button" onClick={() => setActiveTab(t)}
            className="font-heading px-4 py-2 rounded-lg text-sm font-semibold transition-all capitalize"
            style={activeTab === t ? { background: 'var(--bg-sidebar)', color: '#fff' } : { color: 'var(--text-secondary)' }}>
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* VENDORS TAB */}
      {activeTab === 'vendors' && (
        <>
          {showVendorForm && (
            <div className="p-6 rounded-2xl border-2 space-y-4" style={{ borderColor: 'var(--india-500)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-lg font-bold" style={{ color: 'var(--text-primary)' }}>New Vendor</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <input type="text" placeholder="Vendor name *" value={vName} onChange={e => setVName(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                <input type="email" placeholder="Email" value={vEmail} onChange={e => setVEmail(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                <input type="text" placeholder="Phone" value={vPhone} onChange={e => setVPhone(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                <input type="text" placeholder="Country (IN, US, ...)" value={vCountry} onChange={e => setVCountry(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                <input type="text" placeholder="GSTIN" value={vGstin} onChange={e => setVGstin(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                <input type="text" placeholder="PAN" value={vPan} onChange={e => setVPan(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                <input type="text" placeholder="Address" value={vAddress} onChange={e => setVAddress(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border text-sm col-span-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                <label className="flex items-center gap-2 text-sm px-3 py-2.5 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={vNonResident} onChange={e => setVNonResident(e.target.checked)} />
                  Non-resident vendor (WHT applicable)
                </label>
              </div>
              <div className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <p className="text-xs font-heading font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>BANK DETAILS (OPTIONAL)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input type="text" placeholder="Account number" value={vBankAccount} onChange={e => setVBankAccount(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                  <input type="text" placeholder="IFSC code" value={vBankIfsc} onChange={e => setVBankIfsc(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                  <input type="text" placeholder="Bank name" value={vBankName} onChange={e => setVBankName(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={handleAddVendor} disabled={!vName.trim()}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--bg-sidebar)' }}>
                  Save Vendor
                </button>
                <button type="button" onClick={() => setShowVendorForm(false)}
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
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Name</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Country</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>GSTIN / PAN</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Type</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.filter(v => !v.archived).length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No vendors added yet.</td></tr>
                ) : vendors.filter(v => !v.archived).map(v => (
                  <React.Fragment key={v.id}>
                    <tr className="border-t cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}
                      onClick={() => setExpandedVendor(expandedVendor === v.id ? null : v.id)}>
                      <td className="py-3 px-4">
                        <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{v.name}</div>
                        {v.email && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.email}</div>}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs" style={{ color: 'var(--text-secondary)' }}>{v.country}</td>
                      <td className="py-3 px-4 hidden lg:table-cell font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {v.gstin || v.pan || '—'}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {v.isNonResident
                          ? <span className="text-xs px-2 py-0.5 rounded-lg font-semibold" style={{ background: '#fee2e2', color: '#dc2626' }}>Non-resident</span>
                          : <span className="text-xs px-2 py-0.5 rounded-lg font-semibold" style={{ background: '#f0fdf4', color: '#16a34a' }}>Resident</span>}
                      </td>
                      <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setBVendorId(v.id); setActiveTab('bills'); setShowBillForm(true); }}
                            className="text-xs px-2 py-1 rounded-lg font-semibold" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                            + Bill
                          </button>
                          <button type="button" onClick={() => handleArchiveVendor(v)}
                            className="text-xs px-2 py-1 rounded-lg font-semibold" style={{ background: '#f3f4f6', color: '#6b7280' }}>
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedVendor === v.id && (
                      <tr style={{ borderColor: 'var(--border-subtle)' }}>
                        <td colSpan={5} className="px-4 pb-4" style={{ background: 'var(--bg-page)' }}>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                            {v.phone && <div><span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>Phone</span><p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{v.phone}</p></div>}
                            {v.address && <div><span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>Address</span><p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{v.address}</p></div>}
                            {v.bankAccount && <div><span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>Bank Account</span><p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>{v.bankAccount}</p></div>}
                            {v.bankIfsc && <div><span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>IFSC</span><p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>{v.bankIfsc}</p></div>}
                          </div>
                          <div className="mt-3">
                            <p className="text-xs font-heading font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>BILLS</p>
                            {getBillsByVendor(v.id).length === 0
                              ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No bills for this vendor.</p>
                              : getBillsByVendor(v.id).slice(0, 5).map(b => (
                                <div key={b.id} className="flex justify-between items-center py-1.5 border-b text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{b.number}</span>
                                  <span style={{ color: 'var(--text-secondary)' }}>{b.date}</span>
                                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtAmt(b.total, b.currency)}</span>
                                  <span className="px-2 py-0.5 rounded-lg text-xs font-semibold" style={BILL_STATUS_COLORS[b.status] ?? BILL_STATUS_COLORS.Pending}>{b.status}</span>
                                </div>
                              ))
                            }
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

      {/* BILLS TAB */}
      {activeTab === 'bills' && (
        <>
          {showBillForm && (
            <div className="p-6 rounded-2xl border-2 space-y-4" style={{ borderColor: 'var(--india-500)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-lg font-bold" style={{ color: 'var(--text-primary)' }}>New Bill</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Vendor *</label>
                  <select value={bVendorId} onChange={e => setBVendorId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="">Select vendor</option>
                    {vendors.filter(v => !v.archived).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Bill Date</label>
                  <input type="date" value={bDate} onChange={e => setBDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Due in (days)</label>
                  <input type="number" min={0} value={bDueDays} onChange={e => setBDueDays(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Currency</label>
                  <select value={bCurrency} onChange={e => setBCurrency(e.target.value as 'USD' | 'INR')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Entity</label>
                  <select value={bEntity} onChange={e => setBEntity(e.target.value as 'parent' | 'subsidiary')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="subsidiary">Subsidiary</option>
                    <option value="parent">Parent</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>TDS Section</label>
                  <select value={bTdsSection} onChange={e => setBTdsSection(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    {TDS_SECTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Bill Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>Line Items</span>
                  <button type="button" onClick={() => setBLines(prev => [...prev, { ...EMPTY_LINE }])}
                    className="text-xs font-heading font-semibold px-2 py-1 rounded-lg" style={{ background: 'var(--bg-page)', color: 'var(--brand-500)' }}>
                    + Add line
                  </button>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--bg-page)' }}>
                        <th className="text-left py-2 px-3 font-heading font-semibold text-xs" style={{ color: 'var(--text-muted)' }}>Description</th>
                        <th className="text-center py-2 px-3 font-heading font-semibold text-xs w-16" style={{ color: 'var(--text-muted)' }}>Qty</th>
                        <th className="text-right py-2 px-3 font-heading font-semibold text-xs w-28" style={{ color: 'var(--text-muted)' }}>Unit Price</th>
                        <th className="text-center py-2 px-3 font-heading font-semibold text-xs w-20" style={{ color: 'var(--text-muted)' }}>GST %</th>
                        <th className="text-right py-2 px-3 font-heading font-semibold text-xs w-24" style={{ color: 'var(--text-muted)' }}>Amount</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {bLines.map((l, idx) => (
                        <tr key={idx} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                          <td className="py-1.5 px-2">
                            <input type="text" placeholder="Service description" value={l.description} onChange={e => updateBillLine(idx, 'description', e.target.value)}
                              className="w-full px-2 py-1.5 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                          </td>
                          <td className="py-1.5 px-2">
                            <input type="number" min={1} value={l.quantity} onChange={e => updateBillLine(idx, 'quantity', Number(e.target.value) || 1)}
                              className="w-full px-2 py-1.5 rounded-lg border text-sm text-center" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                          </td>
                          <td className="py-1.5 px-2">
                            <input type="number" min={0} step={0.01} value={l.unitPrice || ''} placeholder="0.00" onChange={e => updateBillLine(idx, 'unitPrice', Number(e.target.value) || 0)}
                              className="w-full px-2 py-1.5 rounded-lg border text-sm text-right" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                          </td>
                          <td className="py-1.5 px-2">
                            <select value={l.gstRate} onChange={e => updateBillLine(idx, 'gstRate', Number(e.target.value))}
                              className="w-full px-2 py-1.5 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                              <option value={0}>0%</option>
                              <option value={5}>5%</option>
                              <option value={12}>12%</option>
                              <option value={18}>18%</option>
                              <option value={28}>28%</option>
                            </select>
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {fmtAmt(l.quantity * l.unitPrice * (1 + l.gstRate / 100), bCurrency)}
                          </td>
                          <td className="py-1.5 px-2">
                            {bLines.length > 1 && (
                              <button type="button" onClick={() => setBLines(prev => prev.filter((_, i) => i !== idx))}
                                className="text-xs w-6 h-6 flex items-center justify-center rounded-lg" style={{ color: 'var(--critical)', background: '#fee2e2' }}>✕</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const sub = bLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
                        const gst = bLines.reduce((s, l) => s + l.quantity * l.unitPrice * (l.gstRate / 100), 0);
                        const tot = sub + gst;
                        const tdsSect = TDS_SECTIONS.find(s => s.value === bTdsSection);
                        const tdsRateVal = bTdsSection === '194Q' ? 1 : bTdsSection === '195' ? 20 : 10;
                        const tdsAmt = tot * (tdsRateVal / 100);
                        return (
                          <>
                            <tr className="border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)' }}>
                              <td colSpan={4} className="py-1.5 px-3 text-right text-xs font-heading" style={{ color: 'var(--text-secondary)' }}>Subtotal</td>
                              <td className="py-1.5 px-3 text-right font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtAmt(sub, bCurrency)}</td>
                              <td />
                            </tr>
                            {gst > 0 && <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                              <td colSpan={4} className="py-1.5 px-3 text-right text-xs font-heading" style={{ color: 'var(--text-secondary)' }}>GST</td>
                              <td className="py-1.5 px-3 text-right font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtAmt(gst, bCurrency)}</td>
                              <td />
                            </tr>}
                            <tr className="border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)' }}>
                              <td colSpan={4} className="py-1.5 px-3 text-right text-xs font-heading" style={{ color: 'var(--text-secondary)' }}>TDS ({bTdsSection} @{tdsRateVal}%)</td>
                              <td className="py-1.5 px-3 text-right font-mono text-sm font-semibold" style={{ color: '#dc2626' }}>-{fmtAmt(tdsAmt, bCurrency)}</td>
                              <td />
                            </tr>
                            <tr className="border-t-2" style={{ borderColor: 'var(--india-500)' }}>
                              <td colSpan={4} className="py-2 px-3 text-right font-heading font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Net Payable</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-base" style={{ color: 'var(--india-600)' }}>{fmtAmt(tot - tdsAmt, bCurrency)}</td>
                              <td />
                            </tr>
                          </>
                        );
                      })()}
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={handleCreateBill} disabled={!bVendorId || bLines.every(l => l.unitPrice <= 0)}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--bg-sidebar)' }}>
                  Create Bill
                </button>
                <button type="button" onClick={() => setShowBillForm(false)}
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
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Bill #</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Vendor</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Status</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Gross</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>TDS</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Net Payable</th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No bills yet. Add a vendor and create a bill.</td></tr>
                ) : bills.map(b => {
                  const vendor = vendors.find(v => v.id === b.vendorId);
                  const isExp = expandedBill === b.id;
                  const statusStyle = BILL_STATUS_COLORS[b.status] ?? BILL_STATUS_COLORS.Pending;
                  return (
                    <React.Fragment key={b.id}>
                      <tr className="border-t cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}
                        onClick={() => setExpandedBill(isExp ? null : b.id)}>
                        <td className="py-3 px-4 font-mono text-xs font-semibold" style={{ color: 'var(--india-600)' }}>{b.number}</td>
                        <td className="py-3 px-4 font-medium" style={{ color: 'var(--text-primary)' }}>{vendor?.name ?? 'Unknown'}</td>
                        <td className="py-3 px-4 hidden md:table-cell text-xs" style={{ color: 'var(--text-secondary)' }}>{b.date}</td>
                        <td className="py-3 px-4"><span className="px-2 py-0.5 rounded-lg text-xs font-semibold" style={statusStyle}>{b.status}</span></td>
                        <td className="py-3 px-4 text-right font-mono text-sm hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>{fmtAmt(b.total, b.currency)}</td>
                        <td className="py-3 px-4 text-right font-mono text-sm hidden lg:table-cell" style={{ color: '#dc2626' }}>-{fmtAmt(b.tdsAmount ?? 0, b.currency)}</td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{fmtAmt(b.netPayable ?? b.total, b.currency)}</td>
                      </tr>
                      {isExp && (
                        <tr style={{ borderColor: 'var(--border-subtle)' }}>
                          <td colSpan={7} className="px-4 pb-4" style={{ background: 'var(--bg-page)' }}>
                            <div className="mt-3 text-xs space-y-1">
                              <div className="flex gap-6">
                                <span><strong>Due:</strong> {b.dueDate}</span>
                                <span><strong>TDS section:</strong> {b.tdsSection}</span>
                                <span><strong>TDS rate:</strong> {b.tdsRate}%</span>
                                <span><strong>Entity:</strong> {b.entity ?? '—'}</span>
                              </div>
                              {b.lines.map(line => (
                                <div key={line.id} className="flex justify-between border-t pt-1" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>{line.description} × {line.quantity}</span>
                                  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{fmtAmt(line.amount, b.currency)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* PAYMENT RUNS TAB */}
      {activeTab === 'payment-runs' && (
        <>
          {showPRForm && (
            <div className="p-6 rounded-2xl border-2 space-y-4" style={{ borderColor: 'var(--us-500)', background: 'var(--bg-elevated)' }}>
              <h2 className="font-heading text-lg font-bold" style={{ color: 'var(--text-primary)' }}>New Payment Run</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Vendor *</label>
                  <select value={prVendorId} onChange={e => { setPrVendorId(e.target.value); setPrSelectedBills(new Set()); }}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="">Select vendor</option>
                    {vendors.filter(v => !v.archived).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Payment Date</label>
                  <input type="date" value={prDate} onChange={e => setPrDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Currency</label>
                  <select value={prCurrency} onChange={e => setPrCurrency(e.target.value as 'USD' | 'INR')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Pay from entity</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPrPaymentEntity('parent')}
                    className="font-heading px-4 py-2 rounded-xl text-xs font-semibold border transition-all"
                    style={prPaymentEntity === 'parent'
                      ? { background: 'var(--bg-sidebar)', color: '#fff', borderColor: 'var(--bg-sidebar)' }
                      : { background: 'var(--bg-page)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>
                    Parent (India LLP)
                  </button>
                  <button type="button" onClick={() => setPrPaymentEntity('subsidiary')}
                    className="font-heading px-4 py-2 rounded-xl text-xs font-semibold border transition-all"
                    style={prPaymentEntity === 'subsidiary'
                      ? { background: 'var(--bg-sidebar)', color: '#fff', borderColor: 'var(--bg-sidebar)' }
                      : { background: 'var(--bg-page)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>
                    Subsidiary (US Corp)
                  </button>
                </div>
              </div>

              {prVendorId && vendorUnpaidBills.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No unpaid bills for this vendor.</p>
              )}
              {prVendorId && vendorUnpaidBills.length > 0 && (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="p-3 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)' }}>
                    <span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>SELECT BILLS TO PAY</span>
                  </div>
                  {vendorUnpaidBills.map(b => (
                    <div key={b.id} className="flex items-center gap-3 px-4 py-3 border-t cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}
                      onClick={() => toggleBillSelect(b.id)}>
                      <input type="checkbox" checked={prSelectedBills.has(b.id)} onChange={() => toggleBillSelect(b.id)} onClick={e => e.stopPropagation()} />
                      <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{b.number}</span>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{b.date}</span>
                      <span className="text-xs flex-1" style={{ color: 'var(--text-muted)' }}>{b.status}</span>
                      <span className="text-xs" style={{ color: '#dc2626' }}>TDS: {fmtAmt(b.tdsAmount ?? 0, b.currency)}</span>
                      <span className="font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{fmtAmt(b.netPayable ?? b.total, b.currency)}</span>
                    </div>
                  ))}
                  {prSelectedBills.size > 0 && (
                    <div className="flex justify-between items-center px-4 py-3 border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)' }}>
                      <span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        {prSelectedBills.size} bill{prSelectedBills.size > 1 ? 's' : ''} · TDS: {fmtAmt(prTotalTds, prCurrency)}
                      </span>
                      <span className="font-mono font-bold text-base" style={{ color: 'var(--us-600)' }}>
                        Total: {fmtAmt(prTotalGross, prCurrency)}
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={handleCreatePR} disabled={!prVendorId || prSelectedBills.size === 0}
                  className="font-heading px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--bg-sidebar)' }}>
                  Create Payment Run
                </button>
                <button type="button" onClick={() => { setShowPRForm(false); setPrVendorId(''); setPrSelectedBills(new Set()); setPrPaymentEntity('subsidiary'); }}
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
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Vendor</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Bills</th>
                  <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Status</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>TDS</th>
                  <th className="text-right py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Net Paid</th>
                  <th className="py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paymentRuns.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No payment runs. Create one to batch-pay vendor bills.</td></tr>
                ) : paymentRuns.map(pr => {
                  const vendor = vendors.find(v => v.id === pr.vendorId);
                  return (
                    <tr key={pr.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="py-3 px-4 text-xs" style={{ color: 'var(--text-secondary)' }}>{pr.date}</td>
                      <td className="py-3 px-4 font-medium" style={{ color: 'var(--text-primary)' }}>{vendor?.name ?? 'Unknown'}</td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs" style={{ color: 'var(--text-muted)' }}>{pr.lines.length} bill{pr.lines.length !== 1 ? 's' : ''}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-lg text-xs font-semibold"
                          style={pr.status === 'Processed' ? { background: '#dcfce7', color: '#16a34a' } : { background: '#fef9c3', color: '#a16207' }}>
                          {pr.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-sm hidden lg:table-cell" style={{ color: '#dc2626' }}>
                        -{fmtAmt(pr.totalTds, pr.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {fmtAmt(pr.totalNet, pr.currency)}
                      </td>
                      <td className="py-3 px-4">
                        {pr.status === 'Draft' && (
                          <button type="button" onClick={() => handleProcessPR(pr.id)}
                            className="text-xs px-2 py-1 rounded-lg font-semibold" style={{ background: '#dcfce7', color: '#16a34a' }}>
                            Process
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default VendorsAPScreen;
