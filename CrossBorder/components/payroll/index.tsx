import React, { useState, useCallback, useRef } from 'react';
import { Employee, CompanyProfile, PayrollRun as PayrollRunType, LeaveRequest, LeavePolicy } from '../../types';
import {
  getCompanyProfile, getLeaveRequests, getLeavePolicies, getUIState, setUIState, StorageKeys,
} from '../../services/storageService';
import { MONTHS, computeFullSalary, FullSalaryResult } from '../../services/payrollCalculator';
import { useEmployees, useUpsertEmployee, useDeleteEmployee } from '../../hooks/useEmployees';
import { usePayrollRuns, useAddPayrollRun } from '../../hooks/usePayroll';

import EmployeeDirectory from './EmployeeDirectory';
import PayrollRun from './PayrollRun';
import Declarations from './Declarations';
import PayrollHistory from './PayrollHistory';
import LeaveManagement from './LeaveManagement';
import StatutoryReports from './StatutoryReports';
import Reports from './Reports';

// ── Helpers ───────────────────────────────────────────────────────────────────

const now = () => new Date();
const currentMonth = () => MONTHS[now().getMonth()];
const currentYear = () => now().getFullYear();
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

type TabId = 'directory' | 'payroll' | 'declarations' | 'history' | 'leaves' | 'statutory' | 'reports';
type PayslipFormat = 'txt' | 'pdf' | 'html';
type ToastType = 'success' | 'error' | 'info';

interface ToastMessage { id: string; type: ToastType; text: string; }

// ── Toast Component ───────────────────────────────────────────────────────────

