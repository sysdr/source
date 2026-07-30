/**
 * Common landing — magic link / OTP sign-in for Admin and Employee.
 */

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/apiClient';
import { getActiveOrgId, getOrganisationsList, setActiveOrgId } from '../services/storageService';
import { loginAsAdmin, loginAsEmployee, type AppSession } from '../services/sessionAuth';
import { getAppPublicBaseUrl } from '../services/serverUrl';

interface Props {
  orgName?: string | null;
  onSignedIn: (session: AppSession) => void;
  /** Prefill from #/login?token=&orgId= */
  magicToken?: string | null;
  magicOrgId?: string | null;
}

type Step = 'choose' | 'email' | 'code';

const PENDING_KEY = 'suez_magic_pending';

function savePending(p: { orgId: string; email: string }): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

function loadPending(): { orgId: string; email: string } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { orgId?: string; email?: string };
    if (!parsed.orgId || !parsed.email) return null;
    return { orgId: parsed.orgId, email: parsed.email };
  } catch {
    return null;
  }
}

function clearPending(): void {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

/** Survive React Strict Mode remounts for the same magic token. */
const magicTokenInflight = new Map<string, Promise<{
  ok: boolean;
  session?: {
    role: 'admin' | 'employee';
    email: string;
    orgId: string;
    displayName: string;
    employeeId?: string;
  };
  error?: string;
}>>();

function activateOrgIfKnown(orgId: string | undefined): void {
  if (!orgId) return;
  const known = getOrganisationsList().some((o) => o.id === orgId);
  if (known || getActiveOrgId() === orgId) {
    setActiveOrgId(orgId);
  } else {
    // Keep session org id in localStorage even if the org blob is server-only
    try {
      localStorage.setItem('suez_active_org_id', orgId);
    } catch { /* ignore */ }
  }
}

const LandingPage: React.FC<Props> = ({ orgName, onSignedIn, magicToken, magicOrgId }) => {
  const [step, setStep] = useState<Step>('choose');
  const [portal, setPortal] = useState<'admin' | 'employee'>('admin');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [linkPending, setLinkPending] = useState(Boolean(magicToken));
  const signedInRef = useRef(false);

  const orgId = magicOrgId || loadPending()?.orgId || getActiveOrgId() || 'default';
  const [resolvedOrgId, setResolvedOrgId] = useState(() => loadPending()?.orgId || orgId);

  useEffect(() => {
    const pending = loadPending();
    if (!pending || magicToken) return;
    setEmail(pending.email);
    setResolvedOrgId(pending.orgId);
    setStep('code');
    setInfo('Enter the 6-digit code we emailed you.');
  }, [magicToken]);

  const applySession = (s: {
    role: 'admin' | 'employee';
    email: string;
    displayName: string;
    employeeId?: string;
    orgId?: string;
  }) => {
    if (signedInRef.current) return;
    signedInRef.current = true;
    clearPending();

    // Establish session FIRST so App leaves the landing screen before org switches re-render.
    let session: AppSession;
    if (s.role === 'admin') {
      session = loginAsAdmin(
        s.displayName || (orgName ? `${orgName} Admin` : 'Admin'),
        s.email,
        s.orgId,
      );
    } else {
      if (!s.employeeId) {
        signedInRef.current = false;
        setError('Employee session missing profile id.');
        return;
      }
      session = loginAsEmployee({
        employeeId: s.employeeId,
        displayName: s.displayName,
        email: s.email,
        orgId: s.orgId,
      });
    }
    onSignedIn(session);
    activateOrgIfKnown(s.orgId);
  };

  useEffect(() => {
    const onNav = () => {
      // Pick up ?magic_token= if the page was opened from email without a full remount
      const params = new URLSearchParams(window.location.search);
      if (params.get('magic_token') || params.get('token')) {
        window.location.reload();
      }
    };
    window.addEventListener('popstate', onNav);
    return () => window.removeEventListener('popstate', onNav);
  }, []);

  useEffect(() => {
    if (!magicToken) return;
    let cancelled = false;

    const run = async () => {
      setBusy(true);
      setError(null);
      setInfo('Signing you in from magic link…');

      let pending = magicTokenInflight.get(magicToken);
      if (!pending) {
        pending = api.verifyMagicLogin({
          orgId: magicOrgId || orgId,
          token: magicToken,
        });
        magicTokenInflight.set(magicToken, pending);
      }

      const result = await pending;
      if (cancelled) return;
      setBusy(false);
      setLinkPending(false);

      if (!result.ok || !result.session) {
        magicTokenInflight.delete(magicToken);
        setError(result.error || 'Magic link invalid or expired. Request a new code.');
        setInfo(null);
        setStep('choose');
        return;
      }
      applySession(result.session);
    };

    void run();
    return () => { cancelled = true; };
    // Only re-run when the token itself changes — not when orgId shifts mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magicToken]);

  const requestCode = async () => {
    setError(null);
    setInfo(null);
    setDevCode(null);
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setError('Enter a valid work email.');
      return;
    }
    setBusy(true);
    const appBaseUrl = getAppPublicBaseUrl();
    const result = await api.requestMagicLogin({
      orgId,
      email: trimmed,
      role: portal,
      appBaseUrl,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Could not send sign-in email.');
      return;
    }
    if (result.orgId) {
      setResolvedOrgId(result.orgId);
      activateOrgIfKnown(result.orgId);
      savePending({ orgId: result.orgId, email: result.email || trimmed });
    } else {
      savePending({ orgId, email: result.email || trimmed });
    }
    setEmail(result.email || trimmed);
    if (result.devCode) {
      setDevCode(result.devCode);
      setInfo(result.warning || 'SMTP unavailable — use the temporary code below.');
    } else {
      setInfo(
        result.emailSent
          ? `We sent a 6-digit code and magic link to ${result.email}.`
          : (result.warning || 'Check your email for a sign-in code.'),
      );
    }
    setStep('code');
  };

  const verifyCode = async () => {
    setError(null);
    setBusy(true);
    const result = await api.verifyMagicLogin({
      orgId: resolvedOrgId || orgId,
      email: email.trim(),
      code: code.trim(),
    });
    setBusy(false);
    if (!result.ok || !result.session) {
      setError(result.error || 'Invalid code.');
      return;
    }
    applySession(result.session);
  };

  if (linkPending && magicToken) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10"
        style={{ background: 'linear-gradient(160deg, #0b1220 0%, #132033 45%, #0f172a 100%)' }}>
        <div className="bg-white rounded-3xl px-8 py-10 text-center shadow-2xl max-w-sm w-full">
          <div className="spinner spinner-lg mx-auto mb-4" style={{ borderTopColor: '#059669' }} />
          <p className="text-sm text-slate-600">{busy ? 'Signing you in…' : (error || 'Almost there…')}</p>
          {error && (
            <button
              type="button"
              className="mt-4 text-xs font-semibold text-emerald-700"
              onClick={() => { setLinkPending(false); setStep('choose'); }}
            >
              Request a new code
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: 'linear-gradient(160deg, #0b1220 0%, #132033 45%, #0f172a 100%)' }}>
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-300 text-lg font-bold mb-4 border border-emerald-400/20">
            CB
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">CrossBorder</h1>
          <p className="text-slate-400 text-sm mt-2">
            {orgName ? `${orgName} · ` : ''}Sign in with email code or magic link
          </p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 overflow-hidden">
          {step === 'choose' && (
            <div className="p-8 space-y-4">
              <p className="text-sm text-slate-600 text-center mb-2">
                We email a one-time code and magic link via your org SMTP.
              </p>
              <button
                type="button"
                onClick={() => { setPortal('admin'); setStep('email'); setError(null); }}
                className="w-full text-left px-5 py-4 rounded-2xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/60 transition-all"
              >
                <div className="text-sm font-bold text-slate-900">Admin / Founder</div>
                <div className="text-xs text-slate-500 mt-1">
                  Use the SMTP from-address (or an address listed as admin). Full workspace access.
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setPortal('employee'); setStep('email'); setError(null); }}
                className="w-full text-left px-5 py-4 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/60 transition-all"
              >
                <div className="text-sm font-bold text-slate-900">Employee</div>
                <div className="text-xs text-slate-500 mt-1">
                  Sign in with the email on your People directory profile.
                </div>
              </button>
            </div>
          )}

          {step === 'email' && (
            <div className="p-8 space-y-4">
              <button
                type="button"
                onClick={() => setStep('choose')}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                ← Back
              </button>
              <h2 className="text-lg font-bold text-slate-900">
                {portal === 'admin' ? 'Admin sign-in' : 'Employee sign-in'}
              </h2>
              <p className="text-xs text-slate-500">
                Enter your work email. We&apos;ll send a 6-digit code and a magic link.
                {portal === 'admin'
                  ? ' Admin access uses your SMTP From address (the address configured in Admin → SMTP).'
                  : ' Use the email on your People directory profile.'}
              </p>
              <label className="block text-xs font-semibold text-slate-600" htmlFor="magic-email">
                Email
              </label>
              <input
                id="magic-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void requestCode(); }}
                placeholder={portal === 'admin' ? 'you@company.com' : 'name@company.com'}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
              />
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestCode()}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold"
              >
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </div>
          )}

          {step === 'code' && (
            <div className="p-8 space-y-4">
              <button
                type="button"
                onClick={() => setStep('email')}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                ← Change email
              </button>
              <h2 className="text-lg font-bold text-slate-900">Enter code</h2>
              {info && <p className="text-xs text-slate-600 bg-slate-50 rounded-xl px-4 py-3">{info}</p>}
              {devCode && (
                <p className="text-sm font-mono font-bold tracking-widest text-amber-800 bg-amber-50 rounded-xl px-4 py-3">
                  Dev code: {devCode}
                </p>
              )}
              <label className="block text-xs font-semibold text-slate-600" htmlFor="magic-code">
                6-digit code
              </label>
              <input
                id="magic-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') void verifyCode(); }}
                placeholder="000000"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-center text-lg font-mono tracking-[0.35em] outline-none focus:ring-2 focus:ring-emerald-200"
              />
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
              <button
                type="button"
                disabled={busy || code.length !== 6}
                onClick={() => void verifyCode()}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold"
              >
                {busy ? 'Verifying…' : 'Sign in'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestCode()}
                className="w-full text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                Resend code
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
