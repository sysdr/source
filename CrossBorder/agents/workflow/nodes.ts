/**
 * Workflow nodes – each node executes one step and returns the next node.
 * Linear graph: route → tools → specialist? → synthesize → end
 */

import type { WorkflowState, WorkflowNodeId, ToolCall, AuditStep, AgentId, ToolId } from '../types';
import { getOrchestratorRoute } from '../../services/geminiService';
import { runTool } from '../tools';
import { toolDefs } from '../tools/definitions';
import { invokeSpecialistAgent } from '../../services/geminiService';

const VALID_AGENT_IDS: AgentId[] = ['operations', 'sales', 'hr', 'procurement', 'expense', 'finance', 'tax', 'compliance'];

function normalizeAgents(selected: string[]): AgentId[] {
  const set = new Set(selected.map((s) => s.toLowerCase().trim()));
  return VALID_AGENT_IDS.filter((id) => set.has(id));
}

function isValidToolId(id: string): id is ToolId {
  return toolDefs.some((t) => t.id === id);
}

/** Format a single tool result for display (used in synthesize). */
export function formatToolResultForWorkflow(toolId: ToolId, result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (toolId === 'read_employees') {
    const arr = result as unknown[];
    const n = Array.isArray(arr) ? arr.length : 0;
    return n === 0 ? 'No employees on file.' : `You have ${n} employee${n === 1 ? '' : 's'} on file.`;
  }
  if (toolId === 'read_revenue_data') {
    const o = result as { transactions?: unknown[] };
    const n = Array.isArray(o?.transactions) ? o.transactions.length : 0;
    return `Revenue data: ${n} transaction${n === 1 ? '' : 's'} in the selected period.`;
  }
  if (toolId === 'read_transactions') {
    const arr = result as unknown[];
    const n = Array.isArray(arr) ? arr.length : 0;
    return `Ledger has ${n} transaction${n === 1 ? '' : 's'}.`;
  }
  if (toolId === 'stripe_sync') {
    const o = result as { success?: boolean; totalAdded?: number; transactionCount?: number };
    if (o?.success) return `Sync complete. ${o.totalAdded ?? o.transactionCount ?? 0} transaction(s) processed.`;
    return (result as { error?: string })?.error ?? 'Sync finished.';
  }
  if (toolId === 'add_transaction') {
    const o = result as { success?: boolean; message?: string; error?: string };
    if (o?.success && o?.message) return o.message;
    return o?.error ?? 'Transaction could not be posted.';
  }
  if (toolId === 'compliance_advice' && typeof result === 'string') return result;
  if (toolId === 'analyze_invoice' && result && typeof result === 'object' && 'suggestedRemedy' in result) {
    const r = result as { isCompliant?: boolean; suggestedRemedy?: string; missingElements?: string[] };
    const parts = [r.isCompliant ? 'Compliant.' : 'Not fully compliant.', r.suggestedRemedy].filter(Boolean);
    return parts.join(' ');
  }
  if (toolId === 'read_pending_transactions' && result && typeof result === 'object' && 'pending' in result) {
    const o = result as { count?: number; pending?: unknown[] };
    const n = o.count ?? o.pending?.length ?? 0;
    return n === 0 ? 'No pending transactions.' : `${n} transaction(s) awaiting approval.`;
  }
  if (toolId === 'approve_pending_transaction') {
    const o = result as { success?: boolean; message?: string; error?: string };
    if (o?.success && o?.message) return o.message;
    return o?.error ?? 'Approval failed.';
  }
  return '';
}

