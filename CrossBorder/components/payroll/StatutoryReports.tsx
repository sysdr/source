import React from 'react';
import { Employee, CompanyProfile, PayrollRun } from '../../types';
import { getPayrollRunForCycle } from '../../services/storageService';
import { MONTHS } from '../../services/payrollCalculator';
import {
  generateForm24QCSV, generatePFECR, generateESIReturn, generatePTChallan,
  generateBankFile, generateForm16PDF,
} from '../../services/statutoryReports';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  employees: Employee[];
  profile: CompanyProfile | null;
  allRuns: PayrollRun[];
  selectedMonth: string;
  selectedYear: number;
  setSelectedMonth: (v: string) => void;
  setSelectedYear: (v: number) => void;
  selectedQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  setSelectedQuarter: (v: 'Q1' | 'Q2' | 'Q3' | 'Q4') => void;
  selectedFY: string;
  setSelectedFY: (v: string) => void;
  toast: (type: 'success' | 'error' | 'info', text: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const StatutoryReports: React.FC<Props> = ({
  employees,
  profile,
  allRuns,
  selectedMonth,
  selectedYear,
  setSelectedMonth,
  setSelectedYear,
  selectedQuarter,
  setSelectedQuarter,
  selectedFY,
  setSelectedFY,
  toast,
}) => {
  const [form16Employee, setForm16Employee] = React.useState<string>('');

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleForm24Q = () => {
    if (!profile) return;
    generateForm24QCSV(employees, allRuns, selectedQuarter, selectedFY, profile);
    toast('success', `Form 24Q ${selectedQuarter} exported`);
  };

  const handlePFECR = () => {
    const run = getPayrollRunForCycle(selectedMonth, selectedYear);
    if (!run) { toast('error', `No payroll run found for ${selectedMonth} ${selectedYear}`); return; }
    if (!profile) return;
    generatePFECR(employees, run, profile);
    toast('success', 'PF ECR file generated');
  };

  const handleESIReturn = () => {
    const run = getPayrollRunForCycle(selectedMonth, selectedYear);
    if (!run) { toast('error', `No payroll run found for ${selectedMonth} ${selectedYear}`); return; }
    generateESIReturn(employees, run);
    toast('success', 'ESI Return exported');
  };

  const handlePTChallan = () => {
    const run = getPayrollRunForCycle(selectedMonth, selectedYear);
    if (!run) { toast('error', `No payroll run found for ${selectedMonth} ${selectedYear}`); return; }
    if (!profile) return;
    generatePTChallan(employees, run, profile);
    toast('success', 'PT Challan exported');
  };

  const handleBankFile = () => {
    const run = getPayrollRunForCycle(selectedMonth, selectedYear);
    if (!run) { toast('error', `No payroll run found for ${selectedMonth} ${selectedYear}`); return; }
    if (!profile) return;
    generateBankFile(employees, run, profile);
    toast('success', 'Bank payment file generated');
  };

  const handleForm16 = () => {
    if (!form16Employee || !profile) { toast('error', 'Select an employee'); return; }
    const emp = employees.find((e) => e.id === form16Employee);
    if (!emp) return;
    const [fyStart] = selectedFY.split('-').map(Number);
    const fyRuns = allRuns.filter((r) => {
      const monthIdx = MONTHS.indexOf(r.month);
      if (monthIdx >= 3) return r.year === fyStart; // Apr-Dec
      return r.year === fyStart + 1; // Jan-Mar
    });
    generateForm16PDF(emp, fyRuns, selectedFY, profile);
    toast('success', `Form 16 generated for ${emp.name}`);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="w-px h-8 bg-slate-200" />
        <select
          value={selectedQuarter}
          onChange={(e) => setSelectedQuarter(e.target.value as 'Q1' | 'Q2' | 'Q3' | 'Q4')}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          <option value="Q1">Q1 (Apr–Jun)</option>
          <option value="Q2">Q2 (Jul–Sep)</option>
          <option value="Q3">Q3 (Oct–Dec)</option>
          <option value="Q4">Q4 (Jan–Mar)</option>
        </select>
        <select
          value={selectedFY}
          onChange={(e) => setSelectedFY(e.target.value)}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          <option value="2024-25">FY 2024-25</option>
          <option value="2025-26">FY 2025-26</option>
          <option value="2026-27">FY 2026-27</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* TDS on salary */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <h3 className="text-sm font-semibold text-slate-800">TDS on salary</h3>
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Form 24Q (quarterly)</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">{selectedQuarter} · FY {selectedFY}</p>
              </div>
              <button
                onClick={handleForm24Q}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shrink-0"
              >
                Export CSV
              </button>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Form 16 (annual)</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">FY {selectedFY}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <select
                  value={form16Employee}
                  onChange={(e) => setForm16Employee(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none flex-1 min-w-[120px]"
                >
                  <option value="">Select employee</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <button
                  onClick={handleForm16}
                  disabled={!form16Employee}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
                >
                  Generate PDF
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* PF & ESI */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <h3 className="text-sm font-semibold text-slate-800">PF & ESI</h3>
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">PF ECR return</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">
                  {profile?.payroll.pfEnabled ? `${selectedMonth} ${selectedYear}` : 'N/A – PF exempt'}
                </p>
              </div>
              <button
                onClick={handlePFECR}
                disabled={!profile?.payroll.pfEnabled}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0"
              >
                Generate ECR
              </button>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">ESI monthly return</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">
                  {profile?.payroll.esiEnabled ? `${selectedMonth} ${selectedYear}` : 'N/A – ESI exempt'}
                </p>
              </div>
              <button
                onClick={handleESIReturn}
                disabled={!profile?.payroll.esiEnabled}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0"
              >
                Export CSV
              </button>
            </div>
          </div>
        </section>

        {/* Professional tax & reports */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <h3 className="text-sm font-semibold text-slate-800">Professional tax & reports</h3>
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">PT monthly challan</p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">{selectedMonth} {selectedYear} · {profile?.payroll.ptState}</p>
              </div>
              <button
                onClick={handlePTChallan}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shrink-0"
              >
                Export CSV
              </button>
            </div>
          </div>
        </section>

        {/* Bank & payments */}
        <section className="bg-emerald-800 p-6 rounded-2xl border border-emerald-700/50 text-white space-y-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -mr-12 -mt-12" />
          <h3 className="text-sm font-semibold text-emerald-100">Bank & payments</h3>
          <div className="relative space-y-4">
            <div className="p-4 rounded-xl bg-emerald-700/50 border border-emerald-600/50">
              <p className="text-xs font-medium text-emerald-200 uppercase tracking-wide">NEFT batch payment file</p>
              <p className="text-sm font-medium text-white mt-0.5">{selectedMonth} {selectedYear}</p>
              <button
                onClick={handleBankFile}
                className="mt-3 px-4 py-2 rounded-xl text-xs font-semibold bg-white text-emerald-800 hover:bg-emerald-50 transition-colors"
              >
                Generate bank file
              </button>
            </div>
            <p className="text-xs text-emerald-200/90 leading-relaxed">
              Bank file includes employee name, account number, IFSC, and net salary. Ensure bank details are updated in employee profiles.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default StatutoryReports;
