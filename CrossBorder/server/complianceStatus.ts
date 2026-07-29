/**
 * Server compliance status (REQ-002 / T-029).
 */
import { getOrgData, queryTransactions, getEmployees, getPayrollRuns } from './db.js';
import type { CompanyProfile, Employee, FilingTask, PayrollRun, Transaction } from '../types.js';
import { buildComplianceStatusReport } from '../services/complianceStatusEngine.js';

const FILING_TASKS_KEY = 'filingTasks';
const PROFILE_KEY = 'suez_company_profile';

export function getComplianceStatusForOrg(orgId: string) {
  const tasksRaw = getOrgData(orgId, FILING_TASKS_KEY);
  const tasks = Array.isArray(tasksRaw) ? (tasksRaw as FilingTask[]) : [];
  const transactions = queryTransactions({ orgId, limit: 10_000, offset: 0 }) as Transaction[];
  const employees = (getEmployees(orgId) as Employee[]) || [];
  const payrollRuns = (getPayrollRuns(orgId) as PayrollRun[]) || [];
  const profile = getOrgData(orgId, PROFILE_KEY) as CompanyProfile | null;
  const taxId = profile?.parent?.taxId || '';
  const hasGstin = taxId.length >= 15;
  const hasTan = !!(profile?.parent?.tan || (taxId.length >= 10 && taxId.length < 15));

  return buildComplianceStatusReport({
    tasks,
    transactions,
    employees,
    payrollRuns,
    hasGstin,
    hasTan,
  });
}
