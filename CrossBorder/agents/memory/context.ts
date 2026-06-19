/**
 * Long-term context builder: company profile, entities, and high-level stats from storage.
 * In a full MAS this would be backed by a vector DB or knowledge graph.
 */

import { getCompanyProfile, getTransactions, getEmployees, getRevenueData, getPayrollRuns, getLeaveRequests } from '../../services/storageService';
import { getBaseCurrency } from '../../services/currencyService';

export interface OrgContextSummary {
  orgName: string;
  baseCurrency: 'INR' | 'USD';
  parentEntity: string;
  subsidiaryEntity: string;
  employeeCount: number;
  activeEmployeeCount: number;
  transactionCount: number;
  revenueTransactionCount: number;
  payrollRunCount: number;
  pendingLeaveRequests: number;
}

export function getOrgContextSummary(): OrgContextSummary | null {
  const profile = getCompanyProfile();
  if (!profile) return null;
  const employees = getEmployees();
  const transactions = getTransactions();
  const revenue = getRevenueData();
  const payrollRuns = getPayrollRuns();
  const leaveRequests = getLeaveRequests();
  return {
    orgName: profile.projectName || 'Organisation',
    baseCurrency: getBaseCurrency(),
    parentEntity: profile.parent?.name || 'Parent',
    subsidiaryEntity: profile.subsidiary?.name || 'Subsidiary',
    employeeCount: employees.length,
    activeEmployeeCount: employees.filter((e) => e.status === 'Active').length,
    transactionCount: transactions.length,
    revenueTransactionCount: revenue?.transactions?.length ?? 0,
    payrollRunCount: payrollRuns.length,
    pendingLeaveRequests: leaveRequests.filter((r) => r.status === 'Pending').length,
  };
}

/** One-line summary for the orchestrator system prompt. */
export function getOrgContextLine(): string {
  const s = getOrgContextSummary();
  if (!s) return 'No organisation loaded.';
  return `${s.orgName} (${s.baseCurrency}): ${s.parentEntity} / ${s.subsidiaryEntity}. Employees: ${s.activeEmployeeCount}/${s.employeeCount}, Txns: ${s.transactionCount}, Revenue txns: ${s.revenueTransactionCount}, Payroll runs: ${s.payrollRunCount}, Pending leaves: ${s.pendingLeaveRequests}.`;
}
