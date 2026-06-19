import React, { useState } from 'react';
import { Employee, LeaveRequest, LeavePolicy } from '../../types';
import {
  addLeaveRequest, updateLeaveRequest, getLeaveBalance, setLeavePolicies,
} from '../../services/storageService';

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const now = () => new Date();
const currentYear = () => now().getFullYear();

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  leavePolicies: LeavePolicy[];
  setLeaveRequestsState: React.Dispatch<React.SetStateAction<LeaveRequest[]>>;
  setLeavePoliciesState: React.Dispatch<React.SetStateAction<LeavePolicy[]>>;
  toast: (type: 'success' | 'error' | 'info', text: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const LeaveManagement: React.FC<Props> = ({
  employees,
  leaveRequests,
  leavePolicies,
  setLeaveRequestsState,
  setLeavePoliciesState,
  toast,
}) => {
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [newLeave, setNewLeave] = useState({
    employeeId: '', type: 'CL', fromDate: '', toDate: '', reason: '',
  });

  const activeEmployees = employees.filter((e) => e.status === 'Active');

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleAddLeave = () => {
    if (!newLeave.employeeId || !newLeave.fromDate || !newLeave.toDate) {
      toast('error', 'Fill all required fields');
      return;
    }
    const from = new Date(newLeave.fromDate);
    const to = new Date(newLeave.toDate);
    if (to < from) { toast('error', 'End date must be after start date'); return; }
    const days = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const request: LeaveRequest = {
      id: `LR-${uid()}`,
      employeeId: newLeave.employeeId,
      type: newLeave.type,
      fromDate: newLeave.fromDate,
      toDate: newLeave.toDate,
      days,
      reason: newLeave.reason,
      status: 'Pending',
      appliedAt: new Date().toISOString(),
    };
    addLeaveRequest(request);
    setLeaveRequestsState((prev) => [request, ...prev]);
    setShowLeaveModal(false);
    setNewLeave({ employeeId: '', type: 'CL', fromDate: '', toDate: '', reason: '' });
    toast('success', `Leave request created (${days} days)`);
  };

  const handleLeaveAction = (id: string, status: 'Approved' | 'Rejected') => {
    updateLeaveRequest(id, { status, reviewedAt: new Date().toISOString(), reviewedBy: 'Admin' });
    setLeaveRequestsState((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status, reviewedAt: new Date().toISOString(), reviewedBy: 'Admin' }
          : r,
      ),
    );
    toast('success', `Leave ${status.toLowerCase()}`);
  };

  const handleUpdatePolicy = (idx: number, field: keyof LeavePolicy, value: unknown) => {
    const updated = [...leavePolicies];
    (updated[idx] as any)[field] = value;
    setLeavePoliciesState(updated);
    setLeavePolicies(updated);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h3 className="text-sm font-semibold text-slate-800">Leave management</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPolicyModal(true)}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            Policies
          </button>
          <button
            onClick={() => setShowLeaveModal(true)}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            + Apply leave
          </button>
        </div>
      </div>

      {/* Leave balance cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeEmployees.map((emp) => {
          const bal = getLeaveBalance(emp.id, currentYear());
          return (
            <div key={emp.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <p className="font-medium text-slate-900 text-sm">{emp.name}</p>
              <div className="mt-4 space-y-3">
                {leavePolicies.filter((p) => p.annualQuota > 0).map((p) => {
                  const b = bal.balances[p.type] || { total: p.annualQuota, used: 0, remaining: p.annualQuota };
                  const pct = b.total > 0 ? (b.used / b.total) * 100 : 0;
                  return (
                    <div key={p.type} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-slate-500 w-8">{p.type}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-rose-400' : pct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-slate-600 w-12 text-right">{b.used}/{b.total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent requests */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h4 className="text-sm font-semibold text-slate-800">Recent requests</h4>
        </div>
        {leaveRequests.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-500 text-sm">No leave requests yet</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {leaveRequests.slice(0, 20).map((lr) => {
              const emp = employees.find((e) => e.id === lr.employeeId);
              return (
                <li key={lr.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        lr.status === 'Pending' ? 'bg-amber-400' :
                        lr.status === 'Approved' ? 'bg-emerald-500' : 'bg-rose-400'
                      }`}
                    />
                    <div>
                      <p className="font-medium text-slate-900 text-sm">{emp?.name ?? lr.employeeId}</p>
                      <p className="text-xs text-slate-500">
                        {lr.type} · {lr.days} day{lr.days !== 1 ? 's' : ''} · {lr.fromDate} – {lr.toDate}
                      </p>
                      {lr.reason && <p className="text-xs text-slate-400 mt-0.5">{lr.reason}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {lr.status === 'Pending' ? (
                      <>
                        <button
                          onClick={() => handleLeaveAction(lr.id, 'Approved')}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleLeaveAction(lr.id, 'Rejected')}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-600 hover:bg-rose-100"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <span
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                          lr.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                        }`}
                      >
                        {lr.status}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Apply Leave Modal ── */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-2xl p-8 shadow-xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Apply leave</h3>
              <button
                onClick={() => setShowLeaveModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Employee</label>
                <select
                  value={newLeave.employeeId}
                  onChange={(e) => setNewLeave({ ...newLeave, employeeId: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  <option value="">Select employee</option>
                  {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Leave type</label>
                <select
                  value={newLeave.type}
                  onChange={(e) => setNewLeave({ ...newLeave, type: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  {leavePolicies.map((p) => <option key={p.type} value={p.type}>{p.name} ({p.type})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">From</label>
                  <input
                    type="date"
                    value={newLeave.fromDate}
                    onChange={(e) => setNewLeave({ ...newLeave, fromDate: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">To</label>
                  <input
                    type="date"
                    value={newLeave.toDate}
                    onChange={(e) => setNewLeave({ ...newLeave, toDate: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Reason</label>
                <textarea
                  value={newLeave.reason}
                  onChange={(e) => setNewLeave({ ...newLeave, reason: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
                />
              </div>
              <button
                onClick={handleAddLeave}
                className="w-full py-3.5 rounded-xl font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500/40 transition-colors"
              >
                Submit request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Leave Policy Modal ── */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-2xl p-8 shadow-xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Leave policies</h3>
              <button
                onClick={() => setShowPolicyModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >×</button>
            </div>
            <div className="space-y-4">
              {leavePolicies.map((p, i) => (
                <div key={p.type} className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="font-semibold text-slate-900 text-sm mb-3">{p.name} ({p.type})</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Annual quota</label>
                      <input
                        type="number"
                        value={p.annualQuota}
                        onChange={(e) => handleUpdatePolicy(i, 'annualQuota', Number(e.target.value))}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Max carry forward</label>
                      <input
                        type="number"
                        value={p.maxCarryForward}
                        onChange={(e) => handleUpdatePolicy(i, 'maxCarryForward', Number(e.target.value))}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mt-3 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={p.carryForward}
                      onChange={(e) => handleUpdatePolicy(i, 'carryForward', e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Allow carry forward
                  </label>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowPolicyModal(false)}
              className="w-full py-3.5 rounded-xl font-semibold text-sm bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveManagement;
