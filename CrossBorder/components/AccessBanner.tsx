import React, { useEffect, useState } from 'react';
import { getAccessRole, getOrCreateWriterSessionId } from '../services/apiClient';
import { StorageKeys } from '../services/storageService';

const BASE = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL
  ?? 'http://localhost:3001';

/**
 * Visible single-writer + read-only collaborator banner (REQ-070 / REQ-073).
 */
const AccessBanner: React.FC = () => {
  const role = getAccessRole();
  const [writerMsg, setWriterMsg] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'owner') return;
    const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID);
    if (!orgId) return;
    const sessionId = getOrCreateWriterSessionId();
    let cancelled = false;

    const claim = async () => {
      try {
        const res = await fetch(`${BASE}/api/session/writer/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-SUEZ-ROLE': 'owner' },
          body: JSON.stringify({ orgId, sessionId, label: 'Browser owner' }),
        });
        const json = await res.json() as { status?: string; warning?: string; message?: string };
        if (cancelled) return;
        if (res.status === 409) {
          setWriterMsg(json.warning || 'Another session holds the write lock — this tab is effectively read-only until released.');
        } else {
          setWriterMsg('Single-writer mode: this browser session holds the edit lock (MVP).');
        }
      } catch {
        /* server optional */
      }
    };

    void claim();
    const beat = window.setInterval(() => {
      void fetch(`${BASE}/api/session/writer/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, sessionId }),
      }).catch(() => undefined);
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(beat);
    };
  }, [role]);

  if (role === 'accountant') {
    return (
      <div className="px-4 py-2 text-xs font-semibold text-center" style={{ background: '#e0f2fe', color: '#0369a1' }}>
        Accountant read-only session — exports allowed; create/edit blocked (72-hour invite).
      </div>
    );
  }

  if (!writerMsg) return null;
  return (
    <div className="px-4 py-2 text-xs font-semibold text-center" style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
      {writerMsg}
    </div>
  );
};

export default AccessBanner;
