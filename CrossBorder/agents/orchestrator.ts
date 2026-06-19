/**
 * Orchestration layer — routes to Claude claude-sonnet-4-6 with native tool-use.
 *
 * Replaces the Gemini linear pipeline (route → tools → specialist → synthesize)
 * with Claude's agentic tool-use loop via services/claudeService.ts.
 *
 * Falls back to the Gemini workflow if ANTHROPIC_API_KEY is not set,
 * so the app still works without the Claude key.
 */

import type { OrchestratorInput, OrchestratorResult } from './types';
import { getOrgContextLine } from './memory';

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const hasClaudeKey = !!(process.env.ANTHROPIC_API_KEY ?? process.env.API_KEY);

  if (hasClaudeKey) {
    const { runClaudeOrchestrator } = await import('../services/claudeService.js');
    return runClaudeOrchestrator({
      userMessage:   input.userMessage,
      orgContextLine: getOrgContextLine(),
      sessionId:     input.sessionId,
      orgId:         (input as { orgId?: string }).orgId,
      recentTurns:   input.recentTurns,
    });
  }

  // Fallback: original Gemini workflow
  const { runWorkflow } = await import('./workflow/graph.js');
  return runWorkflow({
    userMessage:  input.userMessage,
    sessionId:    input.sessionId,
    recentTurns:  input.recentTurns,
  });
}
