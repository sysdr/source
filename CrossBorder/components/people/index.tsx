/**
 * People module — employee management.
 * REQ: REQ-082, REQ-083, REQ-084, REQ-086, REQ-089
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { CompanyProfile, Employee, LeavePolicy, LeaveRequest } from '../../types';
import {
  getCompanyProfile,
  getLeavePolicies,
  getLeaveRequests,
  getUIState,
  setUIState,
  StorageKeys,
} from '../../services/storageService';
import { MONTHS, computeFullSalary } from '../../services/payrollCalculator';
import { useEmployees, useUpsertEmployee, useDeleteEmployee } from '../../hooks/useEmployees';
import { canHardDeleteEmployee } from '../../services/employeeLifecycle';
import { getPayrollRuns } from '../../services/storageService';
import EmployeeDirectory from '../payroll/EmployeeDirectory';
import LeaveManagement from '../payroll/LeaveManagement';
import EmployeeProfile from './EmployeeProfile';
import AttendanceCalendar from './AttendanceCalendar';

type TabId = 'directory' | 'profile' | 'attendance' | 'leaves';
type ToastType = 'success' | 'error' | 'info';
interface ToastMessage { id: string; type: ToastType; text: string }

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const now = () => new Date();
const currentMonth = () => MONTHS[now().getMonth()];
const currentYear = () => now().getFullYear();

const Toast: React.FC<{ toasts: ToastMessage[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[200] space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`px-5 py-3 rounded-xl text-sm font-medium shadow-lg cursor-pointer ${
            t.type === 'success' ? 'bg-emerald-600 text-white' :
            t.type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-700 text-white'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
};

const PeopleModule: React.FC = () => {
  const [profile] = useState<CompanyProfile | null>(() => getCompanyProfile());
  const { data: employees = [] } = useEmployees();
  const upsertMutation = useUpsertEmployee();
  const deleteMutation = useDeleteEmployee();

  const [leaveRequests, setLeaveRequestsState] = useState<LeaveRequest[]>(() => getLeaveRequests());
  const [leavePolicies, setLeavePoliciesState] = useState<LeavePolicy[]>(() => getLeavePolicies());
  const [activeTab, setActiveTab] = useState<TabId>(
    () => getUIState(StorageKeys.UI_PAYROLL_TAB, 'directory' as TabId) as TabId,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((type: ToastType, text: string) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  useEffect(() => {
    if (activeTab === 'directory' || activeTab === 'leaves' || activeTab === 'attendance' || activeTab === 'profile') {
      setUIState(StorageKeys.UI_PAYROLL_TAB, activeTab);
    }
  }, [activeTab]);

  const handleUpsert = useCallback((emp: Employee) => {
    upsertMutation.mutate(emp);
  }, [upsertMutation]);

  const handleDelete = useCallback((id: string) => {
    const gate = canHardDeleteEmployee(id, getPayrollRuns());
    if (gate.ok === false) {
      toast('error', gate.message);
      return;
    }
    deleteMutation.mutate(id);
  }, [deleteMutation, toast]);

  const selected = employees.find((e) => e.id === selectedId) || null;
  const payrollConfig = profile?.payroll || {
    pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22,
  };
  const directoryMonthlyNet = employees
    .filter((e) => e.status === 'Active')
    .reduce((sum, emp) => sum + computeFullSalary(emp, payrollConfig, currentMonth(), currentYear(), 0).netPay, 0);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'directory', label: 'Directory' },
    { id: 'profile', label: 'Profile' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'leaves', label: 'Leaves' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Toast toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />

      <header className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">People</h1>
            <p className="text-sm text-slate-500 mt-1 max-w-xl">
              Employee master, attendance, and leave — payroll runs stay under Payroll.
              <span className="text-emerald-600 font-medium ml-1">{employees.length} people</span>
            </p>
          </div>
          <nav className="flex flex-wrap gap-1 p-1.5 bg-slate-100 rounded-2xl border border-slate-200/80">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === t.id
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {activeTab === 'directory' && (
        <div className="space-y-4">
          <EmployeeDirectory
            employees={employees}
            profile={profile}
            payrollMonthlyNet={directoryMonthlyNet}
            onUpsertEmployee={handleUpsert}
            onDeleteEmployee={handleDelete}
            toast={toast}
          />
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-slate-600 mb-2">Open profile</p>
            <div className="flex flex-wrap gap-2">
              {employees.slice(0, 24).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => { setSelectedId(e.id); setActiveTab('profile'); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-50 hover:bg-emerald-50 text-slate-700"
                >
                  {e.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'profile' && (
        selected ? (
          <EmployeeProfile
            employee={selected}
            onUpsert={handleUpsert}
            onDelete={handleDelete}
            onBack={() => setActiveTab('directory')}
            toast={toast}
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
            Select a person from Directory to open their profile.
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {employees.slice(0, 12).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelectedId(e.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-emerald-50"
                >
                  {e.name}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {activeTab === 'attendance' && (
        <AttendanceCalendar employees={employees} toast={toast} />
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
    </div>
  );
};

export default PeopleModule;
