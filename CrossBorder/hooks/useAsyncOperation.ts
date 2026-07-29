import { useCallback, useState } from 'react';
import {
  IDLE_ASYNC_STATE,
  runAsyncOperation,
  type AsyncOperationState,
} from '../services/asyncOperation';

export function useAsyncOperation<T = unknown>() {
  const [state, setState] = useState<AsyncOperationState<T>>(
    IDLE_ASYNC_STATE as AsyncOperationState<T>,
  );

  const reset = useCallback(() => {
    setState(IDLE_ASYNC_STATE as AsyncOperationState<T>);
  }, []);

  const run = useCallback(
    async (
      step: string,
      fn: () => Promise<T>,
      successDetail?: (result: T) => string,
    ) => {
      return runAsyncOperation<T>({
        step,
        run: fn,
        successDetail,
        onState: setState,
      });
    },
    [],
  );

  return { state, run, reset, isLoading: state.phase === 'loading' };
}
