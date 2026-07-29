/**
 * Standardized async operation states (REQ-075 / T-035).
 * Never surface stack traces — name the step and remediation.
 */

export type AsyncPhase = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncOperationState<T = unknown> {
  phase: AsyncPhase;
  /** Short label of the current/last step (e.g. "Stripe sync") */
  step: string | null;
  /** User-safe message */
  message: string | null;
  /** What the user should do next on error */
  remediation: string | null;
  /** Optional success payload summary */
  detail: string | null;
  result: T | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export const IDLE_ASYNC_STATE: AsyncOperationState = {
  phase: 'idle',
  step: null,
  message: null,
  remediation: null,
  detail: null,
  result: null,
  startedAt: null,
  finishedAt: null,
};

const STACK_HINT = /\bat\s+\S+\s+\(|Error:\s*|TypeError:|ReferenceError:|ENOENT|ECONNREFUSED/i;

/**
 * Strip stack traces / raw exception noise into a short user message.
 */
export function formatUserError(error: unknown, step: string): { message: string; remediation: string } {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const cleaned = raw
    .split('\n')
    .filter((line) => !/^\s*at\s+/.test(line))
    .join(' ')
    .replace(STACK_HINT, '')
    .trim()
    .slice(0, 240);

  const message = cleaned
    ? `${step} failed: ${cleaned}`
    : `${step} failed`;

  let remediation = 'Retry the operation. If it keeps failing, check your connection and try again.';
  const lower = raw.toLowerCase();
  if (lower.includes('429') || lower.includes('rate limit')) {
    remediation = 'The provider rate-limited this request. Wait a minute, then retry.';
  } else if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    remediation = 'Check API credentials and role permissions, then retry.';
  } else if (lower.includes('timeout') || lower.includes('network') || lower.includes('fetch')) {
    remediation = 'Check your network connection and that the API server is running, then retry.';
  } else if (lower.includes('acknowledgement') || lower.includes('validation')) {
    remediation = 'Fix the highlighted validation issue, then retry.';
  }

  return { message, remediation };
}

export interface RunAsyncOptions<T> {
  step: string;
  run: () => Promise<T>;
  successDetail?: (result: T) => string;
  onState?: (state: AsyncOperationState<T>) => void;
}

export async function runAsyncOperation<T>(
  options: RunAsyncOptions<T>,
): Promise<AsyncOperationState<T>> {
  const startedAt = new Date().toISOString();
  const loading: AsyncOperationState<T> = {
    phase: 'loading',
    step: options.step,
    message: `${options.step} in progress…`,
    remediation: null,
    detail: null,
    result: null,
    startedAt,
    finishedAt: null,
  };
  options.onState?.(loading);

  try {
    const result = await options.run();
    const success: AsyncOperationState<T> = {
      phase: 'success',
      step: options.step,
      message: `${options.step} completed`,
      remediation: null,
      detail: options.successDetail?.(result) ?? null,
      result,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    options.onState?.(success);
    return success;
  } catch (error) {
    const { message, remediation } = formatUserError(error, options.step);
    const failed: AsyncOperationState<T> = {
      phase: 'error',
      step: options.step,
      message,
      remediation,
      detail: null,
      result: null,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    options.onState?.(failed);
    return failed;
  }
}
