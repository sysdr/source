import React, { useState, useMemo } from 'react';
import { Employee, CompanyProfile } from '../../types';
import { checkMinimumWage } from '../../services/payrollCalculator';

// ── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const fmt = (val?: number | null) =>
  (Number.isFinite(val) ? (val as number) : 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

const DEPARTMENTS = [
  'Engineering', 'Design', 'Marketing', 'Sales', 'Finance',
  'Operations', 'HR', 'Legal', 'Other',
];

const EMPTY_EMPLOYEE: Partial<Employee> = {
  name: '', designation: '', ctc: 0, doj: new Date().toISOString().split('T')[0],
  status: 'Onboarding', email: '', phone: '', gender: undefined, dateOfBirth: '',
  panNumber: '', aadhaarNumber: '', uan: '', esiNumber: '',
  bankAccountNumber: '', bankIFSC: '', bankName: '',
  department: '', employeeType: 'Full-time', reportingManager: '',
  fatherOrSpouseName: '', address: '', taxRegime: 'new',
  section80C: 0, section80D: 0, hraExemptionRent: 0,
  noticePeriodDays: 30, probationEndDate: '',
  documents: { pan: false, aadhaar: false, contract: false },
};

// ── Stat Card ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<{
  label: string; value: string; sub?: string; accent?: string; icon?: string;
}> = ({ label, value, sub, accent = 'text-slate-900', icon }) => (
  <div className="bg-white/80 backdrop-blur p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-slate-300/60 transition-all">
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-[11px] font-semibold text-slate-500 tracking-wide">{label}</p>
        <p className={`text-xl font-bold mt-0.5 ${accent}`}>{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
      </div>
      {icon && <span className="text-2xl opacity-60">{icon}</span>}
    </div>
  </div>
);

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  employees: Employee[];
  profile: CompanyProfile | null;
  payrollMonthlyNet: number;
  onUpsertEmployee: (emp: Employee) => void;
  onDeleteEmployee: (id: string) => void;
  toast: (type: 'success' | 'error' | 'info', text: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const EmployeeDirectory: React.FC<Props> = ({
  employees,
  profile,
  payrollMonthlyNet,
  onUpsertEmployee,
  onDeleteEmployee,
  toast,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({ ...EMPTY_EMPLOYEE });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'Active'),
    [employees],
  );

  const filteredEmployees = useMemo(() => {
    let list = employees;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          (e.department || '').toLowerCase().includes(q),
      );
    }
    if (statusFilter !== 'all') list = list.filter((e) => e.status === statusFilter);
    if (deptFilter !== 'all') list = list.filter((e) => e.department === deptFilter);
    return list;
  }, [employees, search, statusFilter, deptFilter]);

  const handleAddEmployee = () => {
    if (!newEmployee.name?.trim() || !newEmployee.email?.trim()) {
      toast('error', 'Name and Email are required');
      return;
    }
    if ((newEmployee.ctc ?? 0) <= 0) {
      toast('error', 'CTC must be greater than 0');
      return;
    }
    const emp: Employee = {
      ...EMPTY_EMPLOYEE as Employee,
      ...newEmployee as Employee,
      id: `EMP-${uid()}`,
    };
    onUpsertEmployee(emp);
    setShowAddModal(false);
    setNewEmployee({ ...EMPTY_EMPLOYEE });
    toast('success', `${emp.name} added successfully`);
  };

  const handleUpdateEmployee = () => {
    if (!editingEmployee) return;
    onUpsertEmployee(editingEmployee);
    setEditingEmployee(null);
    toast('success', 'Employee updated');
  };

  const handleDeleteEmployee = (id: string) => {
    onDeleteEmployee(id);
    setDeleteConfirm(null);
    toast('success', 'Employee removed');
  };

  return (
    <div className="space-y-6">
      {/* Filters + Add */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, department…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          <option value="all">All status</option>
          <option value="Active">Active</option>
          <option value="Onboarding">Onboarding</option>
          <option value="Inactive">Inactive</option>
          <option value="Notice">Notice</option>
          <option value="Exited">Exited</option>
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          <option value="all">All departments</option>
          {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500/40 transition-all shadow-sm"
        >
          <span>+</span> Add employee
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total employees" value={String(employees.length)} icon="👥" />
        <StatCard label="Active" value={String(activeEmployees.length)} accent="text-emerald-600" icon="✓" />
        <StatCard label="Onboarding" value={String(employees.filter((e) => e.status === 'Onboarding').length)} accent="text-amber-600" icon="📋" />
        <StatCard label="This month payout" value={fmt(payrollMonthlyNet)} accent="text-slate-900" sub="Preview for selected cycle" icon="₹" />
      </div>

      {/* Employee list */}
      <section className="bg-white/90 backdrop-blur rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Employee list</h3>
          <p className="text-xs text-slate-500 mt-0.5">{filteredEmployees.length} of {employees.length} shown</p>
        </div>
        <div className="divide-y divide-slate-100">
          {filteredEmployees.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              {employees.length === 0
                ? 'No employees yet. Add your first employee above.'
                : 'No employees match the current filters.'}
            </div>
          ) : filteredEmployees.map((emp) => {
            const { compliant } = checkMinimumWage(emp.ctc / 12, profile?.payroll.ptState || 'Maharashtra');
            const docs = [emp.documents.pan, emp.documents.aadhaar, emp.documents.contract].filter(Boolean).length;
            return (
              <div
                key={emp.id}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/80 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center text-sm font-semibold text-white shrink-0 ${
                      emp.status === 'Active' ? 'bg-emerald-500' :
                      emp.status === 'Onboarding' ? 'bg-amber-500' :
                      emp.status === 'Notice' ? 'bg-orange-500' : 'bg-slate-400'
                    }`}
                  >
                    {emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{emp.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {emp.designation}{emp.department ? ` · ${emp.department}` : ''} · {emp.employeeType || 'Full-time'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className="text-xs text-slate-400">CTC {fmt(emp.ctc)}</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${
                          emp.status === 'Active' ? 'bg-emerald-50 text-emerald-700' :
                          emp.status === 'Onboarding' ? 'bg-amber-50 text-amber-700' :
                          emp.status === 'Notice' ? 'bg-orange-50 text-orange-700' :
                          'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {emp.status}
                      </span>
                      {!compliant && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-rose-50 text-rose-600">
                          Below min wage
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-1.5" title="PAN · Aadhaar · Contract">
                    {[emp.documents.pan, emp.documents.aadhaar, emp.documents.contract].map((ok, i) => (
                      <span key={i} className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                    ))}
                    <span className="text-[10px] text-slate-400 ml-0.5">{docs}/3 docs</span>
                  </div>
                  <button
                    onClick={() => setEditingEmployee({ ...emp })}
                    className="px-3 py-2 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    Edit
                  </button>
                  {deleteConfirm === emp.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDeleteEmployee(emp.id)}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-rose-600 text-white hover:bg-rose-700"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-3 py-2 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(emp.id)}
                      className="px-3 py-2 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Add Employee Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-8 shadow-xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Add new employee</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >×</button>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Basic information</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Full name *</label>
                  <input type="text" value={newEmployee.name} onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })} placeholder="John Doe" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Email *</label>
                  <input type="email" value={newEmployee.email} onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })} placeholder="john@company.com" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Phone</label>
                  <input type="tel" value={newEmployee.phone} onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })} placeholder="+91 98765 43210" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Designation</label>
                  <input type="text" value={newEmployee.designation} onChange={(e) => setNewEmployee({ ...newEmployee, designation: e.target.value })} placeholder="Software Engineer" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Department</label>
                  <select value={newEmployee.department} onChange={(e) => setNewEmployee({ ...newEmployee, department: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
                    <option value="">Select</option>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Employee type</label>
                  <select value={newEmployee.employeeType} onChange={(e) => setNewEmployee({ ...newEmployee, employeeType: e.target.value as Employee['employeeType'] })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
                    <option value="Full-time">Full-time</option>
                    <option value="Part-time">Part-time</option>
                    <option value="Contract">Contract</option>
                    <option value="Intern">Intern</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Gender</label>
                  <select value={newEmployee.gender || ''} onChange={(e) => setNewEmployee({ ...newEmployee, gender: e.target.value as Employee['gender'] })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Date of birth</label>
                  <input type="date" value={newEmployee.dateOfBirth} onChange={(e) => setNewEmployee({ ...newEmployee, dateOfBirth: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Employment & compensation</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Annual CTC (INR) *</label>
                  <input type="number" value={newEmployee.ctc ?? ''} onChange={(e) => setNewEmployee({ ...newEmployee, ctc: Number(e.target.value) })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Date of joining *</label>
                  <input type="date" value={newEmployee.doj} onChange={(e) => setNewEmployee({ ...newEmployee, doj: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Tax regime</label>
                  <select value={newEmployee.taxRegime || 'new'} onChange={(e) => setNewEmployee({ ...newEmployee, taxRegime: e.target.value as 'new' | 'old' })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
                    <option value="new">New regime (FY25-26)</option>
                    <option value="old">Old regime</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Notice period (days)</label>
                  <input type="number" value={newEmployee.noticePeriodDays ?? 30} onChange={(e) => setNewEmployee({ ...newEmployee, noticePeriodDays: Number(e.target.value) })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Statutory identifiers</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">PAN</label>
                  <input type="text" value={newEmployee.panNumber} onChange={(e) => setNewEmployee({ ...newEmployee, panNumber: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30 uppercase" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Aadhaar</label>
                  <input type="text" value={newEmployee.aadhaarNumber} onChange={(e) => setNewEmployee({ ...newEmployee, aadhaarNumber: e.target.value })} placeholder="1234 5678 9012" maxLength={14} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">UAN (EPF)</label>
                  <input type="text" value={newEmployee.uan} onChange={(e) => setNewEmployee({ ...newEmployee, uan: e.target.value })} placeholder="100000000000" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">ESI number</label>
                  <input type="text" value={newEmployee.esiNumber} onChange={(e) => setNewEmployee({ ...newEmployee, esiNumber: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Bank account</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Bank name</label>
                  <input type="text" value={newEmployee.bankName} onChange={(e) => setNewEmployee({ ...newEmployee, bankName: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Account number</label>
                  <input type="text" value={newEmployee.bankAccountNumber} onChange={(e) => setNewEmployee({ ...newEmployee, bankAccountNumber: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">IFSC</label>
                  <input type="text" value={newEmployee.bankIFSC} onChange={(e) => setNewEmployee({ ...newEmployee, bankIFSC: e.target.value.toUpperCase() })} placeholder="SBIN0001234" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30 uppercase" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Documents collected</p>
              <div className="flex gap-6">
                {(['pan', 'aadhaar', 'contract'] as const).map((doc) => (
                  <label key={doc} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={newEmployee.documents?.[doc] ?? false}
                      onChange={(e) => setNewEmployee({ ...newEmployee, documents: { ...newEmployee.documents!, [doc]: e.target.checked } })}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {doc === 'pan' ? 'PAN' : doc === 'aadhaar' ? 'Aadhaar' : 'Contract'}
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleAddEmployee}
              className="w-full py-3.5 rounded-xl font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500/40 transition-colors"
            >
              Add employee
            </button>
          </div>
        </div>
      )}

      {/* ── Edit Employee Modal ── */}
      {editingEmployee && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-8 shadow-xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">Edit employee</h3>
              <button
                onClick={() => setEditingEmployee(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >×</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Full name</label>
                <input type="text" value={editingEmployee.name} onChange={(e) => setEditingEmployee({ ...editingEmployee, name: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Email</label>
                <input type="email" value={editingEmployee.email} onChange={(e) => setEditingEmployee({ ...editingEmployee, email: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Phone</label>
                <input type="tel" value={editingEmployee.phone || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, phone: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Designation</label>
                <input type="text" value={editingEmployee.designation} onChange={(e) => setEditingEmployee({ ...editingEmployee, designation: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Department</label>
                <select value={editingEmployee.department || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, department: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
                  <option value="">Select</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Annual CTC</label>
                <input type="number" value={editingEmployee.ctc} onChange={(e) => setEditingEmployee({ ...editingEmployee, ctc: Number(e.target.value) })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Date of joining</label>
                <input type="date" value={editingEmployee.doj} onChange={(e) => setEditingEmployee({ ...editingEmployee, doj: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Status</label>
                <select value={editingEmployee.status} onChange={(e) => setEditingEmployee({ ...editingEmployee, status: e.target.value as Employee['status'] })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
                  <option value="Active">Active</option>
                  <option value="Onboarding">Onboarding</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Notice">Notice</option>
                  <option value="Exited">Exited</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Tax regime</label>
                <select value={editingEmployee.taxRegime || 'new'} onChange={(e) => setEditingEmployee({ ...editingEmployee, taxRegime: e.target.value as 'new' | 'old' })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
                  <option value="new">New regime</option>
                  <option value="old">Old regime</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Employee type</label>
                <select value={editingEmployee.employeeType || 'Full-time'} onChange={(e) => setEditingEmployee({ ...editingEmployee, employeeType: e.target.value as Employee['employeeType'] })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
                  <option value="Full-time">Full-time</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Contract">Contract</option>
                  <option value="Intern">Intern</option>
                </select>
              </div>

              {/* Statutory IDs */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">PAN</label>
                <input type="text" value={editingEmployee.panNumber || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, panNumber: e.target.value.toUpperCase() })} maxLength={10} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30 uppercase" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Aadhaar</label>
                <input type="text" value={editingEmployee.aadhaarNumber || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, aadhaarNumber: e.target.value })} maxLength={14} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">UAN</label>
                <input type="text" value={editingEmployee.uan || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, uan: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">ESI number</label>
                <input type="text" value={editingEmployee.esiNumber || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, esiNumber: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>

              {/* Bank */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Bank name</label>
                <input type="text" value={editingEmployee.bankName || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, bankName: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Account number</label>
                <input type="text" value={editingEmployee.bankAccountNumber || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, bankAccountNumber: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">IFSC</label>
                <input type="text" value={editingEmployee.bankIFSC || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, bankIFSC: e.target.value.toUpperCase() })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30 uppercase" />
              </div>

              {/* Investment declarations */}
              <div className="col-span-2 p-4 rounded-xl bg-indigo-50/80 border border-indigo-100">
                <p className="text-xs font-semibold text-indigo-900 uppercase tracking-wider mb-2">Investment declarations</p>
                <p className="text-xs text-indigo-800 mb-3">Used to reduce income tax (TDS) when tax regime is <strong>Old</strong>. Also editable from Payroll → Declarations tab.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">Sec 80C (₹) — max 1,50,000</label>
                    <input type="number" min={0} max={150000} value={editingEmployee.section80C ?? ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, section80C: e.target.value === '' ? undefined : Math.min(150000, Number(e.target.value)) })} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" placeholder="PPF, LIC, ELSS…" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">Sec 80D (₹) — max 25,000</label>
                    <input type="number" min={0} max={25000} value={editingEmployee.section80D ?? ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, section80D: e.target.value === '' ? undefined : Math.min(25000, Number(e.target.value)) })} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" placeholder="Health insurance" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">Monthly rent paid (₹) — HRA</label>
                    <input type="number" min={0} value={editingEmployee.hraExemptionRent ?? ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, hraExemptionRent: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30" placeholder="For HRA exemption" />
                  </div>
                </div>
                {editingEmployee.taxRegime !== 'old' && (
                  <p className="text-xs text-amber-700 mt-2">Switch to <strong>Old</strong> tax regime above for these declarations to reduce TDS.</p>
                )}
              </div>

              {/* Documents */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-2">Documents collected</label>
                <div className="flex gap-6">
                  {(['pan', 'aadhaar', 'contract'] as const).map((doc) => (
                    <label key={doc} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={editingEmployee.documents?.[doc] ?? false}
                        onChange={(e) => setEditingEmployee({ ...editingEmployee, documents: { ...editingEmployee.documents, [doc]: e.target.checked } })}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      {doc === 'pan' ? 'PAN' : doc === 'aadhaar' ? 'Aadhaar' : 'Contract'}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleUpdateEmployee}
              className="w-full py-3.5 rounded-xl font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500/40 transition-colors"
            >
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeDirectory;
