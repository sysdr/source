import React from 'react';
import { useViewport } from '../hooks/useViewport';
import { desktopEntryBlockedMessage } from '../services/responsive';

interface Props {
  /** Feature name shown in the mobile notice */
  feature: string;
  /** Interactive controls (forms, run buttons) — hidden/disabled on mobile */
  children: React.ReactNode;
  /** Optional always-visible read-only content (lists, summaries) */
  readOnly?: React.ReactNode;
}

/**
 * Desktop-only gate for mutation UX (REQ-074).
 * Mobile: show notice + readOnly; hide interactive children.
 */
const DesktopOnlyGate: React.FC<Props> = ({ feature, children, readOnly }) => {
  const { allowsDataEntry } = useViewport();

  if (allowsDataEntry) {
    return (
      <>
        {readOnly}
        {children}
      </>
    );
  }

  return (
    <>
      <div
        role="status"
        className="desktop-only-notice"
        style={{
          padding: '12px 16px',
          borderRadius: 12,
          border: '1px solid #fde68a',
          background: '#fffbeb',
          color: '#92400e',
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 12,
        }}
      >
        {desktopEntryBlockedMessage(feature)}
      </div>
      {readOnly}
    </>
  );
};

export default DesktopOnlyGate;
