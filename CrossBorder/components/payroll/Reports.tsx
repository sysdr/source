import React, { useMemo } from 'react';
import { Employee, CompanyProfile, PayrollRun } from '../../types';
import { computeFullSalary, computeYTD, YTDSummary, MONTHS } from '../../services/payrollCalculator';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (val?: number | null) =>
  (Number.isFinite(val) ? (val as number) : 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

const MONTH_ORDER = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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
  allRuns: PayrollRun[];
  selectedMonth: string;
  selectedYear: number;
  onSlipPreview: (emp: Employee, slip: ReturnType<typeof computeFullSalary>) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const Reports: React.FC<Props> = ({
  employees,
  profile,
  allRuns,
  selectedMonth,
  selectedYear,
  onSlipPreview,
}) => {
  const activeEmployees = useMemo(() => employees.filter((e) => e.status === 'Active'), [employees]);

  const ytdSummaries = useMemo((): YTDSummary[] => {
    const allSlips = allRuns.flatMap((r) => r.employeeSlips);
    return employees.map((emp) => computeYTD(emp.id, emp.name, allSlips));
  }, [allRuns, employees]);

  // Monthly payroll trend (last 12 processed runs)
  const sortedRuns = useMemo(
    () =>
      [...allRuns]
        .sort((a, b) => {
          if (a.year !== b.year) return a.year - b.year;
          return MONTH_ORDER.indexOf(a.month) - MONTH_ORDER.indexOf(b.month);
        })
        .slice(-12),
    [allRuns],
  );
  const maxNet = Math.max(...sortedRuns.map((r) => r.totalNet), 1);

  // Department breakdown
  const deptMap: Record<string, { count: number; ctc: number }> = {};
  for (const emp of employees) {
    const dept = emp.department || 'Other';
    if (!deptMap[dept]) deptMap[dept] = { count: 0, ctc: 0 };
    deptMap[dept].count += 1;
    deptMap[dept].ctc += emp.ctc;
  }
  const deptEntries = Object.entries(deptMap).sort((a, b) => b[1].ctc - a[1].ctc);
  const maxDeptCTC = Math.max(...deptEntries.map(([, d]) => d.ctc), 1);

  // Statutory aggregate across all runs
  const statTotals = allRuns.reduce(
    (acc, run) => {
      for (const s of run.employeeSlips) {
        acc.epf += s.epf + (s.epfEmployer ?? 0);
        acc.esi += (s.esiEmployee ?? 0) + (s.esiEmployer ?? 0);
        acc.pt += s.pt;
        acc.tds += s.tds;
        acc.net += s.netPay;
      }
      return acc;
    },
    { epf: 0, esi: 0, pt: 0, tds: 0, net: 0 },
  );

  // Top earners
  const topEarners = [...ytdSummaries]
    .sort((a, b) => b.totalGross - a.totalGross)
    .slice(0, 6);

  return (
    <div className="space-y-8">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total payroll runs" value={String(allRuns.length)} icon="📋" sub={`${activeEmployees.length} active employees`} />
        <StatCard label="Cumulative net paid" value={fmt(statTotals.net)} accent="text-indigo-600" icon="₹" sub="All time" />
        <StatCard label="EPF + ESI (all time)" value={fmt(statTotals.epf + statTotals.esi)} icon="🏛" sub="Employee + employer" />
        <StatCard label="TDS deducted (all time)" value={fmt(statTotals.tds)} accent="text-rose-600" icon="📄" sub="Income tax on salary" />
      </div>

      {/* Monthly cost trend */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-b from-indigo-50/60 to-white">
          <h3 className="text-base font-bold text-slate-900">Monthly payroll cost</h3>
          <p className="text-xs text-slate-500 mt-0.5">Net salary disbursed per payroll run (last 12)</p>
        </div>
        <div className="px-6 py-6">
          {sortedRuns.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No payroll runs yet. Run your first payroll to see trends.</p>
          ) : (
            <div className="flex items-end gap-2 h-48 overflow-x-auto pb-2">
              {sortedRuns.map((run) => {
                const pct = Math.max(4, Math.round((run.totalNet / maxNet) * 100));
                return (
                  <div key={run.id} className="flex flex-col items-center gap-2 flex-shrink-0 min-w-[52px]">
                    <span className="text-[10px] font-semibold text-indigo-700 tabular-nums">
                      {(run.totalNet / 100000).toFixed(1)}L
                    </span>
                    <div
                      className="w-10 rounded-t-lg bg-gradient-to-t from-indigo-600 to-indigo-400 hover:from-indigo-700 hover:to-indigo-500 transition-colors cursor-default group relative"
                      style={{ height: `${pct}%` }}
                      title={`${run.month} ${run.year}: ${fmt(run.totalNet)}`}
                    >
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] font-medium px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {fmt(run.totalNet)}
                      </div>
                    </div>
                    <span className="text-[9px] font-medium text-slate-400 text-center leading-tight">
                      {run.month.slice(0, 3)}<br />{String(run.year).slice(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department breakdown */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Department headcount & CTC</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {deptEntries.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No employee data</p>
            ) : deptEntries.map(([dept, data]) => {
              const pct = Math.round((data.ctc / maxDeptCTC) * 100);
              return (
                <div key={dept} className="px-6 py-3.5 hover:bg-slate-50/60 transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-800">{dept}</span>
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{data.count}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-700 tabular-nums">{fmt(data.ctc)}/yr</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Statutory contributions summary */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Cumulative statutory contributions</h3>
            <p className="text-xs text-slate-500 mt-0.5">Across all payroll runs</p>
          </div>
          <div className="p-6 space-y-4">
            {[
              { label: 'EPF (Employee + Employer)', value: statTotals.epf, color: 'bg-indigo-500', note: '12% + 12% of basic' },
              { label: 'ESI (Employee + Employer)', value: statTotals.esi, color: 'bg-violet-500', note: '0.75% + 3.25% of gross' },
              { label: 'Professional Tax', value: statTotals.pt, color: 'bg-amber-500', note: 'State-wise slab' },
              { label: 'TDS (Income Tax)', value: statTotals.tds, color: 'bg-rose-500', note: 'Sec 192' },
            ].map(({ label, value, color, note }) => {
              const total = statTotals.epf + statTotals.esi + statTotals.pt + statTotals.tds || 1;
              const pct = Math.round((value / total) * 100);
              return (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-sm font-medium text-slate-700">{label}</span>
                      <span className="text-[10px] text-slate-400 ml-1.5">{note}</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">{fmt(value)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t border-slate-100 flex justify-between">
              <span className="text-sm font-semibold text-slate-700">Total statutory outflow</span>
              <span className="text-sm font-bold text-slate-900">{fmt(statTotals.epf + statTotals.esi + statTotals.pt + statTotals.tds)}</span>
            </div>
          </div>
        </section>
      </div>

      {/* YTD summary table */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">YTD payslip summary</h3>
            <p className="text-xs text-slate-500 mt-0.5">Year-to-date totals per employee across all processed payroll runs</p>
          </div>
          <span className="text-xs font-medium text-slate-400">{ytdSummaries.length} employees</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-5 py-3.5 text-left font-semibold text-slate-600">Employee</th>
                <th className="px-4 py-3.5 font-semibold text-slate-600 text-right">YTD Gross</th>
                <th className="px-4 py-3.5 font-semibold text-slate-600 text-right">YTD Net</th>
                <th className="px-4 py-3.5 font-semibold text-slate-600 text-right">YTD EPF</th>
                <th className="px-4 py-3.5 font-semibold text-slate-600 text-right">YTD TDS</th>
                <th className="px-4 py-3.5 font-semibold text-slate-600 text-right">Runs</th>
                <th className="px-4 py-3.5 font-semibold text-slate-600 text-center">Payslip</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ytdSummaries.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-slate-400">No payroll history yet.</td></tr>
              ) : ytdSummaries.map((ytd) => {
                const emp = employees.find((e) => e.id === ytd.employeeId);
                if (!emp) return null;
                const config = profile?.payroll || { pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22 };
                const currentSlip = computeFullSalary(emp, config, selectedMonth, selectedYear, 0);
                return (
                  <tr key={ytd.employeeId} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-slate-900">{ytd.employeeName}</p>
                      <p className="text-xs text-slate-400">{emp.designation} · {emp.department || '—'}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-slate-700 tabular-nums">{fmt(ytd.totalGross)}</td>
                    <td className="px-4 py-3.5 text-right font-bold text-slate-900 tabular-nums">{fmt(ytd.totalNet)}</td>
                    <td className="px-4 py-3.5 text-right text-rose-600 tabular-nums">{fmt(ytd.totalEPF)}</td>
                    <td className="px-4 py-3.5 text-right text-rose-600 tabular-nums">{fmt(ytd.totalTDS)}</td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">{ytd.monthsProcessed}</span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <button
                        onClick={() => onSlipPreview(emp, currentSlip)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 transition-colors"
                      >
                        Preview
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top earners */}
      {topEarners.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Top earners (YTD gross)</h3>
          </div>
          <div className="p-6 grid grid-cols-2 md:grid-cols-3 gap-4">
            {topEarners.map((ytd, i) => {
              const emp = employees.find((e) => e.id === ytd.employeeId);
              return (
                <div key={ytd.employeeId} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-indigo-200 transition-colors">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0 ${
                      i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-indigo-400'
                    }`}
                  >
                    {i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{ytd.employeeName}</p>
                    <p className="text-xs text-slate-500">{emp?.department || '—'}</p>
                    <p className="text-xs font-bold text-indigo-600 tabular-nums">{fmt(ytd.totalGross)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

export default Reports;
