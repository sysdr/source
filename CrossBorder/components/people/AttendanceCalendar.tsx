/**
 * Attendance month grid — REQ-086
 */

import React, { useMemo, useState } from 'react';
import type { AttendanceRecord, Employee } from '../../types';
import { useAttendance } from '../../hooks/useAttendance';
import { MONTHS } from '../../services/payrollCalculator';

const STATUSES: AttendanceRecord['status'][] = [
  'Present', 'Absent', 'Half-day', 'WFH', 'Holiday', 'Leave',
];

const statusClass: Record<AttendanceRecord['status'], string> = {
  Present: 'bg-emerald-100 text-emerald-800',
  Absent: 'bg-rose-100 text-rose-800',
  'Half-day': 'bg-amber-100 text-amber-800',
  WFH: 'bg-sky-100 text-sky-800',
  Holiday: 'bg-violet-100 text-violet-800',
  Leave: 'bg-indigo-100 text-indigo-800',
};

interface Props {
  employees: Employee[];
  toast: (type: 'success' | 'error' | 'info', text: string) => void;
}

const AttendanceCalendar: React.FC<Props> = ({ employees, toast }) => {
  const now = new Date();
  const [month, setMonth] = useState(MONTHS[now.getMonth()]);
  const [year, setYear] = useState(now.getFullYear());
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || '');
  const { records, upsert } = useAttendance(month, year);

  const monthIdx = MONTHS.indexOf(month);
  const daysInMonth = useMemo(
    () => new Date(year, monthIdx + 1, 0).getDate(),
    [year, monthIdx],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord['status']>();
    for (const r of records) {
      if (r.employeeId !== employeeId) continue;
      map.set(r.date, r.status);
    }
    return map;
  }, [records, employeeId]);

  const setDay = (day: number, status: AttendanceRecord['status']) => {
    if (!employeeId) {
      toast('error', 'Select an employee first');
      return;
    }
    const date = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    upsert({ employeeId, date, status });
    toast('success', `${date}: ${status}`);
  };

  const active = employees.filter((e) => e.status === 'Active' || e.status === 'Notice' || e.status === 'Onboarding');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-600 mb-1">Employee</span>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm"
          >
            {active.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-600 mb-1">Month</span>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm"
          >
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-600 mb-1">Year</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-24 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm"
          />
        </label>
      </div>

      {active.length === 0 ? (
        <p className="text-sm text-slate-500 py-12 text-center">No employees to mark attendance for.</p>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-7 gap-px bg-slate-100 p-px">
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const date = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const current = byDate.get(date);
              return (
                <div key={date} className="bg-white p-2 min-h-[88px] flex flex-col gap-1">
                  <span className="text-xs font-semibold text-slate-500">{day}</span>
                  <select
                    aria-label={`Attendance for ${date}`}
                    value={current || ''}
                    onChange={(e) => {
                      const v = e.target.value as AttendanceRecord['status'];
                      if (v) setDay(day, v);
                    }}
                    className={`text-[10px] font-semibold rounded-lg px-1 py-1 border-0 ${
                      current ? statusClass[current] : 'bg-slate-50 text-slate-400'
                    }`}
                  >
                    <option value="">—</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceCalendar;
