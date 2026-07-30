/** REQ: REQ-086 */
import { describe, it, expect, beforeEach } from 'vitest';
import { addAttendanceRecord, getAttendanceRecords } from './storageService';

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
});
