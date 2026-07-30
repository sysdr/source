/**
 * useAttendance — local org attendance records.
 * REQ: REQ-086
 */

import { useCallback, useState } from 'react';
import type { AttendanceRecord } from '../types';
import {
  addAttendanceRecord,
  getAttendanceRecords,
  bulkAddAttendance,
} from '../services/storageService';

export function useAttendance(month?: string, year?: number) {
  const [records, setRecords] = useState<AttendanceRecord[]>(() =>
    getAttendanceRecords(undefined, month, year),
  );

  const refresh = useCallback(() => {
    setRecords(getAttendanceRecords(undefined, month, year));
  }, [month, year]);

  const upsert = useCallback(
    (record: AttendanceRecord) => {
      addAttendanceRecord(record);
      refresh();
    },
    [refresh],
  );

  const bulkUpsert = useCallback(
    (list: AttendanceRecord[]) => {
      bulkAddAttendance(list);
      refresh();
    },
    [refresh],
  );

  return { records, upsert, bulkUpsert, refresh };
}
