/**
 * Employee self-service portal screens.
 */

import React, { useEffect, useState } from 'react';
import type { Employee, LeaveRequest } from '../../types';
import {
  addLeaveRequest,
  getCompanyProfile,
  getEmployees,
  getLeaveBalance,
  getLeavePolicies,
  getLeaveRequests,
  getPayrollRuns,
  StorageKeys,
  setEmployeeLocalOnly,
  updateEmployeeSelfProfile,
  updateLeaveRequest,
} from '../../services/storageService';
import { computeFullSalary, MONTHS } from '../../services/payrollCalculator';
import { getAppSession } from '../../services/sessionAuth';
import { api } from '../../services/apiClient';

const fmt = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function getCurrentEmployee(): Employee | null {
  const session = getAppSession();
  if (!session?.employeeId) return null;
  return getEmployees().find((e) => e.id === session.employeeId) ?? null;
}

export const EmployeeHome: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const emp = getCurrentEmployee();
  const session = getAppSession();
  if (!emp) {
    return <EmptyEmployee />;
  }
  const pendingLeaves = getLeaveRequests().filter(
    (l) => l.employeeId === emp.id && l.status === 'Pending',
  ).length;
  const runs = getPayrollRuns().filter((r) => r.employeeSlips.some((s) => s.employeeId === emp.id));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Hi, {emp.name.split(' ')[0]}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Your employee workspace · signed in as {session?.email || emp.email}
        </p>
      </header>
      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Status" value={emp.status} />
        <Stat label="CTC" value={fmt(emp.ctc)} />
        <Stat label="Payslips on file" value={String(runs.length)} />
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <QuickAction title="My profile" desc="Personal & salary bank account" onClick={() => onNavigate('emp-profile')} />
        <QuickAction title="Pay & slips" desc="Compensation and salary slips" onClick={() => onNavigate('emp-pay')} />
        <QuickAction title="Leave" desc={pendingLeaves ? `${pendingLeaves} pending` : 'Apply or track leave'} onClick={() => onNavigate('emp-leave')} />
      </div>
    </div>
  );
};

