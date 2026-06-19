/**
 * Tool implementations – deterministic APIs only.
 * Tax/accounting math is done via tools (e.g. tax engine API), not by the LLM.
 */

import type { ToolId, AgentId } from '../types';
import { toolDefs } from './definitions';
import {
  getCompanyProfile,
  getTransactions,
  getEmployees,
  getRevenueData,
  getPayrollRuns,
  getTransferPricingData,
  getTaxEngineData,
  getPlatformRules,
  getLeaveRequests,
  getLeaveBalance,
  getVaultDocuments,
  addTransaction,
  getPendingTransactions,
  approvePendingTransaction,
} from '../../services/storageService';
import { runStripeSyncForAllAccounts, getLastSyncStatus } from '../../services/stripeSyncService';
import { getFxRateForDate, getBaseCurrency } from '../../services/currencyService';
import type { Transaction } from '../../types';
import { getComplianceAdvice, analyzeInvoice } from '../../services/geminiService';

/** Tax calculation: uses taxService (external API if configured, else partner remuneration or stub). */
async function taxCalculate(params: Record<string, unknown>): Promise<unknown> {
  const amount = Number(params.amount ?? 0);
  const fromCountry = (params.fromCountry as string) || 'US';
  const toCountry = (params.toCountry as string) || 'IN';
  const productType = (params.productType as string) || 'service';
  const { taxCalculate: runTaxCalculate } = await import('../../services/taxService');
  return runTaxCalculate({ amount, fromCountry, toCountry, productType });
}

function getVaultSummary(): { count: number; types: string[] } {
  try {
    const docs = getVaultDocuments();
    const types = [...new Set(docs.map((d) => d.type || 'document').filter(Boolean))];
    return { count: docs.length, types };
  } catch {
    return { count: 0, types: [] };
  }
}

const toolImpls: Record<ToolId, (params: Record<string, unknown>) => Promise<unknown>> = {
  read_company_profile: async () => getCompanyProfile(),
  read_transactions: async () => getTransactions(),
  read_employees: async () => getEmployees(),
  read_revenue_data: async () => getRevenueData(),
  read_payroll_runs: async () => getPayrollRuns(),
  read_transfer_pricing: async () => getTransferPricingData(),
  read_tax_engine: async () => getTaxEngineData(),
  read_platform_rules: async () => getPlatformRules(),
  read_vault_summary: async () => getVaultSummary(),
  read_leave_requests: async () => getLeaveRequests(),
  read_leave_balances: async (p) => {
    const employeeId = (p.employeeId as string) || '';
    const year = (p.year as number) || new Date().getFullYear();
    return getLeaveBalance(employeeId, year);
  },
  stripe_sync: async () => {
    const result = await runStripeSyncForAllAccounts();
    return { ...result, lastSync: getLastSyncStatus() };
  },
  fx_rate: async (p) => {
    const date = (p.date as string) || new Date().toISOString().slice(0, 10);
    const from = (p.from as string) || 'USD';
    const to = (p.to as string) || getBaseCurrency();
    if (from === to) return { rate: 1, date, from, to };
    const rate = await getFxRateForDate(date, from, to);
    return { rate, date, from, to };
  },
  tax_calculate: taxCalculate,
  compliance_advice: async (p) => {
    const query = (p.query as string) || '';
    return getComplianceAdvice(query);
  },
  analyze_invoice: async (p) => {
    const text = (p.invoiceText as string) || '';
    return analyzeInvoice(text);
  },
  add_transaction: async (p) => {
    const description = (p.description as string)?.trim();
    const amount = Number(p.amount);
    const type = ((p.type as string) || 'Expense') as 'Income' | 'Expense' | 'Purchase';
    if (!description || Number.isNaN(amount)) {
      return { success: false, error: 'description and amount are required' };
    }
    const baseCurrency = getBaseCurrency();
    const tx: Transaction = {
      id: `TXN-${Date.now()}`,
      date: (p.date as string) || new Date().toISOString().split('T')[0],
      description,
      amount,
      currency: baseCurrency,
      source: 'Manual',
      category: (p.category as string) || 'Other',
      status: 'Completed',
      type,
      entity: (p.entity as 'parent' | 'subsidiary') || undefined,
      gstImpact: type === 'Purchase' ? amount * 0.18 : 0,
    };
    addTransaction(tx);
    return { success: true, id: tx.id, message: `Posted ${type}: ${description} — ${amount} ${baseCurrency}` };
  },
  read_pending_transactions: async () => {
    const list = getPendingTransactions();
    return { count: list.length, pending: list };
  },
  approve_pending_transaction: async (p) => {
    const id = (p.transactionId as string)?.trim();
    if (!id) return { success: false, error: 'transactionId is required' };
    const list = getPendingTransactions();
    const found = list.find((x) => x.id === id);
    if (!found) return { success: false, error: `No pending transaction with id "${id}"` };
    approvePendingTransaction(id);
    return { success: true, message: `Approved and posted: ${found.description} — ${found.amount} ${found.currency}` };
  },
};

export function runTool(
  toolId: ToolId,
  params: Record<string, unknown>,
  allowedAgents: AgentId[]
): Promise<unknown> {
  const fn = toolImpls[toolId];
  if (!fn) return Promise.reject(new Error(`Unknown tool: ${toolId}`));
  return fn(params);
}

export function getToolsForAgents(allowedAgents: AgentId[]): Record<ToolId, (params: Record<string, unknown>) => Promise<unknown>> {
  const set = new Set(allowedAgents);
  const filtered: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  for (const id of Object.keys(toolImpls) as ToolId[]) {
    const def = toolDefs.find((t) => t.id === id);
    if (def && def.allowedAgents.some((a) => set.has(a))) filtered[id] = toolImpls[id];
  }
  return filtered as Record<ToolId, (params: Record<string, unknown>) => Promise<unknown>>;
}
