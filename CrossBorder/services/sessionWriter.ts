/**
 * Single-writer session guard (REQ-070 / T-032).
 * One active writer session per org; concurrent claim logs a warning.
 */
export const WRITER_HEARTBEAT_TTL_MS = 5 * 60 * 1000;

export interface WriterSession {
  sessionId: string;
  claimedAt: string;
  lastHeartbeatAt: string;
  label?: string;
}

export interface ClaimResult {
  status: 'claimed' | 'renewed' | 'conflict' | 'released';
  writer: WriterSession | null;
  /** Set when another session holds the write lock */
  conflictWith?: WriterSession;
  warning?: string;
}

export function isWriterSessionActive(
  writer: WriterSession | null | undefined,
  nowMs = Date.now(),
  ttlMs = WRITER_HEARTBEAT_TTL_MS,
): boolean {
  if (!writer?.lastHeartbeatAt) return false;
  const last = new Date(writer.lastHeartbeatAt).getTime();
  if (!Number.isFinite(last)) return false;
  return nowMs - last <= ttlMs;
}

export function claimWriterSession(
  current: WriterSession | null | undefined,
  sessionId: string,
  opts?: { label?: string; nowMs?: number; ttlMs?: number },
): ClaimResult {
  const nowMs = opts?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const ttl = opts?.ttlMs ?? WRITER_HEARTBEAT_TTL_MS;

  if (isWriterSessionActive(current, nowMs, ttl) && current!.sessionId !== sessionId) {
    return {
      status: 'conflict',
      writer: current!,
      conflictWith: current!,
      warning: `Concurrent session detected — write lock held by ${current!.sessionId.slice(0, 8)}… since ${current!.claimedAt}`,
    };
  }

  if (current?.sessionId === sessionId && isWriterSessionActive(current, nowMs, ttl)) {
    const renewed: WriterSession = {
      ...current,
      lastHeartbeatAt: nowIso,
      label: opts?.label ?? current.label,
    };
    return { status: 'renewed', writer: renewed };
  }

  const claimed: WriterSession = {
    sessionId,
    claimedAt: current?.sessionId === sessionId ? current.claimedAt : nowIso,
    lastHeartbeatAt: nowIso,
    label: opts?.label,
  };
  return { status: 'claimed', writer: claimed };
}

export function heartbeatWriterSession(
  current: WriterSession | null | undefined,
  sessionId: string,
  opts?: { nowMs?: number; ttlMs?: number },
): ClaimResult {
  const nowMs = opts?.nowMs ?? Date.now();
  if (!isWriterSessionActive(current, nowMs, opts?.ttlMs) || current?.sessionId !== sessionId) {
    return claimWriterSession(current, sessionId, opts);
  }
  const renewed: WriterSession = {
    ...current!,
    lastHeartbeatAt: new Date(nowMs).toISOString(),
  };
  return { status: 'renewed', writer: renewed };
}

export function releaseWriterSession(
  current: WriterSession | null | undefined,
  sessionId: string,
): ClaimResult {
  if (!current || current.sessionId !== sessionId) {
    return { status: 'released', writer: current ?? null };
  }
  return { status: 'released', writer: null };
}