export const EmployeeProfileSelf: React.FC = () => {
  const session = getAppSession();
  const initial = getCurrentEmployee();
  const [emp, setEmp] = useState<Employee | null>(initial);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bankConfirm, setBankConfirm] = useState(initial?.bankAccountNumber || '');
  const [form, setForm] = useState(() => profileFormFromEmployee(initial));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!session?.employeeId) return;
      const orgId = session.orgId || localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) || 'default';
      try {
        const remote = await api.getEmployeeSelf(orgId, session.employeeId);
        if (cancelled || !remote) return;
        setEmployeeLocalOnly(remote);
        setEmp(remote);
        setForm(profileFormFromEmployee(remote));
        setBankConfirm(remote.bankAccountNumber || '');
      } catch {
        /* keep local */
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [session?.employeeId, session?.orgId]);

  if (!emp) return <EmptyEmployee />;

  const docs = emp.documents || { pan: false, aadhaar: false, contract: false };

  const setField = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setToast(null);
    if (!form.name.trim()) {
      setError('Name is required');
      setSaving(false);
      return;
    }
    const account = form.bankAccountNumber.trim();
    const confirm = bankConfirm.trim();
    if (account || confirm) {
      if (account !== confirm) {
        setError('Bank account number and confirmation do not match');
        setSaving(false);
        return;
      }
    }
    if (form.bankIFSC.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(form.bankIFSC.trim())) {
      setError('IFSC must look like HDFC0001234');
      setSaving(false);
      return;
    }
    const patch: Partial<Employee> = {
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      gender: (form.gender as Employee['gender']) || undefined,
      fatherOrSpouseName: form.fatherOrSpouseName.trim() || undefined,
      panNumber: form.panNumber.trim() || undefined,
      aadhaarNumber: form.aadhaarNumber.trim() || undefined,
      uan: form.uan.trim() || undefined,
      esiNumber: form.esiNumber.trim() || undefined,
      bankAccountNumber: account || undefined,
      bankIFSC: form.bankIFSC.trim().toUpperCase() || undefined,
      bankName: form.bankName.trim() || undefined,
      taxRegime: form.taxRegime === 'new' || form.taxRegime === 'old' ? form.taxRegime : undefined,
      section80C: form.section80C !== '' ? Number(form.section80C) : undefined,
      section80D: form.section80D !== '' ? Number(form.section80D) : undefined,
      hraExemptionRent: form.hraExemptionRent !== '' ? Number(form.hraExemptionRent) : undefined,
    };
    const result = await updateEmployeeSelfProfile(emp.id, patch);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || 'Could not save profile');
      return;
    }
    const refreshed = getEmployees().find((e) => e.id === emp.id) ?? null;
    setEmp(refreshed);
    if (refreshed) {
      setForm(profileFormFromEmployee(refreshed));
      setBankConfirm(refreshed.bankAccountNumber || '');
    }
    setToast('Profile and bank details updated');
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">My profile</h1>
        <p className="text-sm text-slate-500 mt-1">
          Update contact and salary bank account details. HR owns title, pay, and employment status.
        </p>
      </header>
      {toast && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">{toast}</p>
      )}
      {error && (
        <p className="text-sm text-rose-800 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">{error}</p>
      )}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 text-sm">
        <h2 className="text-sm font-semibold text-slate-800">Employment (read-only)</h2>
        <Row label="Employee ID" value={emp.id} />
        <Row label="Email" value={emp.email || session?.email || '—'} />
        <Row label="Designation" value={emp.designation || '—'} />
        <Row label="Department" value={emp.department || '—'} />
        <Row label="Type" value={emp.employeeType || '—'} />
        <Row label="Date of joining" value={emp.doj} />
        <Row label="Status" value={emp.status} />
        <Row label="CTC" value={fmt(emp.ctc)} />
      </section>

      <section className="bg-white rounded-2xl border border-indigo-200 p-6 space-y-4 ring-1 ring-indigo-50">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Bank account for salary</h2>
          <p className="text-xs text-slate-500 mt-1">
            Used for payroll credits. Enter the account number twice to confirm.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Bank name" value={form.bankName} onChange={(v) => setField('bankName', v)} className="sm:col-span-2" />
          <Field label="IFSC code" value={form.bankIFSC} onChange={(v) => setField('bankIFSC', v.toUpperCase())} />
          <div />
          <Field
            label="Account number"
            value={form.bankAccountNumber}
            onChange={(v) => setField('bankAccountNumber', v.replace(/\s/g, ''))}
            className="sm:col-span-2"
          />
          <Field
            label="Confirm account number"
            value={bankConfirm}
            onChange={(v) => setBankConfirm(v.replace(/\s/g, ''))}
            className="sm:col-span-2"
          />
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Personal details</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Full name" value={form.name} onChange={(v) => setField('name', v)} />
          <Field label="Phone" value={form.phone} onChange={(v) => setField('phone', v)} />
          <Field label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setField('dateOfBirth', v)} />
          <label className="text-xs font-medium text-slate-600">
            Gender
            <select
              value={form.gender}
              onChange={(e) => setField('gender', e.target.value)}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
            >
              <option value="">—</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <Field label="Father / spouse name" value={form.fatherOrSpouseName} onChange={(v) => setField('fatherOrSpouseName', v)} className="sm:col-span-2" />
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Address
            <textarea
              value={form.address}
              onChange={(e) => setField('address', e.target.value)}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm min-h-[72px]"
            />
          </label>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Identity & statutory</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="PAN" value={form.panNumber} onChange={(v) => setField('panNumber', v.toUpperCase())} />
          <Field label="Aadhaar" value={form.aadhaarNumber} onChange={(v) => setField('aadhaarNumber', v)} />
          <Field label="UAN" value={form.uan} onChange={(v) => setField('uan', v)} />
          <Field label="ESI number" value={form.esiNumber} onChange={(v) => setField('esiNumber', v)} />
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Tax preferences</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Tax regime
            <select
              value={form.taxRegime}
              onChange={(e) => setField('taxRegime', e.target.value)}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
            >
              <option value="">—</option>
              <option value="new">New</option>
              <option value="old">Old</option>
            </select>
          </label>
          <Field label="Section 80C (₹/year)" value={form.section80C} onChange={(v) => setField('section80C', v)} type="number" />
          <Field label="Section 80D (₹/year)" value={form.section80D} onChange={(v) => setField('section80D', v)} type="number" />
          <Field label="HRA rent paid (₹/month)" value={form.hraExemptionRent} onChange={(v) => setField('hraExemptionRent', v)} type="number" />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        <p className="text-xs text-slate-400">Bank and personal changes sync to your company record when the server is available.</p>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Documents on file</h2>
        <ul className="text-sm space-y-2">
          <li className={docs.pan ? 'text-emerald-700' : 'text-amber-700'}>PAN {docs.pan ? 'received' : 'pending'}</li>
          <li className={docs.aadhaar ? 'text-emerald-700' : 'text-amber-700'}>Aadhaar {docs.aadhaar ? 'received' : 'pending'}</li>
          <li className={docs.contract ? 'text-emerald-700' : 'text-amber-700'}>Contract {docs.contract ? 'received' : 'pending'}</li>
        </ul>
      </section>
    </div>
  );
};

