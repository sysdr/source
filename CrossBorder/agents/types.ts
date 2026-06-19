/**
 * Agentic Enterprise Architecture – shared types for MAS.
 * Supports auditability (Chain-of-Thought), RBAC, and human-in-the-loop.
 */

export type AgentId =
  | 'orchestrator'
  | 'operations'
  | 'sales'
  | 'hr'
  | 'procurement'
  | 'expense'
  | 'finance'
  | 'tax'
  | 'compliance';

export type ToolId =
  | 'read_company_profile'
  | 'read_transactions'
  | 'read_employees'
  | 'read_revenue_data'
  | 'read_payroll_runs'
  | 'read_transfer_pricing'
  | 'read_tax_engine'
  | 'read_platform_rules'
  | 'read_vault_summary'
  | 'read_leave_requests'
  | 'read_leave_balances'
  | 'stripe_sync'
  | 'fx_rate'
  | 'tax_calculate'
  | 'compliance_advice'
  | 'analyze_invoice'
  | 'add_transaction'
  | 'read_pending_transactions'
  | 'approve_pending_transaction';

/** Single tool invocation – deterministic; no AI math for tax/accounting. */
export interface ToolCall {
  toolId: ToolId;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  at: string;
}

/** One step in the chain-of-thought / audit trail. */
export interface AuditStep {
  agentId: AgentId;
  at: string;
  summary: string;
  toolCalls: ToolCall[];
  /** Optional: LLM reasoning or delegation decision. */
  reasoning?: string;
}

export interface AgentRun {
  agentId: AgentId;
  startedAt: string;
  finishedAt?: string;
  summary: string;
  steps: AuditStep[];
  /** Final text to show the user. */
  output: string;
  /** If true, a human approval is required before persisting (HITL). */
  requiresHumanApproval?: boolean;
}

/** Orchestrator input: user message + optional session context. */
export interface OrchestratorInput {
  userMessage: string;
  sessionId?: string;
  /** Short-term: recent turns in this session. */
  recentTurns?: { role: 'user' | 'assistant'; content: string }[];
}

/** Orchestrator output: which agents ran and the final reply. */
export interface OrchestratorResult {
  success: boolean;
  reply: string;
  agentsUsed: AgentId[];
  runs: AgentRun[];
  /** Full CoT for auditors. */
  auditTrail: AuditStep[];
  /** Routing intent (e.g. compliance_query, data_read). */
  intent?: string;
  error?: string;
}

/** Tool definition for the orchestrator/agents – name, description, params schema. */
export interface ToolDef {
  id: ToolId;
  name: string;
  description: string;
  /** Which agents can call this tool (RBAC). */
  allowedAgents: AgentId[];
  params?: { name: string; type: string; required?: boolean; description?: string }[];
}

/** Context passed to agents: org summary, permissions, and tools. */
export interface AgentContext {
  orgName: string;
  baseCurrency: 'INR' | 'USD';
  activeOrgId: string | null;
  /** Tool implementations the agent is allowed to call. */
  tools: Record<ToolId, (params: Record<string, unknown>) => Promise<unknown>>;
  /** RBAC: only these agents were selected for this request. */
  allowedAgents: AgentId[];
}

// --- Workflow (agentic graph) types ---

export type WorkflowNodeId = 'route' | 'tools' | 'specialist' | 'synthesize' | 'end' | 'pause_approval';

export interface WorkflowState {
  nodeId: WorkflowNodeId;
  userMessage: string;
  sessionId?: string;
  /** One-line org summary for routing (from context). */
  orgContextLine?: string;
  recentTurns: { role: 'user' | 'assistant'; content: string }[];
  /** From route node */
  route?: {
    selectedAgents: AgentId[];
    intent: string;
    suggestedReply?: string;
    toolCalls: { toolId: ToolId; params?: Record<string, unknown> }[];
    invokeSpecialist?: boolean;
    specialistAgent?: AgentId;
  };
  /** After tools node */
  toolResults?: ToolCall[];
  /** After specialist node */
  specialistReply?: string;
  /** Final reply to user */
  finalReply: string;
  /** Audit trail for this run */
  auditTrail: AuditStep[];
  runs: AgentRun[];
  /** When true, workflow is waiting for human approval (HITL) */
  pausedForApproval?: boolean;
  approvalPayload?: unknown;
}

export interface RunMetrics {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  nodeVisits: { nodeId: WorkflowNodeId; at: string; durationMs?: number }[];
  toolCallCount: number;
  specialistInvoked: boolean;
  success: boolean;
  error?: string;
}
