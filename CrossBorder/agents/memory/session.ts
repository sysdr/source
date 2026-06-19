/**
 * Short-term memory: current session thread (recent user/assistant turns).
 * Used by the orchestrator to avoid re-asking and for context.
 */

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

const MAX_TURNS = 20;
const SESSION_KEY = 'suez_agent_session';

export function getSessionTurns(sessionId?: string): Turn[] {
  try {
    const key = sessionId ? `${SESSION_KEY}_${sessionId}` : SESSION_KEY;
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Turn[];
    return Array.isArray(arr) ? arr.slice(-MAX_TURNS) : [];
  } catch {
    return [];
  }
}

export function appendTurn(role: 'user' | 'assistant', content: string, sessionId?: string): void {
  const key = sessionId ? `${SESSION_KEY}_${sessionId}` : SESSION_KEY;
  const turns = getSessionTurns(sessionId);
  turns.push({ role, content, at: new Date().toISOString() });
  sessionStorage.setItem(key, JSON.stringify(turns.slice(-MAX_TURNS)));
}

export function clearSession(sessionId?: string): void {
  const key = sessionId ? `${SESSION_KEY}_${sessionId}` : SESSION_KEY;
  sessionStorage.removeItem(key);
}
