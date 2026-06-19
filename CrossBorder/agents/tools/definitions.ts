/**
 * Tool definitions – RBAC: which agents can call which tools.
 */

import type { ToolDef, ToolId, AgentId } from '../types';

export const toolDefs: ToolDef[] = [
  { id: 'read_company_profile', name: 'Read company profile', description: 'Get organisation and entity details.', allowedAgents: ['orchestrator', 'operations', 'sales', 'hr', 'procurement', 'finance', 'tax', 'compliance'] },
  { id: 'read_transactions', name: 'Read transactions', description: 'List general ledger / revenue transactions.', allowedAgents: ['orchestrator', 'operations', 'sales', 'finance', 'tax', 'compliance'] },
  { id: 'read_employees', name: 'Read employees', description: 'List employees and payroll-related data.', allowedAgents: ['orchestrator', 'hr', 'finance'] },
  { id: 'read_revenue_data', name: 'Read revenue data', description: 'Revenue ingestion and Stripe-linked data.', allowedAgents: ['orchestrator', 'operations', 'sales', 'finance', 'tax'] },
  { id: 'read_payroll_runs', name: 'Read payroll runs', description: 'Past payroll run summaries.', allowedAgents: ['orchestrator', 'hr', 'finance'] },
  { id: 'read_transfer_pricing', name: 'Read transfer pricing', description: 'US revenue/expenses/margin for intercompany.', allowedAgents: ['orchestrator', 'finance', 'tax'] },
  { id: 'read_tax_engine', name: 'Read tax engine', description: 'Book profit and tax-related state.', allowedAgents: ['orchestrator', 'finance', 'tax'] },
  { id: 'read_platform_rules', name: 'Read platform rules', description: 'FX markup, audit thresholds.', allowedAgents: ['orchestrator', 'finance', 'expense'] },
  { id: 'read_vault_summary', name: 'Read vault summary', description: 'Count and types of vault documents.', allowedAgents: ['orchestrator', 'compliance', 'hr'] },
  { id: 'read_leave_requests', name: 'Read leave requests', description: 'List leave requests and their status.', allowedAgents: ['orchestrator', 'hr'] },
  { id: 'read_leave_balances', name: 'Read leave balances', description: 'Get leave balances for a specific employee.', allowedAgents: ['orchestrator', 'hr'], params: [{ name: 'employeeId', type: 'string', required: true, description: 'Employee ID to get balances for' }] },
  { id: 'stripe_sync', name: 'Run Stripe sync', description: 'Sync charges and balance from Stripe for all accounts.', allowedAgents: ['orchestrator', 'operations', 'finance'] },
  { id: 'fx_rate', name: 'Get FX rate', description: 'Get exchange rate for a date and currency pair.', allowedAgents: ['orchestrator', 'operations', 'finance', 'tax'] },
  { id: 'tax_calculate', name: 'Tax calculation (stub)', description: 'Calculate tax via external engine (Avalara/Vertex). Deterministic.', allowedAgents: ['tax', 'finance', 'orchestrator'] },
  { id: 'compliance_advice', name: 'Compliance advice', description: 'RAG-style compliance Q&A (India-US).', allowedAgents: ['compliance', 'tax', 'orchestrator'] },
  { id: 'analyze_invoice', name: 'Analyze invoice', description: 'Check invoice for cross-border compliance.', allowedAgents: ['expense', 'finance', 'tax', 'compliance', 'orchestrator'] },
  { id: 'add_transaction', name: 'Add ledger transaction', description: 'Post a manual transaction to the general ledger (description, amount, type, category).', allowedAgents: ['orchestrator', 'finance', 'expense'], params: [
    { name: 'description', type: 'string', required: true, description: 'Transaction description' },
    { name: 'amount', type: 'number', required: true, description: 'Amount in base currency' },
    { name: 'type', type: 'string', required: true, description: 'Income, Expense, or Purchase' },
    { name: 'category', type: 'string', required: false, description: 'Category e.g. SaaS & Hosting' },
  ] },
  { id: 'read_pending_transactions', name: 'Read pending transactions', description: 'List transactions awaiting approval (HITL).', allowedAgents: ['orchestrator', 'finance', 'expense'] },
  { id: 'approve_pending_transaction', name: 'Approve pending transaction', description: 'Approve a pending transaction by id and post to ledger.', allowedAgents: ['orchestrator', 'finance', 'expense'], params: [{ name: 'transactionId', type: 'string', required: true, description: 'ID of the pending transaction to approve' }] },
];

export function getToolIdsForAgent(agentId: AgentId): ToolId[] {
  return toolDefs.filter((t) => t.allowedAgents.includes(agentId)).map((t) => t.id);
}
