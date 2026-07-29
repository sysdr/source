/**
 * SLO instrumentation (REQ-031 / REQ-066 / T-036).
 * Records API/batch timings at the server boundary; exposes p95 summaries.
 */

export type SloOperation =
  | 'ledger_query'
  | 'payroll_batch'
  | 'compliance_export'
  | 'stripe_sync'
  | 'ai_assistant'
  | 'http_request';

export const SLO_TARGETS_MS: Record<SloOperation, number> = {
  ledger_query: 500,
  payroll_batch: 5_000,
  compliance_export: 10_000,
  stripe_sync: 30_000,
  ai_assistant: 8_000,
  http_request: 2_000,
};

export interface SloSample {
  operation: SloOperation;
  durationMs: number;
  ok: boolean;
  at: string;
  label?: string;
  orgId?: string;
}

export interface SloSummary {
  operation: SloOperation;
  targetMs: number;
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorRate: number;
  withinSlo: boolean;
}

const MAX_SAMPLES = 2_000;
const samples: SloSample[] = [];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function recordSloSample(sample: Omit<SloSample, 'at'> & { at?: string }): SloSample {
  const full: SloSample = {
    ...sample,
    at: sample.at ?? new Date().toISOString(),
  };
  samples.push(full);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
  return full;
}

export async function timeSloOperation<T>(
  operation: SloOperation,
  fn: () => Promise<T>,
  meta?: { label?: string; orgId?: string },
): Promise<T> {
  const start = Date.now();
  let ok = true;
  try {
    return await fn();
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    recordSloSample({
      operation,
      durationMs: Date.now() - start,
      ok,
      label: meta?.label,
      orgId: meta?.orgId,
    });
  }
}

export function summarizeSlo(operation?: SloOperation): SloSummary[] {
  const ops = operation
    ? [operation]
    : (Object.keys(SLO_TARGETS_MS) as SloOperation[]);

  return ops.map((op) => {
    const subset = samples.filter((s) => s.operation === op);
    const durations = subset.map((s) => s.durationMs).sort((a, b) => a - b);
    const errors = subset.filter((s) => !s.ok).length;
    const p95 = percentile(durations, 95);
    const target = SLO_TARGETS_MS[op];
    return {
      operation: op,
      targetMs: target,
      count: subset.length,
      p50Ms: percentile(durations, 50),
      p95Ms: p95,
      p99Ms: percentile(durations, 99),
      maxMs: durations.length ? durations[durations.length - 1] : 0,
      errorRate: subset.length ? errors / subset.length : 0,
      withinSlo: subset.length === 0 || p95 <= target,
    };
  });
}

export function classifyHttpPath(path: string): SloOperation {
  if (path.startsWith('/api/transactions') || path.startsWith('/api/journals')) return 'ledger_query';
  if (path.startsWith('/api/payroll')) return 'payroll_batch';
  if (path.includes('/exports') || path.includes('/filings') || path.includes('/compliance')) return 'compliance_export';
  if (path.includes('/stripe')) return 'stripe_sync';
  if (path.includes('/orchestrator') || path.includes('/claude') || path.includes('/ai')) return 'ai_assistant';
  return 'http_request';
}

/** Test helper */
export function _resetSloSamplesForTests(): void {
  samples.length = 0;
}

export function _getSloSampleCount(): number {
  return samples.length;
}
