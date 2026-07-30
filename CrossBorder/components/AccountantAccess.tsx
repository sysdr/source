import React, { useEffect, useState } from 'react';
import { setAccessRole, setAccountantToken } from '../services/apiClient';
import { getServerBaseUrl } from '../services/serverUrl';

const BASE = getServerBaseUrl();

interface Props {
  token: string;
}

/**
 * Public accountant entry (#/accountant?token=…) — activates 72h read-only session (REQ-073).
 */
const AccountantAccess: React.FC<Props> = ({ token }) => {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('Opening read-only accountant session…');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/accountant-invites/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const json = await res.json() as {
          ok?: boolean;
          error?: string;
          invite?: { orgName?: string; expiresAt?: string };
        };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setStatus('error');
          setMessage(json.error || 'Invite is invalid or expired');
          return;
        }
        setAccountantToken(token);
        setAccessRole('accountant');
        setOrgName(json.invite?.orgName ?? null);
        setExpiresAt(json.invite?.expiresAt ?? null);
        setStatus('ok');
        setMessage('Read-only access granted. You can export filings but cannot modify records.');
        window.setTimeout(() => {
          window.location.hash = '';
          window.location.reload();
        }, 1600);
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setMessage((err as Error).message || 'Failed to open invite');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-page, #f8fafc)' }}>
      <div className="max-w-md w-full p-8 rounded-3xl border shadow-sm space-y-3" style={{ background: 'var(--bg-elevated, #fff)', borderColor: 'var(--border-subtle, #e2e8f0)' }}>
        <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Accountant access</p>
        <h1 className="text-xl font-bold" style={{ color: status === 'error' ? '#dc2626' : 'var(--text-primary)' }}>
          {status === 'loading' ? 'Validating invite…' : status === 'ok' ? 'Access granted' : 'Access denied'}
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message}</p>
        {orgName && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Organisation: {orgName}</p>}
        {expiresAt && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Expires: {new Date(expiresAt).toLocaleString()}</p>}
        {status === 'ok' && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Redirecting to dashboard…</p>}
      </div>
    </div>
  );
};

export default AccountantAccess;