const Toast: React.FC<{ toasts: ToastMessage[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[200] space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`px-5 py-3 rounded-xl text-sm font-medium shadow-lg cursor-pointer animate-in slide-in-from-right duration-300 ${
            t.type === 'success' ? 'bg-emerald-600 text-white' :
            t.type === 'error' ? 'bg-rose-600 text-white' :
            'bg-slate-700 text-white'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const PayrollEngine: React.FC = () => {
  const [profile] = useState<CompanyProfile | null>(() => getCompanyProfile());

  // ── React Query hooks ──────────────────────────────────────────────────────
  const { data: employees = [] } = useEmployees();
  const { data: allRuns = [] } = usePayrollRuns();
  const upsertEmployeeMutation = useUpsertEmployee();
  const deleteEmployeeMutation = useDeleteEmployee();
  const addRunMutation = useAddPayrollRun();

  // ── Leave / policy state (local, no hook yet) ──────────────────────────────
  const [leaveRequests, setLeaveRequestsState] = useState<LeaveRequest[]>(() => getLeaveRequests());
  const [leavePolicies, setLeavePoliciesState] = useState<LeavePolicy[]>(() => getLeavePolicies());

  // ── Persisted UI state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTabState] = useState<TabId>(
    () => getUIState(StorageKeys.UI_PAYROLL_TAB, 'directory' as TabId),
  );
  const [selectedMonth, setSelectedMonthState] = useState(
    () => getUIState(StorageKeys.UI_PAYROLL_MONTH, currentMonth()),
  );
  const [selectedYear, setSelectedYearState] = useState(
    () => getUIState(StorageKeys.UI_PAYROLL_YEAR, currentYear()),
  );
  const [payslipFormat, setPayslipFormatState] = useState<PayslipFormat>(
    () => getUIState(StorageKeys.UI_PAYROLL_FORMAT, 'pdf' as PayslipFormat),
  );
  const [selectedQuarter, setSelectedQuarterState] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>(
    () => getUIState(StorageKeys.UI_PAYROLL_QUARTER, 'Q4' as 'Q1' | 'Q2' | 'Q3' | 'Q4'),
  );
  const [selectedFY, setSelectedFYState] = useState(
    () => getUIState(StorageKeys.UI_PAYROLL_FY, '2025-26'),
  );

  // ── Persisted setters ──────────────────────────────────────────────────────
  const setActiveTab = (v: TabId) => { setActiveTabState(v); setUIState(StorageKeys.UI_PAYROLL_TAB, v); };
  const setSelectedMonth = (v: string) => { setSelectedMonthState(v); setUIState(StorageKeys.UI_PAYROLL_MONTH, v); };
  const setSelectedYear = (v: number) => { setSelectedYearState(v); setUIState(StorageKeys.UI_PAYROLL_YEAR, v); };
  const setPayslipFormat = (v: PayslipFormat) => { setPayslipFormatState(v); setUIState(StorageKeys.UI_PAYROLL_FORMAT, v); };
  const setSelectedQuarter = (v: 'Q1' | 'Q2' | 'Q3' | 'Q4') => { setSelectedQuarterState(v); setUIState(StorageKeys.UI_PAYROLL_QUARTER, v); };
  const setSelectedFY = (v: string) => { setSelectedFYState(v); setUIState(StorageKeys.UI_PAYROLL_FY, v); };

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const toast = useCallback((type: ToastType, text: string) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, type, text }]);
    const timer = setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
    toastTimers.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) { clearTimeout(timer); toastTimers.current.delete(id); }
  }, []);

  // ── Callbacks passed to sub-components ────────────────────────────────────

  const handleUpsertEmployee = useCallback((emp: Employee) => {
    upsertEmployeeMutation.mutate(emp);
  }, [upsertEmployeeMutation]);

  const handleDeleteEmployee = useCallback((id: string) => {
    deleteEmployeeMutation.mutate(id);
  }, [deleteEmployeeMutation]);

  const handleAddRun = useCallback((run: PayrollRunType) => {
    addRunMutation.mutate(run);
  }, [addRunMutation]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeEmployees = employees.filter((e) => e.status === 'Active');

  // ── Tab definitions ────────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; short?: string }[] = [
    { id: 'directory', label: 'Employee directory', short: 'Directory' },
    { id: 'payroll', label: 'Run payroll', short: 'Payroll' },
    { id: 'declarations', label: 'Investment declarations', short: 'Declarations' },
    { id: 'history', label: 'History & YTD', short: 'History' },
    { id: 'leaves', label: 'Leave management', short: 'Leaves' },
    { id: 'statutory', label: 'Statutory & filings', short: 'Statutory' },
    { id: 'reports', label: 'Reports & Payslips', short: 'Reports' },
  ];

  // ── Payroll totals for directory preview ──────────────────────────────────
  const payrollConfig = profile?.payroll || { pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22 };
  const directoryMonthlyNet = activeEmployees.reduce((sum, emp) => {
    const slip = computeFullSalary(emp, payrollConfig, selectedMonth, selectedYear, 0);
    return sum + slip.netPay;
  }, 0);

  // ── Slip preview state (shared between Reports and PayrollRun) ─────────────
  const [reportsSlipPreview, setReportsSlipPreview] = useState<{ emp: Employee; slip: FullSalaryResult } | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Toast toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <header className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Payroll & HR</h1>
            <p className="text-sm text-slate-500 mt-1 max-w-xl">
              {profile?.payroll.pfEnabled ? 'EPF registered' : 'PF exempt'} · ESI {profile?.payroll.esiEnabled ? 'enabled' : 'exempt'} · {profile?.payroll.ptState ?? '—'}
              <span className="text-emerald-600 font-medium ml-1">· {activeEmployees.length} active</span>
              <span className="text-slate-400"> / {employees.length} total</span>
            </p>
          </div>
          <nav className="flex flex-wrap gap-1 p-1.5 bg-slate-100 rounded-2xl border border-slate-200/80 shadow-inner">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === t.id
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                {t.short ?? t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Tab content */}
      {activeTab === 'directory' && (
        <EmployeeDirectory
          employees={employees}
          profile={profile}
          payrollMonthlyNet={directoryMonthlyNet}
          onUpsertEmployee={handleUpsertEmployee}
          onDeleteEmployee={handleDeleteEmployee}
          toast={toast}
        />
      )}

      {activeTab === 'payroll' && (
        <PayrollRun
          employees={employees}
          profile={profile}
          allRuns={allRuns}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          setSelectedMonth={setSelectedMonth}
          setSelectedYear={setSelectedYear}
          payslipFormat={payslipFormat}
          setPayslipFormat={setPayslipFormat}
          onAddRun={handleAddRun}
          toast={toast}
        />
      )}

      {activeTab === 'declarations' && (
        <Declarations
          employees={employees}
          profile={profile}
          onUpsertEmployee={handleUpsertEmployee}
          toast={toast}
        />
      )}

      {activeTab === 'history' && (
        <PayrollHistory
          employees={employees}
          allRuns={allRuns}
        />
      )}

      {activeTab === 'leaves' && (
        <LeaveManagement
          employees={employees}
          leaveRequests={leaveRequests}
          leavePolicies={leavePolicies}
          setLeaveRequestsState={setLeaveRequestsState}
          setLeavePoliciesState={setLeavePoliciesState}
          toast={toast}
        />
      )}

      {activeTab === 'statutory' && (
        <StatutoryReports
          employees={employees}
          profile={profile}
          allRuns={allRuns}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          setSelectedMonth={setSelectedMonth}
          setSelectedYear={setSelectedYear}
          selectedQuarter={selectedQuarter}
          setSelectedQuarter={setSelectedQuarter}
          selectedFY={selectedFY}
          setSelectedFY={setSelectedFY}
          toast={toast}
        />
      )}

      {activeTab === 'reports' && (
        <Reports
          employees={employees}
          profile={profile}
          allRuns={allRuns}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onSlipPreview={(emp, slip) => setReportsSlipPreview({ emp, slip })}
        />
      )}

      {/* Shared slip preview modal (used from Reports tab) */}
      {reportsSlipPreview && (() => {
        const { emp, slip } = reportsSlipPreview;
        const refNum = `SLIP-${emp.id.slice(-6).toUpperCase()}-${slip.month.slice(0, 3).toUpperCase()}${slip.year}`;
        const fmt = (val?: number | null) =>
          (Number.isFinite(val) ? (val as number) : 0).toLocaleString('en-IN', {
            style: 'currency', currency: 'INR', maximumFractionDigits: 0,
          });
        const maskedAcct = emp.bankAccountNumber
          ? '•'.repeat(Math.max(0, emp.bankAccountNumber.length - 4)) + emp.bankAccountNumber.slice(-4)
          : null;
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setReportsSlipPreview(null)}
          >
            <div
              className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 px-6 py-5 text-white shrink-0">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Payslip</h2>
                    <p className="text-indigo-100 text-sm mt-0.5">{slip.month} {slip.year}</p>
                    <p className="text-indigo-200 text-[10px] mt-1 font-mono">{refNum}</p>
                  </div>
                  <button onClick={() => setReportsSlipPreview(null)} className="p-1.5 rounded-lg text-white/80 hover:bg-white/20 transition-colors text-xl leading-none" aria-label="Close">×</button>
                </div>
                <p className="text-white/90 text-sm mt-3 font-medium">{profile?.parent?.name || 'Company'}</p>
              </div>
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-bold text-slate-900">{emp.name}</p>
                    <p className="text-sm text-slate-500">{emp.designation}{emp.department ? ` · ${emp.department}` : ''}</p>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {emp.panNumber && <span className="text-[10px] font-medium text-slate-400">PAN: {emp.panNumber}</span>}
                      {emp.uan && <span className="text-[10px] font-medium text-slate-400">UAN: {emp.uan}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-slate-500">Paid days</p>
                    <p className="text-lg font-bold text-slate-900">{slip.paidDays}<span className="text-sm font-normal text-slate-400">/{slip.workingDays}</span></p>
                    {slip.lopDays > 0 && <p className="text-[10px] text-rose-500">{slip.lopDays} LOP</p>}
                  </div>
                </div>
                {maskedAcct && (
                  <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-slate-400 text-sm">🏦</span>
                    <div>
                      <span className="text-xs font-semibold text-slate-700 font-mono">{maskedAcct}</span>
                      {emp.bankName && <span className="text-[10px] text-slate-400 ml-2">{emp.bankName}</span>}
                      {emp.bankIFSC && <span className="text-[10px] text-slate-400 ml-1">· {emp.bankIFSC}</span>}
                    </div>
                  </div>
                )}
              </div>
              <div className="px-6 py-5 overflow-y-auto space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Earnings</p>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between"><span className="text-slate-600">Basic Salary</span><span className="font-medium text-slate-900 tabular-nums">{fmt(slip.basic)}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">HRA</span><span className="font-medium text-slate-900 tabular-nums">{fmt(slip.hra)}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">Allowance</span><span className="font-medium text-slate-900 tabular-nums">{fmt(slip.allowance)}</span></li>
                      {slip.lopDeduction > 0 && <li className="flex justify-between"><span className="text-slate-600">LOP deduction</span><span className="font-medium text-rose-600 tabular-nums">−{fmt(slip.lopDeduction)}</span></li>}
                      <li className="flex justify-between pt-2 border-t border-slate-100"><span className="font-semibold text-slate-800">Gross</span><span className="font-semibold text-slate-900 tabular-nums">{fmt(slip.grossEarnings)}</span></li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Deductions</p>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between"><span className="text-slate-600">PF (12%)</span><span className="font-medium text-slate-900 tabular-nums">{fmt(slip.epf)}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">ESI</span><span className="font-medium text-slate-900 tabular-nums">{slip.esiEmployee > 0 ? fmt(slip.esiEmployee) : '—'}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">Prof. Tax</span><span className="font-medium text-slate-900 tabular-nums">{slip.pt > 0 ? fmt(slip.pt) : '—'}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">TDS</span><span className="font-medium text-slate-900 tabular-nums">{slip.tds > 0 ? fmt(slip.tds) : '—'}</span></li>
                      <li className="flex justify-between pt-2 border-t border-slate-100"><span className="font-semibold text-slate-800">Total</span><span className="font-semibold text-rose-600 tabular-nums">{fmt(slip.totalDeductions)}</span></li>
                    </ul>
                  </div>
                </div>
                <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-3.5 flex justify-between items-center">
                  <div>
                    <p className="text-indigo-200 text-[10px] font-semibold uppercase tracking-wider">Net Pay (Take Home)</p>
                    <p className="text-indigo-100 text-[10px] mt-0.5">{emp.taxRegime === 'old' ? 'Old Regime' : 'New Regime'} · CTC {fmt(emp.ctc)}/yr</p>
                  </div>
                  <span className="text-2xl font-bold text-white tabular-nums">{fmt(slip.netPay)}</span>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Employer contributions (not deducted from salary)</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'EPF Employer (12%)', value: slip.epfEmployer },
                      { label: 'EPS (8.33%)', value: slip.epsEmployer },
                      { label: 'EDLI (0.5%)', value: slip.edliEmployer },
                      { label: 'ESI Employer', value: slip.esiEmployer },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">{label}</span>
                        <span className="text-xs font-semibold text-slate-700 tabular-nums">{value > 0 ? fmt(value) : '—'}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between">
                    <span className="text-xs font-semibold text-slate-600">Total employer cost</span>
                    <span className="text-xs font-bold text-slate-900">{fmt(slip.totalEmployerCost)}</span>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3 shrink-0">
                <button onClick={() => setReportsSlipPreview(null)} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-slate-600 hover:bg-slate-200 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default PayrollEngine;
