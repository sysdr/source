import React from 'react';
import type { AsyncOperationState } from '../services/asyncOperation';

interface Props {
  state: AsyncOperationState;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Shared loading / success / error banner for async ops (REQ-075).
 */
const AsyncStatusBanner: React.FC<Props> = ({ state, onDismiss, className }) => {
  if (state.phase === 'idle') return null;

  const styles =
    state.phase === 'loading'
      ? { bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' }
      : state.phase === 'success'
        ? { bg: '#ecfdf5', border: '#a7f3d0', color: '#047857' }
        : { bg: '#fef2f2', border: '#fecaca', color: '#991b1b' };

  return (
    <div
      role={state.phase === 'error' ? 'alert' : 'status'}
      aria-live={state.phase === 'loading' ? 'polite' : 'assertive'}
      className={className}
      style={{
        padding: '12px 16px',
        borderRadius: 12,
        border: `1px solid ${styles.border}`,
        background: styles.bg,
        color: styles.color,
        fontSize: 13,
        fontWeight: 500,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>
          {state.phase === 'loading' && 'Working…'}
          {state.phase === 'success' && 'Success'}
          {state.phase === 'error' && 'Something went wrong'}
          {state.step ? ` · ${state.step}` : ''}
        </div>
        {state.message && <div>{state.message}</div>}
        {state.detail && state.phase === 'success' && (
          <div style={{ marginTop: 4, opacity: 0.9 }}>{state.detail}</div>
        )}
        {state.remediation && state.phase === 'error' && (
          <div style={{ marginTop: 6, fontWeight: 600 }}>Next: {state.remediation}</div>
        )}
      </div>
      {(state.phase === 'success' || state.phase === 'error') && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: styles.color,
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
};

export default AsyncStatusBanner;
