/**
 * Persisted audit log for orchestrator runs – supports compliance and debugging.
 */

export interface StoredAuditRun {
  id: string;
  at: string;
  userMessage: string;
  reply: string;
  agentsUsed: string[];
  intent?: string;
  toolCalls: { toolId: string; params?: Record<string, unknown>; error?: string }[];
  success: boolean;
}

const KEY = 'suez_agent_audit_log';
const MAX_RUNS = 50;

export function getAgentAuditLog(): StoredAuditRun[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as StoredAuditRun[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function appendAgentAuditRun(run: Omit<StoredAuditRun, 'id' | 'at'>): void {
  const full: StoredAuditRun = {
    ...run,
    id: `audit-${Date.now()}`,
    at: new Date().toISOString(),
  };
  const log = getAgentAuditLog();
  log.unshift(full);
  localStorage.setItem(KEY, JSON.stringify(log.slice(0, MAX_RUNS)));
}
