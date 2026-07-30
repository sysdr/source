/** REQ: REQ-086 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./apiClient', () => ({
  api: {
    setOrgData: vi.fn().mockResolvedValue(true),
  },
  getAccessRole: () => 'owner',
}));

import { addAttendanceRecord, getAttendanceRecords, bulkAddAttendance } from './storageService';

describe('attendance storage (REQ-086)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('upserts unique employeeId+date', () => {
    addAttendanceRecord({ employeeId: 'E1', date: '2026-07-01', status: 'Present' });
    addAttendanceRecord({ employeeId: 'E1', date: '2026-07-01', status: 'WFH' });
    const rows = getAttendanceRecords('E1');
    expect(rows.filter((r) => r.date === '2026-07-01')).toHaveLength(1);
    expect(rows[0].status).toBe('WFH');
  });

  it('filters by employee and supports bulk upsert', () => {
    addAttendanceRecord({ employeeId: 'E1', date: '2026-07-02', status: 'Present' });
    addAttendanceRecord({ employeeId: 'E2', date: '2026-07-02', status: 'Absent' });
    bulkAddAttendance([
      { employeeId: 'E1', date: '2026-07-02', status: 'Half-day' },
      { employeeId: 'E1', date: '2026-07-03', status: 'Leave' },
    ]);
    expect(getAttendanceRecords('E1')).toHaveLength(2);
    expect(getAttendanceRecords('E1').find((r) => r.date === '2026-07-02')?.status).toBe('Half-day');
    expect(getAttendanceRecords('E2')[0].status).toBe('Absent');
  });
});
