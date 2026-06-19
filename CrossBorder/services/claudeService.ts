/**
 * claudeService.ts — Agentic orchestrator using Claude claude-sonnet-4-6 with native tool-use.
 *
 * Replaces the Gemini routing pipeline (route → tools → specialist → synthesize)
 * with a proper Claude agentic loop:
 *   1. Send user message + all tool definitions to Claude
 *   2. Claude decides which tools to call (native tool_use)
 *   3. Execute tools deterministically
 *   4. Feed tool_results back to Claude
 *   5. Repeat until Claude returns end_turn
 *
 * Session history is persisted to SQLite (agent_sessions table).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AuditStep, AgentId, OrchestratorResult, AgentRun } from '../agents/types';
import type { ToolId } from '../agents/types';
import { toolDefs } from '../agents/tools/definitions';
import { runTool } from '../agents/tools';

const MAX_TOOL_TURNS = 12;
const MODEL = 'claude-sonnet-4-6';

// ─── Tool schema builder ───────────────────────────────────────────────────────

/**
 * Full input schemas for all tools — used by Claude to understand parameters.
 * Covers both tools with declared params and those whose params are implicit.
 */
const TOOL_INPUT_SCHEMAS: Record<string, Anthropic.Tool['input_schema']> = {
  read_company_profile:  { type: 'object', properties: {}, required: [] },
  read_transactions:     { type: 'object', properties: {}, required: [] },
  read_employees:        { type: 'object', properties: {}, required: [] },
  read_revenue_data:     { type: 'object', properties: {}, required: [] },
  read_payroll_runs:     { type: 'object', properties: {}, required: [] },
  read_transfer_pricing: { type: 'object', properties: {}, required: [] },
  read_tax_engine:       { type: 'object', properties: {}, required: [] },
  read_platform_rules:   { type: 'object', properties: {}, required: [] },
  read_vault_summary:    { type: 'object', properties: {}, required: [] },
  read_leave_requests:   { type: 'object', properties: {}, required: [] },
  read_pending_transactions: { type: 'object', properties: {}, required: [] },
  stripe_sync:           { type: 'object', properties: {}, required: [] },
  read_leave_balances: {
    type: 'object',
    properties: {
      employeeId: { type: 'string', description: 'Employee ID to get leave balances for' },
      year:       { type: 'number', description: 'Calendar year (defaults to current year)' },
    },
    required: ['employeeId'],
  },
  fx_rate: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Source currency code, e.g. USD' },
      to:   { type: 'string', description: 'Target currency code, e.g. INR' },
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (defaults to today)' },
    },
    required: [],
  },
  tax_calculate: {
    type: 'object',
    properties: {
      amount:      { type: 'number', description: 'Amount to calculate tax on' },
      fromCountry: { type: 'string', description: 'Source country code, e.g. US' },
      toCountry:   { type: 'string', description: 'Destination country code, e.g. IN' },
      productType: { type: 'string', description: 'Type: service, goods, digital' },
    },
    required: ['amount'],
  },
  compliance_advice: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The compliance question to answer' },
    },
    required: ['query'],
  },
  analyze_invoice: {
    type: 'object',
    properties: {
      invoiceText: { type: 'string', description: 'Raw invoice text to analyze for compliance' },
    },
    required: ['invoiceText'],
  },
  add_transaction: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Transaction description' },
      amount:      { type: 'number', description: 'Amount in base currency' },
      type:        { type: 'string', enum: ['Income', 'Expense', 'Purchase'], description: 'Transaction type' },
      category:    { type: 'string', description: 'Category, e.g. SaaS & Hosting, Payroll' },
      date:        { type: 'string', description: 'Date in YYYY-MM-DD (defaults to today)' },
      entity:      { type: 'string', enum: ['parent', 'subsidiary'], description: 'Entity (optional)' },
    },
    required: ['description', 'amount', 'type'],
  },
  approve_pending_transaction: {
    type: 'object',
    properties: {
      transactionId: { type: 'string', description: 'ID of the pending transaction to approve' },
    },
    required: ['transactionId'],
  },
};

