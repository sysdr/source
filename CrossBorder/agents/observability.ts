/**
 * Observability – per-run metrics (node visits, tool count, latency).
 * Can be extended with a callback to send to logging/analytics.
 */

import type { WorkflowNodeId, RunMetrics } from './types';

let currentRunId: string | null = null;
let currentMetrics: RunMetrics | null = null;
const nodeEnterTime = new Map<WorkflowNodeId, number>();

export function startRun(): string {
  const runId = `run-${Date.now()}`;
  currentRunId = runId;
  currentMetrics = {
    runId,
    startedAt: new Date().toISOString(),
    nodeVisits: [],
    toolCallCount: 0,
    specialistInvoked: false,
    success: false,
  };
  nodeEnterTime.clear();
  return runId;
}

export function recordNodeEnter(nodeId: WorkflowNodeId): void {
  nodeEnterTime.set(nodeId, Date.now());
  if (currentMetrics) {
    currentMetrics.nodeVisits.push({ nodeId, at: new Date().toISOString() });
  }
}

export function recordNodeExit(nodeId: WorkflowNodeId): void {
  const entered = nodeEnterTime.get(nodeId);
  nodeEnterTime.delete(nodeId);
  if (currentMetrics && currentMetrics.nodeVisits.length > 0) {
    const last = currentMetrics.nodeVisits[currentMetrics.nodeVisits.length - 1];
    if (last.nodeId === nodeId && entered !== undefined) {
      (last as { durationMs?: number }).durationMs = Date.now() - entered;
    }
  }
}

export function recordToolCalls(count: number): void {
  if (currentMetrics) currentMetrics.toolCallCount += count;
}

export function recordSpecialistInvoked(): void {
  if (currentMetrics) currentMetrics.specialistInvoked = true;
}

export function getCurrentRunMetrics(): RunMetrics | null {
  return currentMetrics ?? null;
}

export function clearRun(): void {
  currentRunId = null;
  currentMetrics = null;
  nodeEnterTime.clear();
}
