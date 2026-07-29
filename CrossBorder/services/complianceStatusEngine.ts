/**
 * Dynamic compliance status engine (REQ-002, REQ-017, REQ-036 / T-029).
 * Derives filed/pending/overdue + data-readiness blockers from live data — not hardcoded.
 */
import type { Employee, FilingTask, FilingTaskStatus, FilingTaskType, PayrollRun, Transaction } from '../types';

export type ReadinessLevel = 'ready' | 'blocked' | 'partial' | 'n/a';

export interface ComplianceBlocker {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface FilingComplianceItem {
  taskId: string;
  type: FilingTaskType;
  period: string;
  dueDate: string;
  /** Derived status — Overdue computed from dueDate when not Filed */
  derivedStatus: FilingTaskStatus;
  readiness: ReadinessLevel;
  blockers: ComplianceBlocker[];
  daysUntilDue: number;
}

export interface ComplianceStatusReport {
  generatedAt: string;
  summary: {
    overdue: number;
    dueSoon: number;
    pending: number;
    filed: number;
    ready: number;
    blocked: number;
  };
  items: FilingComplianceItem[];
}

export interface ComplianceEngineInput {
  tasks: FilingTask[];
  transactions: Transaction[];
  employees: Employee[];
  payrollRuns: PayrollRun[];
  /** Optional: org has GSTIN configured */
  hasGstin?: boolean;
  /** Optional: org has TAN configured */
  hasTan?: boolean;
  asOfDate?: string;
}

function daysUntil(dueDate: string, asOf: string): number {
  return Math.ceil(
    (new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${asOf}T00:00:00`).getTime()) / 86_400_000,
  );
}

export function deriveFilingStatus(task: FilingTask, asOfDate: string): FilingTaskStatus {
  if (task.status === 'Filed' || task.status === 'NotApplicable') return task.status;
  if (task.status === 'InProgress') {
    if (task.dueDate < asOfDate) return 'Overdue';
    return 'InProgress';
  }
  if (task.dueDate < asOfDate) return 'Overdue';
  return task.status === 'Overdue' ? 'Overdue' : 'Pending';
}

function assessGstrReadiness(
  type: 'GSTR-1' | 'GSTR-3B',
  transactions: Transaction[],
  hasGstin?: boolean,
): { readiness: ReadinessLevel; blockers: ComplianceBlocker[] } {
  const blockers: ComplianceBlocker[] = [];
  if (!hasGstin) {
    blockers.push({ code: 'MISSING_GSTIN', message: 'Company GSTIN not configured', severity: 'error' });
  }
  const income = transactions.filter((t) => t.type === 'Income' && !t.deleted && t.status === 'Completed');
  if (income.length === 0) {
    blockers.push({ code: 'NO_INCOME', message: 'No completed income transactions for period', severity: 'warning' });
  }
  const missingClass = income.filter((t) => !t.classification && !t.customerCountry && t.gstRate == null);
  if (missingClass.length > 0) {
    blockers.push({
      code: 'UNCLASSIFIED_REVENUE',
      message: `${missingClass.length} income row(s) lack GST classification / rate`,
      severity: 'error',
    });
  }
  if (type === 'GSTR-3B') {
    const purchases = transactions.filter((t) => (t.type === 'Purchase' || t.type === 'Expense') && t.itcEligible);
    // informational — not a hard block
    if (purchases.some((t) => t.gstImpact == null && (t.gstRate || 0) > 0)) {
      blockers.push({
        code: 'ITC_AMOUNT_MISSING',
        message: 'Some ITC-eligible purchases missing gstImpact',
        severity: 'warning',
      });
    }
  }
  const errors = blockers.filter((b) => b.severity === 'error');
  if (errors.length > 0) return { readiness: 'blocked', blockers };
  if (blockers.length > 0) return { readiness: 'partial', blockers };
  return { readiness: 'ready', blockers };
}

function assessTds24q(
  employees: Employee[],
  payrollRuns: PayrollRun[],
  hasTan?: boolean,
): { readiness: ReadinessLevel; blockers: ComplianceBlocker[] } {
  const blockers: ComplianceBlocker[] = [];
  if (!hasTan) {
    blockers.push({ code: 'MISSING_TAN', message: 'Deductor TAN not configured', severity: 'error' });
  }
  if (payrollRuns.length === 0) {
    blockers.push({ code: 'NO_PAYROLL', message: 'No payroll runs available for 24Q', severity: 'error' });
  }
  const active = employees.filter((e) => e.status === 'Active');
  const missingPan = active.filter((e) => !e.panNumber);
  if (missingPan.length > 0) {
    blockers.push({
      code: 'EMPLOYEE_PAN',
      message: `${missingPan.length} active employee(s) missing PAN`,
      severity: 'error',
    });
  }
  const errors = blockers.filter((b) => b.severity === 'error');
  if (errors.length > 0) return { readiness: 'blocked', blockers };
  if (blockers.length > 0) return { readiness: 'partial', blockers };
  return { readiness: 'ready', blockers };
}

function assess26q(transactions: Transaction[], hasTan?: boolean): { readiness: ReadinessLevel; blockers: ComplianceBlocker[] } {
  const blockers: ComplianceBlocker[] = [];
  if (!hasTan) {
    blockers.push({ code: 'MISSING_TAN', message: 'Deductor TAN not configured', severity: 'error' });
  }
  const tdsRows = transactions.filter((t) => t.tdsApplicable && (t.tdsAmount || 0) > 0 && t.tdsSection !== '192');
  if (tdsRows.length === 0) {
    blockers.push({
      code: 'NO_VENDOR_TDS',
      message: 'No non-salary TDS transactions — 26Q may be empty',
      severity: 'warning',
    });
  }
  const errors = blockers.filter((b) => b.severity === 'error');
  if (errors.length > 0) return { readiness: 'blocked', blockers };
  if (blockers.length > 0) return { readiness: 'partial', blockers };
  return { readiness: 'ready', blockers };
}

function assess5472(transactions: Transaction[]): { readiness: ReadinessLevel; blockers: ComplianceBlocker[] } {
  const blockers: ComplianceBlocker[] = [];
  const related = transactions.filter(
    (t) =>
      !t.deleted
      && (t.category?.toLowerCase().includes('transfer')
        || t.description?.toLowerCase().includes('intercompany')
        || t.entity === 'subsidiary'),
  );
  if (related.length === 0) {
    blockers.push({
      code: 'NO_RELATED_PARTY',
      message: 'No related-party / intercompany transactions found',
      severity: 'warning',
    });
  }
  if (blockers.length > 0) return { readiness: 'partial', blockers };
  return { readiness: 'ready', blockers };
}

export function assessFilingReadiness(
  type: FilingTaskType,
  input: Omit<ComplianceEngineInput, 'tasks'>,
): { readiness: ReadinessLevel; blockers: ComplianceBlocker[] } {
  switch (type) {
    case 'GSTR-1':
    case 'GSTR-3B':
      return assessGstrReadiness(type, input.transactions, input.hasGstin);
    case '24Q':
      return assessTds24q(input.employees, input.payrollRuns, input.hasTan);
    case '26Q':
      return assess26q(input.transactions, input.hasTan);
    case 'Form 5472':
      return assess5472(input.transactions);
    default:
      return { readiness: 'n/a', blockers: [] };
  }
}

export function buildComplianceStatusReport(input: ComplianceEngineInput): ComplianceStatusReport {
  const asOf = input.asOfDate || new Date().toISOString().slice(0, 10);
  const items: FilingComplianceItem[] = input.tasks.map((task) => {
    const derivedStatus = deriveFilingStatus(task, asOf);
    const { readiness, blockers } = assessFilingReadiness(task.type, input);
    return {
      taskId: task.id,
      type: task.type,
      period: task.period,
      dueDate: task.dueDate,
      derivedStatus,
      readiness: derivedStatus === 'Filed' || derivedStatus === 'NotApplicable' ? 'n/a' : readiness,
      blockers: derivedStatus === 'Filed' ? [] : blockers,
      daysUntilDue: daysUntil(task.dueDate, asOf),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      overdue: items.filter((i) => i.derivedStatus === 'Overdue').length,
      dueSoon: items.filter((i) => i.derivedStatus === 'Pending' && i.daysUntilDue >= 0 && i.daysUntilDue <= 14).length,
      pending: items.filter((i) => i.derivedStatus === 'Pending' || i.derivedStatus === 'InProgress').length,
      filed: items.filter((i) => i.derivedStatus === 'Filed').length,
      ready: items.filter((i) => i.readiness === 'ready').length,
      blocked: items.filter((i) => i.readiness === 'blocked').length,
    },
    items: items.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  };
}
