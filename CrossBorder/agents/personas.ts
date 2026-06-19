/**
 * Agent personas – definitions and descriptions for the orchestrator.
 */

import type { AgentId } from './types';

export interface AgentPersona {
  id: AgentId;
  name: string;
  description: string;
  /** Used in system prompt for routing. */
  responsibilities: string;
}

export const agentPersonas: AgentPersona[] = [
  {
    id: 'operations',
    name: 'Operations Agent',
    description: 'Resource allocation, capacity planning, supply chain.',
    responsibilities: 'Sync Stripe/data, capacity checks, project timelines, resource allocation.',
  },
  {
    id: 'sales',
    name: 'Sales & Marketing Agent',
    description: 'Lead research, CRM, campaigns.',
    responsibilities: 'Revenue data, deal pipeline, capacity checks before large contracts.',
  },
  {
    id: 'hr',
    name: 'HR Concierge Agent',
    description: 'Onboarding, policy, leave, benefits, payroll.',
    responsibilities: 'Employees, payroll runs, leave requests & balances, handbook policies, onboarding triggers, statutory compliance (EPF/ESI/PT/TDS).',
  },
  {
    id: 'procurement',
    name: 'Procurement Agent',
    description: 'Vendor selection, POs, budget checks.',
    responsibilities: 'Purchase orders, vendor comparison, budget validation with Finance.',
  },
  {
    id: 'expense',
    name: 'Expense Auditor Agent',
    description: 'Receipts, policy checks, reimbursement.',
    responsibilities: 'Invoice analysis, travel policy, expense approval/flag.',
  },
  {
    id: 'finance',
    name: 'Financial Controller Agent',
    description: 'Ledger, reconciliation, cash flow.',
    responsibilities: 'Transactions, revenue, transfer pricing, tax engine, platform rules.',
  },
  {
    id: 'tax',
    name: 'Tax & Compliance Agent',
    description: 'VAT/GST, nexus, tax calculation API.',
    responsibilities: 'Tax calculation (via external API only), transfer pricing, book profit.',
  },
  {
    id: 'compliance',
    name: 'Compliance Agent',
    description: 'India–US regulations, filings, vault.',
    responsibilities: 'Form 5472, GST, OIDAR, compliance Q&A, vault documents.',
  },
];

export function getAgentPersona(id: AgentId): AgentPersona | undefined {
  return agentPersonas.find((p) => p.id === id);
}

export function getAgentsSummaryForPrompt(): string {
  return agentPersonas
    .filter((p) => p.id !== 'orchestrator')
    .map((p) => `- ${p.id}: ${p.name}. ${p.responsibilities}`)
    .join('\n');
}