function buildClaudeTools(): Anthropic.Tool[] {
  return toolDefs.map((def) => ({
    name: def.id,
    description: def.description,
    input_schema: TOOL_INPUT_SCHEMAS[def.id] ?? { type: 'object' as const, properties: {}, required: [] },
  }));
}

// ─── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(orgContextLine: string): string {
  return `You are the AI financial controller for CrossBorder (Project Suez) — an ERP for Indian founders operating an Indian LLP with a US C-Corp subsidiary.

Org context: ${orgContextLine}

You have access to tools that read financial data, sync revenue, and post transactions. Use them to answer questions accurately.

Guidelines:
- Tax and accounting math must always come from tools, never from your own arithmetic
- For questions about employees, payroll, transactions, or revenue — always call the relevant read tool first
- For compliance/regulatory questions — always use compliance_advice tool
- After reading data, synthesize a clear concise answer for the user
- When posting transactions (add_transaction), confirm details before posting
- Be concise and professional`;
}

// ─── Main orchestrator ─────────────────────────────────────────────────────────

export interface ClaudeRunInput {
  userMessage: string;
  orgContextLine: string;
  sessionId?: string;
  orgId?: string;
  /** Short-term turns from the current UI session (not persisted history) */
  recentTurns?: { role: 'user' | 'assistant'; content: string }[];
}

export async function runClaudeOrchestrator(input: ClaudeRunInput): Promise<OrchestratorResult> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.API_KEY ?? '',
  });

  const tools = buildClaudeTools();
  const auditTrail: AuditStep[] = [];
  const toolCallsMade: { toolId: string; params: Record<string, unknown>; result: unknown }[] = [];
  const startedAt = new Date().toISOString();

  // Load persisted session history from SQLite (server-side only)
  let persistedHistory: Anthropic.MessageParam[] = [];
  if (input.sessionId && input.orgId && typeof window === 'undefined') {
    try {
      // Server-only import: keep browser bundle from resolving Node modules.
      const serverDbModule = '../server/db.js';
      const { getSessionMessages } = await import(/* @vite-ignore */ serverDbModule);
      const rows = getSessionMessages(input.sessionId, input.orgId, 40);
      persistedHistory = rows.map((r) => ({
        role: r.role,
        content: r.content as Anthropic.MessageParam['content'],
      }));
    } catch {
      // Running in browser or db unavailable — fall back to recentTurns only
    }
  }

  // Build full message history
  const messages: Anthropic.MessageParam[] = [
    ...persistedHistory,
    // Add any in-memory recent turns not yet in SQLite
    ...(input.recentTurns
      ?.filter((t) => !persistedHistory.some(
        (h) => typeof h.content === 'string' && h.content === t.content && h.role === t.role
      ))
      .map((t) => ({ role: t.role, content: t.content })) ?? []),
    { role: 'user', content: input.userMessage },
  ];

  let turns = 0;
  let finalReply = '';

  while (turns < MAX_TOOL_TURNS) {
    turns++;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: buildSystemPrompt(input.orgContextLine),
      tools,
      messages,
    });

    // Append this assistant turn to messages
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      );
      finalReply = textBlock?.text ?? 'Request processed.';
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        const toolId = toolBlock.name as ToolId;
        const params = toolBlock.input as Record<string, unknown>;

        let result: unknown;
        let isError = false;
        let errorMsg = '';

        try {
          result = await runTool(toolId, params, ['orchestrator']);
        } catch (err) {
          result = { error: (err as Error).message };
          isError = true;
          errorMsg = (err as Error).message;
        }

        toolCallsMade.push({ toolId, params, result });

        auditTrail.push({
          agentId: 'orchestrator' as AgentId,
          at: new Date().toISOString(),
          summary: isError ? `Tool error: ${toolId} — ${errorMsg}` : `Tool: ${toolId}`,
          toolCalls: [{ toolId, params, result, at: new Date().toISOString(), ...(isError && { error: errorMsg }) }],
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
          is_error: isError,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // pause_turn or other stop reason — extract any text and stop
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    finalReply = textBlock?.text ?? 'Request processed.';
    break;
  }

  if (!finalReply) {
    finalReply = 'Maximum reasoning steps reached. Please try a more specific question.';
  }

  // Persist assistant reply to SQLite session history
  if (input.sessionId && input.orgId && typeof window === 'undefined') {
    try {
      const serverDbModule = '../server/db.js';
      const { appendSessionMessage } = await import(/* @vite-ignore */ serverDbModule);
      appendSessionMessage(input.sessionId, input.orgId, 'user', input.userMessage);
      appendSessionMessage(input.sessionId, input.orgId, 'assistant', finalReply);
    } catch {
      // Browser context or db unavailable
    }
  }

  const agentsUsed: AgentId[] = ['orchestrator'];
  const run: AgentRun = {
    agentId: 'orchestrator',
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: toolCallsMade.length > 0
      ? toolCallsMade.map((t) => t.toolId).join(', ')
      : 'conversational',
    steps: auditTrail,
    output: finalReply,
  };

  return {
    success: true,
    reply: finalReply,
    agentsUsed,
    runs: [run],
    auditTrail,
    intent: toolCallsMade[0]?.toolId ?? 'conversational',
  };
}