function profileFormFromEmployee(e: Employee | null) {
  return {
    name: e?.name || '',
    phone: e?.phone || '',
    address: e?.address || '',
    dateOfBirth: e?.dateOfBirth || '',
    gender: e?.gender || '',
    fatherOrSpouseName: e?.fatherOrSpouseName || '',
    panNumber: e?.panNumber || '',
    aadhaarNumber: e?.aadhaarNumber || '',
    uan: e?.uan || '',
    esiNumber: e?.esiNumber || '',
    bankAccountNumber: e?.bankAccountNumber || '',
    bankIFSC: e?.bankIFSC || '',
    bankName: e?.bankName || '',
    taxRegime: e?.taxRegime || '',
    section80C: e?.section80C != null ? String(e.section80C) : '',
    section80D: e?.section80D != null ? String(e.section80D) : '',
    hraExemptionRent: e?.hraExemptionRent != null ? String(e.hraExemptionRent) : '',
  };
}

export const EmployeePaySelf: React.FC<{ onNavigate?: (tab: string) => void }> = ({ onNavigate }) => {
  const emp = getCurrentEmployee();
  const profile = getCompanyProfile();
  if (!emp) return <EmptyEmployee />;

  const payrollConfig = profile?.payroll || {
    pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22,
  };
  const now = new Date();
  const preview = computeFullSalary(emp, payrollConfig, MONTHS[now.getMonth()], now.getFullYear(), 0);
  const mySlips = getPayrollRuns()
    .flatMap((run) =>
      run.employeeSlips
        .filter((s) => s.employeeId === emp.id)
        .map((s) => ({ run, slip: s })),
    )
    .sort((a, b) => b.run.year - a.run.year || MONTHS.indexOf(b.run.month) - MONTHS.indexOf(a.run.month));

  const maskedAcct = emp.bankAccountNumber
    ? `${'•'.repeat(Math.max(0, emp.bankAccountNumber.length - 4))}${emp.bankAccountNumber.slice(-4)}`
    : '—';

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Pay & salary slips</h1>
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Salary credit bank account</h2>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('emp-profile')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Edit bank details
            </button>
          )}
        </div>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <Stat label="Bank" value={emp.bankName || 'Not set'} />
          <Stat label="IFSC" value={emp.bankIFSC || '—'} />
          <Stat label="Account" value={maskedAcct} />
        </div>
        {!emp.bankAccountNumber && (
          <p className="text-xs text-amber-700 mt-3">
            Add your bank account on My profile so salary can be credited correctly.
          </p>
        )}
      </section>
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Compensation</h2>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <Stat label="Annual CTC" value={fmt(emp.ctc)} />
          <Stat label="This month net (preview)" value={fmt(preview.netPay)} />
          <Stat label="Gross (preview)" value={fmt(preview.grossEarnings)} />
        </div>
        <ul className="mt-4 text-sm space-y-2 text-slate-600">
          <li className="flex justify-between"><span>Basic</span><span className="tabular-nums font-medium">{fmt(preview.basic)}</span></li>
          <li className="flex justify-between"><span>HRA</span><span className="tabular-nums font-medium">{fmt(preview.hra)}</span></li>
          <li className="flex justify-between"><span>PF (employee)</span><span className="tabular-nums font-medium text-rose-600">−{fmt(preview.epf)}</span></li>
          <li className="flex justify-between"><span>Professional tax</span><span className="tabular-nums font-medium text-rose-600">−{fmt(preview.pt)}</span></li>
          <li className="flex justify-between"><span>TDS</span><span className="tabular-nums font-medium text-rose-600">−{fmt(preview.tds)}</span></li>
        </ul>
      </section>
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Salary slips</h2>
        </div>
        {mySlips.length === 0 ? (
          <p className="p-8 text-sm text-slate-500 text-center">No processed slips yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3">Period</th>
                <th className="px-5 py-3 text-right">Gross</th>
                <th className="px-5 py-3 text-right">Deductions</th>
                <th className="px-5 py-3 text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mySlips.map(({ run, slip }) => (
                <tr key={`${run.id}-${slip.employeeId}`}>
                  <td className="px-5 py-3 font-medium">{run.month} {run.year}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmt(slip.grossEarnings)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-rose-600">{fmt(slip.totalDeductions)}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold">{fmt(slip.netPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export const EmployeeLeaveSelf: React.FC = () => {
  const emp = getCurrentEmployee();
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ type: 'CL', fromDate: '', toDate: '', reason: '' });
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  if (!emp) return <EmptyEmployee />;

  const year = new Date().getFullYear();
  const balance = getLeaveBalance(emp.id, year);
  const policies = getLeavePolicies();
  const mine = getLeaveRequests().filter((l) => l.employeeId === emp.id);

  const apply = () => {
    if (!form.fromDate || !form.toDate) {
      setToast('Select from and to dates');
      return;
    }
    const from = new Date(form.fromDate);
    const to = new Date(form.toDate);
    if (to < from) {
      setToast('To date must be on or after from date');
      return;
    }
    const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
    const request: LeaveRequest = {
      id: `LR-${Date.now()}`,
      employeeId: emp.id,
      type: form.type,
      fromDate: form.fromDate,
      toDate: form.toDate,
      days,
      reason: form.reason || 'Leave request',
      status: 'Pending',
      appliedAt: new Date().toISOString(),
    };
    addLeaveRequest(request);
    setForm({ type: 'CL', fromDate: '', toDate: '', reason: '' });
    setToast(`Leave request submitted (${days} day${days === 1 ? '' : 's'})`);
    refresh();
  };

  const cancel = (id: string) => {
    updateLeaveRequest(id, { status: 'Cancelled' });
    setToast('Leave cancelled');
    refresh();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Leave</h1>
      {toast && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">{toast}</p>
      )}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Balances ({year})</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(balance.balances).map(([type, b]) => (
            <div key={type} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] font-semibold text-slate-500">{type}</p>
              <p className="text-lg font-bold text-slate-900">{b.remaining}<span className="text-xs font-medium text-slate-400"> / {b.total}</span></p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Apply for leave</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Type
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
            >
              {policies.map((p) => (
                <option key={p.type} value={p.type}>{p.name} ({p.type})</option>
              ))}
            </select>
          </label>
          <div />
          <label className="text-xs font-medium text-slate-600">
            From
            <input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            To
            <input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-600">
          Reason
          <textarea
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm min-h-[72px]"
          />
        </label>
        <button type="button" onClick={apply} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
          Submit request
        </button>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">My requests</h2>
        </div>
        {mine.length === 0 ? (
          <p className="p-8 text-sm text-slate-500 text-center">No leave requests yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mine.map((lr) => (
              <li key={lr.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{lr.type} · {lr.days} day{lr.days === 1 ? '' : 's'}</p>
                  <p className="text-xs text-slate-500">{lr.fromDate} → {lr.toDate} · {lr.status}</p>
                </div>
                {lr.status === 'Pending' && (
                  <button type="button" onClick={() => cancel(lr.id)} className="text-xs font-semibold text-rose-600">
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

function EmptyEmployee() {
  return (
    <div className="py-20 text-center text-sm text-slate-500">
      Employee profile not found. Sign out and choose a valid employee.
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function QuickAction({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white rounded-2xl border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <p className="text-sm font-bold text-slate-900">{title}</p>
      <p className="text-xs text-slate-500 mt-1">{desc}</p>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1 border-b border-slate-50 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 text-right">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`text-xs font-medium text-slate-600 ${className}`}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
      />
    </label>
  );
}
