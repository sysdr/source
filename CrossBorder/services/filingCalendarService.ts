/**
 * Filing calendar: due dates, status, document links.
 */

import type { FilingTask, FilingTaskType, FilingTaskStatus } from '../types';
import { getFilingTasks, addFilingTask, updateFilingTask } from './storageService';

const DUE_RULES: Record<FilingTaskType, (period: string) => string> = {
  'GSTR-1': (p) => `${p}-11`, // 11th of next month
  'GSTR-3B': (p) => `${p}-20`,
  'GSTR-9': (fy) => `${fy.split('-')[0]}-12-31`,
  'GSTR-9C': (fy) => `${fy.split('-')[0]}-12-31`,
  '24Q': (q) => {
    const [y, qn] = q.split('-');
    const year = parseInt(y, 10);
    const quarter = qn === 'Q1' ? 1 : qn === 'Q2' ? 2 : qn === 'Q3' ? 3 : 4;
    const endMonth = 3 + quarter * 3; // 6, 9, 12, 3
    const dueYear = endMonth <= 12 ? year : year + 1;
    const dueMonth = endMonth <= 12 ? endMonth : 3;
    return `${dueYear}-${String(dueMonth).padStart(2, '0')}-31`;
  },
  '26Q': (q) => {
    const [y, qn] = q.split('-');
    const year = parseInt(y, 10);
    const quarter = qn === 'Q1' ? 1 : qn === 'Q2' ? 2 : qn === 'Q3' ? 3 : 4;
    const endMonth = 3 + quarter * 3;
    const dueYear = endMonth <= 12 ? year : year + 1;
    const dueMonth = endMonth <= 12 ? endMonth : 3;
    return `${dueYear}-${String(dueMonth).padStart(2, '0')}-31`;
  },
  '27Q': (q) => {
    const [y, qn] = q.split('-');
    const year = parseInt(y, 10);
    const quarter = qn === 'Q1' ? 1 : qn === 'Q2' ? 2 : qn === 'Q3' ? 3 : 4;
    const endMonth = 3 + quarter * 3;
    const dueYear = endMonth <= 12 ? year : year + 1;
    const dueMonth = endMonth <= 12 ? endMonth : 3;
    return `${dueYear}-${String(dueMonth).padStart(2, '0')}-31`;
  },
  'ITR-5': (fy) => `${parseInt(fy, 10) + 1}-10-31`,
  'ITR-6': (fy) => `${parseInt(fy, 10) + 1}-10-31`,
  'ITR-7': (fy) => `${parseInt(fy, 10) + 1}-10-31`,
  'Form 5472': (y) => `${y}-04-15`,
  'Form 1120': (y) => `${y}-04-15`,
  'Form 1065': (y) => `${y}-04-15`,
  'Advance Tax': (p) => {
    // p is expected to be like "2025-Q1", "2025-Q2", etc.
    const [y, qn] = p.split('-');
    const year = parseInt(y, 10);
    if (qn === 'Q1') return `${year}-06-15`;
    if (qn === 'Q2') return `${year}-09-15`;
    if (qn === 'Q3') return `${year}-12-15`;
    return `${year + 1}-03-15`; // Q4 / Final
  },
  'FEMA': (p) => `${p}-07-31`,
  // GST LUT (Letter of Undertaking) — valid for the full FY, renewal due March 31
  'GST LUT': (fy) => `${fy.split('-')[0]}-03-31`,
};

export function ensureFilingTask(type: FilingTaskType, period: string): FilingTask {
  const existing = getFilingTasks().find((f) => f.type === type && f.period === period);
  if (existing) return existing;

  const dueDate = DUE_RULES[type]?.(period) ?? period;
  const now = new Date().toISOString();
  const task: FilingTask = {
    id: `filing-${type}-${period}-${Date.now()}`,
    type,
    period,
    dueDate,
    status: 'Pending',
    createdAt: now,
    updatedAt: now,
  };
  addFilingTask(task);
  return task;
}

export function markFilingFiled(taskId: string, filedDate: string, documentIds?: string[]): void {
  updateFilingTask(taskId, { status: 'Filed', filedDate, documentIds });
}

export function getOverdueFilings(): FilingTask[] {
  const today = new Date().toISOString().slice(0, 10);
  return getFilingTasks().filter((f) => f.status === 'Pending' && f.dueDate < today);
}

export function getUpcomingFilings(withinDays: number): FilingTask[] {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + withinDays);
  const endStr = end.toISOString().slice(0, 10);
  return getFilingTasks()
    .filter((f) => f.status === 'Pending' && f.dueDate >= today.toISOString().slice(0, 10) && f.dueDate <= endStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function seedDefaultFilingTasksForFY(financialYear: string): void {
  // Idempotent: check if tasks for this FY have already been seeded
  const existing = getFilingTasks();
  const alreadySeeded = existing.some((t) => t.period === financialYear || t.period.startsWith(financialYear.split('-')[0] + '-'));
  if (alreadySeeded) return;

  const [fyStart] = financialYear.split('-').map(Number);
  const fyEnd = fyStart + 1;
  const periods = [
    `${fyStart}-04`, `${fyStart}-05`, `${fyStart}-06`, `${fyStart}-07`, `${fyStart}-08`, `${fyStart}-09`,
    `${fyStart}-10`, `${fyStart}-11`, `${fyStart}-12`, `${fyEnd}-01`, `${fyEnd}-02`, `${fyEnd}-03`,
  ];
  periods.forEach((p) => {
    ensureFilingTask('GSTR-1', p);
    ensureFilingTask('GSTR-3B', p);
  });
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach((_, i) => {
    ensureFilingTask('24Q', `${fyStart}-Q${i + 1}`);
    ensureFilingTask('26Q', `${fyStart}-Q${i + 1}`);
  });
  // Advance Tax: 4 quarterly installments for the FY
  ensureFilingTask('Advance Tax', `${fyStart}-Q1`); // 15 June
  ensureFilingTask('Advance Tax', `${fyStart}-Q2`); // 15 September
  ensureFilingTask('Advance Tax', `${fyStart}-Q3`); // 15 December
  ensureFilingTask('Advance Tax', `${fyStart}-Q4`); // 15 March
  ensureFilingTask('GSTR-9', financialYear);
  ensureFilingTask('ITR-6', financialYear);
  ensureFilingTask('Form 5472', String(fyEnd));
  ensureFilingTask('Form 1120', String(fyEnd));
}
