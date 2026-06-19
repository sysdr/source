import React from 'react';
import { Employee, CompanyProfile } from '../../types';
import {
  calculateTDSOldRegime, calculateTDSNewRegime, calculateHRAExemption, calculatePF,
} from '../../services/payrollCalculator';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (val?: number | null) =>
  (Number.isFinite(val) ? (val as number) : 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  employees: Employee[];
  profile: CompanyProfile | null;
  onUpsertEmployee: (emp: Employee) => void;
  toast: (type: 'success' | 'error' | 'info', text: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const Declarations: React.FC<Props> = ({ employees, profile, onUpsertEmployee }) => {
  const payrollEligible = employees.filter((e) => e.status === 'Active');

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-b from-indigo-50/80 to-white">
          <h3 className="text-base font-bold text-slate-900">Investment declarations</h3>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Declare 80C, 80D and HRA (rent paid) to reduce income tax (TDS) deducted from salary. Used when the employee is on <strong>Old tax regime</strong>. Declarations are applied in payroll to compute lower monthly TDS.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
            <span><strong>80C:</strong> Up to ₹1,50,000 (PPF, LIC, ELSS, tuition, home loan principal, etc.)</span>
            <span><strong>80D:</strong> Up to ₹25,000 (health insurance premium)</span>
            <span><strong>HRA:</strong> Monthly rent paid (exemption computed as per rules)</span>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {payrollEligible.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              No active employees in the current cycle. Add employees and set status to Active.
            </div>
          ) : payrollEligible.map((emp) => {
            const regime = emp.taxRegime || 'new';
            const monthlyBasic = (emp.ctc / 12) * 0.45;
            const monthlyHra = monthlyBasic * 0.4;
            const pf = calculatePF(monthlyBasic, profile?.payroll?.pfEnabled ?? true);
            const epfAnnual = pf.epfEmployee * 12;
            const isMetro = ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'West Bengal', 'Telangana'].includes(profile?.payroll?.ptState || '');
            const hraExemptionAnnual = emp.hraExemptionRent
              ? calculateHRAExemption(monthlyBasic * 12, monthlyHra * 12, (emp.hraExemptionRent || 0) * 12, isMetro)
              : 0;
            const tdsWithoutDecl = regime === 'old'
              ? calculateTDSOldRegime(emp.ctc, epfAnnual, 0, 0, 0)
              : calculateTDSNewRegime(emp.ctc);
            const tdsWithDecl = regime === 'old'
              ? calculateTDSOldRegime(emp.ctc, epfAnnual, emp.section80C ?? 0, emp.section80D ?? 0, hraExemptionAnnual)
              : tdsWithoutDecl;
            const annualSaving = tdsWithoutDecl - tdsWithDecl;
            const monthlyTdsWith = Math.round(tdsWithDecl / 12);

            return (
              <div key={emp.id} className="px-6 py-5 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                  <div className="lg:w-56 shrink-0">
                    <p className="font-semibold text-slate-900">{emp.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{emp.designation}{emp.department ? ` · ${emp.department}` : ''}</p>
                    <span className={`inline-flex mt-2 px-2 py-0.5 rounded-md text-[10px] font-medium ${regime === 'old' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                      Tax regime: {regime === 'old' ? 'Old' : 'New'}
                    </span>
                    {regime === 'new' && (
                      <p className="text-xs text-slate-500 mt-2">Declarations apply only under Old regime. Change in employee profile to use 80C/80D/HRA.</p>
                    )}
                  </div>
                  {regime === 'old' && (
                    <>
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">80C (₹)</label>
                          <input
                            type="number"
                            min={0}
                            max={150000}
                            value={emp.section80C ?? ''}
                            onChange={(e) => {
                              const v = e.target.value === '' ? undefined : Number(e.target.value);
                              const updated = { ...emp, section80C: Math.min(150000, v ?? 0) };
                              onUpsertEmployee(updated);
                            }}
                            placeholder="Max 1,50,000"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">80D (₹)</label>
                          <input
                            type="number"
                            min={0}
                            max={25000}
                            value={emp.section80D ?? ''}
                            onChange={(e) => {
                              const v = e.target.value === '' ? undefined : Number(e.target.value);
                              const updated = { ...emp, section80D: Math.min(25000, v ?? 0) };
                              onUpsertEmployee(updated);
                            }}
                            placeholder="Max 25,000"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Rent paid/mo (₹)</label>
                          <input
                            type="number"
                            min={0}
                            value={emp.hraExemptionRent ?? ''}
                            onChange={(e) => {
                              const v = e.target.value === '' ? undefined : Number(e.target.value);
                              const updated = { ...emp, hraExemptionRent: v ?? 0 };
                              onUpsertEmployee(updated);
                            }}
                            placeholder="For HRA exemption"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                        <div className="flex flex-col justify-end">
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">TDS impact</p>
                          <p className="text-sm font-semibold text-slate-900">₹{fmt(monthlyTdsWith)}/mo</p>
                          {annualSaving > 0 && (
                            <p className="text-xs text-emerald-600 font-medium mt-0.5">Saves ₹{fmt(annualSaving)}/yr vs no declarations</p>
                          )}
                        </div>
                      </div>
                      <div className="lg:w-48 shrink-0 text-right text-xs text-slate-500">
                        <p>Without declarations: ₹{fmt(Math.round(tdsWithoutDecl / 12))}/mo</p>
                        <p className="mt-0.5">With declarations: ₹{fmt(monthlyTdsWith)}/mo</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Declarations;
