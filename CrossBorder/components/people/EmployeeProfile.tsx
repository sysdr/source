/**
 * Employee profile — identity, lifecycle, salary revisions, docs.
 * REQ: REQ-084, REQ-085, REQ-087, REQ-088
 */

import React, { useState } from 'react';
import type { Employee } from '../../types';
import {
  applyLifecycleEvent,
  appendSalaryRevision,
  canHardDeleteEmployee,
  isPayrollEligible,
  type EmployeeLifecycleEvent,
} from '../../services/employeeLifecycle';
import { getPayrollRuns } from '../../services/storageService';
import { maskDisplayValue } from '../../services/displayPii';

const fmt = (val?: number | null) =>
  (Number.isFinite(val) ? (val as number) : 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

const ACTIONS: { event: EmployeeLifecycleEvent; label: string }[] = [
  { event: 'complete_onboarding', label: 'Complete onboarding' },
  { event: 'activate', label: 'Activate' },
  { event: 'deactivate', label: 'Deactivate' },
  { event: 'start_notice', label: 'Start notice' },
  { event: 'exit', label: 'Mark exited' },
  { event: 'archive', label: 'Archive' },
  { event: 'rehire', label: 'Rehire' },
];

interface Props {
  employee: Employee;
  onUpsert: (emp: Employee) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
  toast: (type: 'success' | 'error' | 'info', text: string) => void;
}

const EmployeeProfile: React.FC<Props> = ({ employee, onUpsert, onDelete, onBack, toast }) => {
  const [revisionCtc, setRevisionCtc] = useState(String(employee.ctc));
  const [revisionReason, setRevisionReason] = useState('');
  const [revealSensitive, setRevealSensitive] = useState(false);

  const runEvent = (event: EmployeeLifecycleEvent) => {
    const result = applyLifecycleEvent(employee, event);
    if (result.ok === false) {
      toast('error', result.message);
      return;
    }
    onUpsert(result.employee);
    toast('success', `Status → ${result.employee.status}`);
  };

  const saveRevision = () => {
    const result = appendSalaryRevision(
      employee,
      Number(revisionCtc),
      revisionReason,
      new Date().toISOString().slice(0, 10),
    );
    if (result.ok === false) {
      toast('error', result.message);
      return;
    }
    onUpsert(result.employee);
    setRevisionReason('');
    toast('success', 'Salary revision saved');
  };

  const handleDelete = () => {
    const gate = canHardDeleteEmployee(employee.id, getPayrollRuns());
    if (gate.ok === false) {
      toast('error', gate.message);
      return;
    }
    onDelete(employee.id);
    toast('success', 'Employee removed');
    onBack();
  };

  const docs = employee.documents || { pan: false, aadhaar: false, contract: false };
  const panShown = revealSensitive
    ? (employee.panNumber || 'Not collected')
    : (employee.panNumber ? maskDisplayValue(employee.panNumber) : 'Not collected');
  const bankAcctShown = revealSensitive
    ? (employee.bankAccountNumber || '—')
    : maskDisplayValue(employee.bankAccountNumber);
  const ifscShown = revealSensitive
    ? (employee.bankIFSC || '')
    : (employee.bankIFSC ? maskDisplayValue(employee.bankIFSC) : '');
  const uanShown = revealSensitive
    ? (employee.uan || '—')
    : maskDisplayValue(employee.uan);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          ← Back to directory
        </button>
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            isPayrollEligible(employee.status)
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {employee.status}
          {isPayrollEligible(employee.status) ? ' · payroll eligible' : ' · not on payroll'}
        </span>
      </div>

      <header className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">{employee.name}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {employee.designation || '—'} · {employee.department || 'No department'} · {employee.id}
        </p>
        <p className="text-sm text-slate-600 mt-2">{employee.email}</p>
        <p className="text-lg font-semibold text-slate-900 mt-3">{fmt(employee.ctc)} CTC</p>
      </header>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-slate-800">Identity & bank</h3>
            <button
              type="button"
              onClick={() => setRevealSensitive((v) => !v)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              {revealSensitive ? 'Hide sensitive' : 'Reveal sensitive'}
            </button>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">PAN</dt><dd className="font-medium font-mono">{panShown}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">UAN</dt><dd className="font-medium font-mono">{uanShown}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Tax regime</dt><dd className="font-medium">{employee.taxRegime || '—'}</dd></div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Bank</dt>
              <dd className="font-medium text-right">
                {employee.bankName || '—'}
                {ifscShown ? ` · ${ifscShown}` : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Account</dt>
              <dd className="font-medium font-mono text-right">{bankAcctShown}</dd>
            </div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">DOJ</dt><dd className="font-medium">{employee.doj}</dd></div>
          </dl>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Documents</h3>
          <ul className="space-y-2 text-sm">
            <li className={docs.pan ? 'text-emerald-700' : 'text-amber-700'}>PAN {docs.pan ? 'on file' : 'missing'}</li>
            <li className={docs.aadhaar ? 'text-emerald-700' : 'text-amber-700'}>Aadhaar {docs.aadhaar ? 'on file' : 'missing'}</li>
            <li className={docs.contract ? 'text-emerald-700' : 'text-amber-700'}>Contract {docs.contract ? 'on file' : 'missing'}</li>
          </ul>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Status lifecycle</h3>
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <button
              key={a.event}
              type="button"
              onClick={() => runEvent(a.event)}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleDelete}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100"
          >
            Hard delete
          </button>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Salary revisions</h3>
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="number"
            value={revisionCtc}
            onChange={(e) => setRevisionCtc(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm"
            aria-label="New CTC"
          />
          <input
            type="text"
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
            placeholder="Reason"
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm flex-1 min-w-[160px]"
            aria-label="Revision reason"
          />
          <button
            type="button"
            onClick={saveRevision}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Add revision
          </button>
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {(employee.salaryRevisions || []).length === 0 && (
            <li className="py-3 text-slate-500">No revisions yet.</li>
          )}
          {[...(employee.salaryRevisions || [])].reverse().map((r, i) => (
            <li key={`${r.effectiveDate}-${i}`} className="py-3 flex justify-between gap-4">
              <span>{r.effectiveDate} · {r.reason}</span>
              <span className="font-medium tabular-nums">{fmt(r.previousCTC)} → {fmt(r.newCTC)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default EmployeeProfile;
