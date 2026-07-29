/**
 * FX provider staleness checks (REQ-033 / REQ-047 / T-037).
 * Latest USD/INR must be ≤ 4h stale during business hours; fallback to last known.
 */

export const FX_MAX_STALENESS_MS = 4 * 60 * 60 * 1000;

export interface FxRateSnapshot {
  rate: number;
  fetchedAt: string;
  source: 'frankfurter' | 'manual' | 'fallback' | 'cache';
  pair: string;
}

export interface FxStalenessResult {
  stale: boolean;
  ageMs: number;
  maxAgeMs: number;
  withinBusinessHours: boolean;
  message: string;
  snapshot: FxRateSnapshot | null;
}

/** Mon–Fri 09:00–18:00 in Asia/Kolkata (approx via UTC+5:30 offset). */
export function isBusinessHoursIST(nowMs = Date.now()): boolean {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(nowMs + istOffsetMs);
  const day = ist.getUTCDay(); // 0 Sun … 6 Sat in shifted clock
  if (day === 0 || day === 6) return false;
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= 9 * 60 && minutes < 18 * 60;
}

export function assessFxStaleness(
  snapshot: FxRateSnapshot | null | undefined,
  opts?: { nowMs?: number; maxAgeMs?: number },
): FxStalenessResult {
  const nowMs = opts?.nowMs ?? Date.now();
  const maxAgeMs = opts?.maxAgeMs ?? FX_MAX_STALENESS_MS;
  const withinBusinessHours = isBusinessHoursIST(nowMs);

  if (!snapshot || !(snapshot.rate > 0)) {
    return {
      stale: true,
      ageMs: Number.POSITIVE_INFINITY,
      maxAgeMs,
      withinBusinessHours,
      message: 'No FX rate available — using fallback',
      snapshot: snapshot ?? null,
    };
  }

  const fetched = new Date(snapshot.fetchedAt).getTime();
  const ageMs = Number.isFinite(fetched) ? Math.max(0, nowMs - fetched) : Number.POSITIVE_INFINITY;
  const stale = withinBusinessHours ? ageMs > maxAgeMs : ageMs > maxAgeMs * 3;

  return {
    stale,
    ageMs,
    maxAgeMs,
    withinBusinessHours,
    message: stale
      ? `FX rate is stale (${Math.round(ageMs / 60_000)}m old${withinBusinessHours ? ' during business hours' : ''}) — refresh recommended`
      : `FX rate fresh (${Math.round(ageMs / 60_000)}m old)`,
    snapshot,
  };
}

export function shouldRefreshFxRate(result: FxStalenessResult): boolean {
  return result.stale;
}