/** Route node: call Gemini for routing; populate state.route and toolCalls (multi-tool). */
export async function executeRouteNode(state: WorkflowState): Promise<WorkflowState> {
  const orgContextLine = state.orgContextLine ?? 'No organisation loaded.';
  const routeResult = await getOrchestratorRoute(
    state.userMessage,
    orgContextLine,
    state.recentTurns
  );

  const selectedAgents = normalizeAgents(routeResult.selectedAgents);
  const agentsUsed = selectedAgents.length > 0 ? selectedAgents : (['compliance'] as AgentId[]);

  // Support both single toolToCall and multi toolCalls
  const toolCalls: { toolId: ToolId; params?: Record<string, unknown> }[] = [];
  if (routeResult.toolCalls?.length) {
    for (const t of routeResult.toolCalls) {
      if (t?.toolId && isValidToolId(t.toolId)) {
        toolCalls.push({ toolId: t.toolId, params: t.params ?? {} });
      }
    }
  }
  if (toolCalls.length === 0 && routeResult.toolToCall?.toolId && isValidToolId(routeResult.toolToCall.toolId)) {
    toolCalls.push({
      toolId: routeResult.toolToCall.toolId as ToolId,
      params: routeResult.toolToCall.params ?? {},
    });
  }

  const next: WorkflowState = {
    ...state,
    nodeId: 'tools',
    route: {
      selectedAgents: agentsUsed,
      intent: routeResult.intent ?? 'general',
      suggestedReply: routeResult.suggestedReply,
      toolCalls,
      invokeSpecialist: routeResult.invokeSpecialist ?? false,
      specialistAgent: routeResult.specialistAgent as AgentId | undefined,
    },
    auditTrail: [
      ...state.auditTrail,
      {
        agentId: 'orchestrator',
        at: new Date().toISOString(),
        summary: `Routed to: ${agentsUsed.join(', ')}. Intent: ${routeResult.intent}.`,
        toolCalls: [],
        reasoning: routeResult.suggestedReply ? 'Using suggestedReply and/or tools.' : undefined,
      },
    ],
  };

  // Skip tools if none
  if (toolCalls.length === 0) {
    next.nodeId = next.route!.invokeSpecialist ? 'specialist' : 'synthesize';
  }
  return next;
}

/** Tools node: run all tools in sequence; populate state.toolResults. */
export async function executeToolsNode(state: WorkflowState): Promise<WorkflowState> {
  const route = state.route!;
  const allowedAgents: AgentId[] = ['orchestrator', ...route.selectedAgents];
  const toolResults: ToolCall[] = [];

  for (const { toolId, params } of route.toolCalls) {
    const at = new Date().toISOString();
    try {
      const result = await runTool(toolId, params ?? {}, allowedAgents);
      toolResults.push({ toolId, params: params ?? {}, result, at });
    } catch (err) {
      toolResults.push({ toolId, params: params ?? {}, error: (err as Error).message, at });
    }
  }

  const step: AuditStep = {
    agentId: 'orchestrator',
    at: new Date().toISOString(),
    summary: `Executed ${toolResults.length} tool(s): ${route.toolCalls.map((t) => t.toolId).join(', ')}.`,
    toolCalls: toolResults,
  };

  const next: WorkflowState = {
    ...state,
    nodeId: route.invokeSpecialist ? 'specialist' : 'synthesize',
    toolResults,
    auditTrail: [...state.auditTrail, step],
  };
  return next;
}

/** Specialist node: invoke domain agent (e.g. compliance) with context for deeper reasoning. */
export async function executeSpecialistNode(state: WorkflowState): Promise<WorkflowState> {
  const route = state.route!;
  const agentId = route.specialistAgent ?? route.selectedAgents[0] ?? 'compliance';
    const toolContext = state.toolResults
    ?.map((t) => (t.error ? `[${t.toolId}: error ${t.error}]` : `[${t.toolId}: ${formatToolResultForWorkflow(t.toolId, t.result) || 'ok'}]`))
    .join(' ') ?? '';

  const reply = await invokeSpecialistAgent({
    agentId,
    userMessage: state.userMessage,
    toolContextSummary: toolContext,
    recentTurns: state.recentTurns,
  });

  const step: AuditStep = {
    agentId,
    at: new Date().toISOString(),
    summary: `Specialist ${agentId} replied.`,
    toolCalls: [],
    reasoning: reply?.slice(0, 200),
  };

  const next: WorkflowState = {
    ...state,
    nodeId: 'synthesize',
    specialistReply: reply ?? '',
    auditTrail: [...state.auditTrail, step],
  };
  return next;
}

/** Synthesize node: build final reply from suggestedReply + tool results + specialist. */
export function executeSynthesizeNode(state: WorkflowState): WorkflowState {
  const route = state.route!;
  const parts: string[] = [];

  if (state.specialistReply) {
    parts.push(state.specialistReply);
  } else if (route.suggestedReply) {
    parts.push(route.suggestedReply);
  }

  if (state.toolResults?.length) {
    const formatted = state.toolResults
      .filter((t) => !t.error)
      .map((t) => formatToolResultForWorkflow(t.toolId, t.result))
      .filter(Boolean);
    if (formatted.length) parts.push(formatted.join(' '));
  }

  const finalReply = parts.length > 0 ? parts.join('\n\n') : "Request processed. If you need more detail, ask a follow-up.";

  return {
    ...state,
    nodeId: 'end',
    finalReply,
  };
}
