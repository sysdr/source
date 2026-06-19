/**
 * Workflow graph runner – executes nodes in sequence until end or error.
 * Linear graph: route → tools → specialist? → synthesize → end
 */

import type { WorkflowState, WorkflowNodeId, OrchestratorResult, AgentId, RunMetrics } from '../types';
import { getOrgContextLine } from '../memory';
import { getSessionTurns } from '../memory/session';
import { appendAgentAuditRun } from '../memory/auditLog';
import { executeRouteNode, executeToolsNode, executeSpecialistNode, executeSynthesizeNode } from './nodes';
import { recordNodeEnter, recordNodeExit, getCurrentRunMetrics, startRun, recordToolCalls, recordSpecialistInvoked } from '../observability';

const MAX_STEPS = 20;

function createInitialState(input: {
  userMessage: string;
  sessionId?: string;
  recentTurns?: { role: 'user' | 'assistant'; content: string }[];
}): WorkflowState {
  const orgContextLine = getOrgContextLine();
  const recentTurns =
    input.recentTurns ??
    getSessionTurns(input.sessionId).map((t) => ({ role: t.role, content: t.content }));

  return {
    nodeId: 'route',
    userMessage: input.userMessage,
    sessionId: input.sessionId,
    orgContextLine,
    recentTurns,
    finalReply: '',
    auditTrail: [],
    runs: [],
  };
}

/** Run one step: execute current node and return next state. */
async function runStep(state: WorkflowState): Promise<WorkflowState> {
  const nodeId = state.nodeId;
  recordNodeEnter(nodeId);

  let next: WorkflowState;
  try {
    switch (nodeId) {
      case 'route':
        next = await executeRouteNode(state);
        break;
      case 'tools':
        next = await executeToolsNode(state);
        break;
      case 'specialist':
        next = await executeSpecialistNode(state);
        break;
      case 'synthesize':
        next = executeSynthesizeNode(state);
        break;
      case 'end':
      case 'pause_approval':
        return state;
      default:
        next = { ...state, nodeId: 'end' };
    }
  } finally {
    recordNodeExit(nodeId);
  }

  return next;
}

/** Run the full workflow until end or max steps; return OrchestratorResult. */
export async function runWorkflow(input: {
  userMessage: string;
  sessionId?: string;
  recentTurns?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<OrchestratorResult> {
  startRun();
  let state = createInitialState(input);
  const startedAt = new Date().toISOString();
  let steps = 0;

  try {
    while (state.nodeId !== 'end' && state.nodeId !== 'pause_approval' && steps < MAX_STEPS) {
      state = await runStep(state);
      if (state.toolResults?.length) recordToolCalls(state.toolResults.length);
      if (state.specialistReply) recordSpecialistInvoked();
      steps++;
    }
  } catch (err) {
    const errorMessage = (err as Error).message;
    state = {
      ...state,
      nodeId: 'end',
      finalReply: state.finalReply || "I couldn't complete the requested action. Please try again.",
      auditTrail: [
        ...state.auditTrail,
        {
          agentId: 'orchestrator',
          at: new Date().toISOString(),
          summary: `Workflow error: ${errorMessage}`,
          toolCalls: [],
        },
      ],
    };
    const metrics = getCurrentRunMetrics();
    if (metrics) {
      metrics.finishedAt = new Date().toISOString();
      metrics.success = false;
      metrics.error = errorMessage;
    }
    return {
      success: false,
      reply: state.finalReply || (err as Error).message,
      agentsUsed: state.route ? ['orchestrator', ...state.route.selectedAgents] : ['orchestrator', 'compliance'],
      runs: state.runs,
      auditTrail: state.auditTrail,
      intent: state.route?.intent,
      error: errorMessage,
    };
  }

  const agentsUsed: AgentId[] = state.route
    ? ['orchestrator', ...state.route.selectedAgents]
    : ['orchestrator', 'compliance'];
  const toolCallsForAudit = state.toolResults ?? [];
  const runSummary = state.auditTrail[0]?.summary ?? state.route?.intent ?? 'general';

  state.runs.push({
    agentId: 'orchestrator',
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: runSummary,
    steps: state.auditTrail,
    output: state.finalReply,
  });

  appendAgentAuditRun({
    userMessage: input.userMessage,
    reply: state.finalReply || '',
    agentsUsed: agentsUsed as string[],
    intent: state.route?.intent,
    toolCalls: toolCallsForAudit.map((t) => ({ toolId: t.toolId, params: t.params, error: t.error })),
    success: true,
  });

  const metrics = getCurrentRunMetrics();
  if (metrics) {
    metrics.finishedAt = new Date().toISOString();
    metrics.success = !state.auditTrail.some((s) => s.summary.startsWith('Workflow error'));
  }

  return {
    success: true,
    reply: state.finalReply || "Request processed. If you need more detail, ask a follow-up.",
    agentsUsed,
    runs: state.runs,
    auditTrail: state.auditTrail,
    intent: state.route?.intent,
  };
}

export type { WorkflowState, WorkflowNodeId };