// ─── Streaming variant ─────────────────────────────────────────────────────────

/**
 * Streaming version — yields text deltas as they arrive.
 * Tool calls are executed silently; only the final text reply streams to the caller.
 * Used by the SSE endpoint in server/index.ts.
 */
export async function* streamClaudeOrchestrator(
  input: ClaudeRunInput
): AsyncGenerator<{ type: 'delta'; text: string } | { type: 'done'; result: OrchestratorResult }> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.API_KEY ?? '',
  });

  const tools = buildClaudeTools();
  const auditTrail: AuditStep[] = [];
  const toolCallsMade: { toolId: string; params: Record<string, unknown>; result: unknown }[] = [];
  const startedAt = new Date().toISOString();

  const messages: Anthropic.MessageParam[] = [
    ...(input.recentTurns?.map((t) => ({ role: t.role, content: t.content })) ?? []),
    { role: 'user', content: input.userMessage },
  ];

  let turns = 0;
  let finalReply = '';

  while (turns < MAX_TOOL_TURNS) {
    turns++;

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: buildSystemPrompt(input.orgContextLine),
      tools,
      messages,
    });

    // Stream text deltas
    stream.on('text', (delta) => {
      if (delta) {
        // We yield these after the generator re-enters; collect them
        textBuffer += delta;
      }
    });

    let textBuffer = '';
    // Yield deltas as they come in via async iteration
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'delta', text: event.delta.text };
      }
    }

    const message = await stream.finalMessage();
    messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'end_turn') {
      const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      finalReply = textBlock?.text ?? textBuffer ?? 'Request processed.';
      break;
    }

    if (message.stop_reason === 'tool_use') {
      const toolUseBlocks = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        const toolId = toolBlock.name as ToolId;
        const params = toolBlock.input as Record<string, unknown>;
        let result: unknown;
        let isError = false;

        try {
          result = await runTool(toolId, params, ['orchestrator']);
        } catch (err) {
          result = { error: (err as Error).message };
          isError = true;
        }

        toolCallsMade.push({ toolId, params, result });
        auditTrail.push({
          agentId: 'orchestrator' as AgentId,
          at: new Date().toISOString(),
          summary: `Tool: ${toolId}`,
          toolCalls: [{ toolId, params, result, at: new Date().toISOString() }],
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
          is_error: isError,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    finalReply = textBlock?.text ?? textBuffer ?? 'Request processed.';
    break;
  }

  const run: AgentRun = {
    agentId: 'orchestrator',
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: toolCallsMade.map((t) => t.toolId).join(', ') || 'conversational',
    steps: auditTrail,
    output: finalReply,
  };

  yield {
    type: 'done',
    result: {
      success: true,
      reply: finalReply,
      agentsUsed: ['orchestrator'],
      runs: [run],
      auditTrail,
      intent: toolCallsMade[0]?.toolId ?? 'conversational',
    },
  };
}
