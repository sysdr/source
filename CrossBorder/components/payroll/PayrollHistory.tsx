import React, { useState, useMemo } from 'react';
import { Employee, PayrollRun } from '../../types';
import { computeYTD, YTDSummary } from '../../services/payrollCalculator';

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
  allRuns: PayrollRun[];
}

// ── Component ─────────────────────────────────────────────────────────────────

const PayrollHistory: React.FC<Props> = ({ employees, allRuns }) => {
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const ytdSummaries = useMemo((): YTDSummary[] => {
    const allSlips = allRuns.flatMap((r) => r.employeeSlips);
    return employees.map((emp) => computeYTD(emp.id, emp.name, allSlips));
  }, [allRuns, employees]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Payroll history list */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">Payroll history</h3>
          {allRuns.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
              No payroll runs yet. Process your first run from the Payroll tab.
            </div>
          ) : (
            <ul className="space-y-3">
              {allRuns.map((run) => (
                <li key={run.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <button
                    onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                    className="w-full px-5 py-4 flex justify-between items-center hover:bg-slate-50/80 transition-colors text-left"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{run.month} {run.year}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {run.employeeCount} employees · Processed {new Date(run.runAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-900">{fmt(run.totalNet)}</p>
                      <p className="text-xs text-slate-500">Statutory {fmt(run.totalStatutory)}</p>
                    </div>
                  </button>
                  {expandedRun === run.id && (
                    <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/80">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-slate-500 text-left">
                            <th className="py-2 pr-3 font-medium">Employee</th>
                            <th className="py-2 px-3 font-medium text-right">Gross</th>
                            <th className="py-2 px-3 font-medium text-right">EPF</th>
                            <th className="py-2 px-3 font-medium text-right">ESI</th>
                            <th className="py-2 px-3 font-medium text-right">TDS</th>
                            <th className="py-2 pl-3 font-medium text-right">Net</th>
                          </tr>
                        </thead>
                        <tbody>
                          {run.employeeSlips.map((s) => (
                            <tr key={s.employeeId} className="border-t border-slate-100">
                              <td className="py-2.5 pr-3 font-medium text-slate-900">{s.employeeName}</td>
                              <td className="py-2.5 px-3 text-right text-slate-600">{fmt(s.grossEarnings)}</td>
                              <td className="py-2.5 px-3 text-right text-rose-600">{fmt(s.epf)}</td>
                              <td className="py-2.5 px-3 text-right text-rose-600">{s.esiEmployee > 0 ? fmt(s.esiEmployee) : '—'}</td>
                              <td className="py-2.5 px-3 text-right text-rose-600">{fmt(s.tds)}</td>
                              <td className="py-2.5 pl-3 text-right font-medium text-slate-900">{fmt(s.netPay)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* YTD summary panel */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">YTD summary</h3>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            {ytdSummaries.filter((s) => s.monthsProcessed > 0).length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">No data yet</p>
            ) : (
              ytdSummaries.filter((s) => s.monthsProcessed > 0).map((s) => (
                <div key={s.employeeId} className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="font-medium text-slate-900 text-sm">{s.employeeName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.monthsProcessed} months</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs">
                    <span className="text-slate-500">Gross</span>
                    <span className="font-medium text-slate-700 text-right">{fmt(s.totalGross)}</span>
                    <span className="text-slate-500">TDS</span>
                    <span className="font-medium text-rose-600 text-right">{fmt(s.totalTDS)}</span>
                    <span className="text-slate-500">EPF</span>
                    <span className="font-medium text-slate-700 text-right">{fmt(s.totalEPF)}</span>
                    <span className="text-slate-500">Net</span>
                    <span className="font-medium text-slate-900 text-right">{fmt(s.totalNet)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayrollHistory;
