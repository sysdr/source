import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/apiClient';
import {
  getActiveOrgId,
  getCompanyProfile,
  getSmtpSettings,
  setSmtpSettings,
  setEmployeeInvitesLocal,
  syncEmployeesFromServer,
} from '../services/storageService';
import type { EmployeeInvite, SmtpSettings } from '../types';
import { getAppPublicBaseUrl } from '../services/serverUrl';

const fieldClass =
  'w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl outline-none font-bold text-xs focus:border-indigo-400';

const AdminEmailInvites: React.FC = () => {
  const orgId = getActiveOrgId() ?? 'default';
  const profile = getCompanyProfile();
  const [smtp, setSmtp] = useState<SmtpSettings>(() => getSmtpSettings());
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);
  const [invites, setInvites] = useState<EmployeeInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    designation: '',
    department: '',
    ctc: '',
    doj: new Date().toISOString().slice(0, 10),
    employeeType: 'Full-time',
  });
  const [sendingInvite, setSendingInvite] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  const refreshInvites = useCallback(async () => {
    setLoadingInvites(true);
    const list = await api.listInvites(orgId);
    if (list) {
      setInvites(list);
      setEmployeeInvitesLocal(list);
    }
    await syncEmployeesFromServer();
    window.dispatchEvent(new Event('suez_data_updated'));
    setLoadingInvites(false);
  }, [orgId]);

  useEffect(() => {
    (async () => {
      const remote = await api.getSmtpSettings(orgId);
      if (remote) {
        setSmtp((prev) => ({
          ...prev,
          host: String(remote.host ?? prev.host ?? ''),
          port: Number(remote.port ?? prev.port ?? 587) || 587,
          secure: Boolean(remote.secure),
          username: String(remote.username ?? prev.username ?? ''),
          fromEmail: String(remote.fromEmail ?? prev.fromEmail ?? ''),
          fromName: String(remote.fromName ?? prev.fromName ?? ''),
          replyTo: typeof remote.replyTo === 'string' ? remote.replyTo : prev.replyTo,
          enabled: remote.enabled !== false,
          password: '', // never returned from API
        }));
      }
      await refreshInvites();
    })();
  }, [orgId, refreshInvites]);

  const handleSaveSmtp = async () => {
    setSavingSmtp(true);
    setStatus(null);
    try {
      setSmtpSettings(smtp);
      const ok = await api.saveSmtpSettings(orgId, smtp as unknown as Record<string, unknown>);
      if (!ok) {
        setStatus({
          type: 'error',
          msg: 'Saved locally, but server is unreachable. Start npm run server so invites can send mail.',
        });
      } else {
        setStatus({ type: 'success', msg: 'SMTP settings saved.' });
        setSmtp((s) => ({ ...s, password: '' }));
      }
    } catch (e) {
      setStatus({ type: 'error', msg: (e as Error).message });
    }
    setSavingSmtp(false);
  };

  const handleTestMail = async () => {
    setTesting(true);
    setStatus(null);
    // Ensure latest settings are on the server before testing
    await api.saveSmtpSettings(orgId, {
      ...smtp,
      password: smtp.password || undefined,
    } as unknown as Record<string, unknown>);
    const result = await api.testSmtp(orgId, testTo.trim() || undefined);
    if (result.ok) {
      setStatus({ type: 'success', msg: `Test email sent to ${result.to}.` });
    } else {
      setStatus({ type: 'error', msg: result.error || 'Test send failed' });
    }
    setTesting(false);
  };

  const handleSendInvite = async () => {
    if (!inviteForm.email.trim() || !inviteForm.email.includes('@')) {
      setStatus({ type: 'error', msg: 'Enter a valid employee email.' });
      return;
    }
    setSendingInvite(true);
    setStatus(null);
    setLastInviteUrl(null);
    const result = await api.createInvite({
      orgId,
      email: inviteForm.email.trim(),
      orgName: profile?.projectName || profile?.parent?.name || orgId,
      name: inviteForm.name.trim() || undefined,
      designation: inviteForm.designation.trim() || undefined,
      department: inviteForm.department.trim() || undefined,
      ctc: inviteForm.ctc ? Number(inviteForm.ctc) : undefined,
      doj: inviteForm.doj || undefined,
      employeeType: inviteForm.employeeType,
      appBaseUrl: getAppPublicBaseUrl(),
    });
    setSendingInvite(false);
    if (!result.ok) {
      setStatus({ type: 'error', msg: result.error || 'Failed to create invite' });
      return;
    }
    if (result.invite?.inviteUrl) setLastInviteUrl(result.invite.inviteUrl);
    if (result.emailSent) {
      setStatus({ type: 'success', msg: `Invite emailed to ${inviteForm.email.trim()}.` });
    } else {
      setStatus({
        type: 'info',
        msg: result.error || 'Invite created. Email not sent — configure SMTP or share the link below.',
      });
    }
    setInviteForm({
      email: '',
      name: '',
      designation: '',
      department: '',
      ctc: '',
      doj: new Date().toISOString().slice(0, 10),
      employeeType: 'Full-time',
    });
    await refreshInvites();
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke / delete this invite?')) return;
    await api.deleteInvite(orgId, id);
    await refreshInvites();
  };

  return (
    <div className="space-y-8">
      {status && (
        <div
          className={`p-4 rounded-xl text-xs font-bold border ${
            status.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : status.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-amber-50 text-amber-900 border-amber-200'
          }`}
        >
          {status.msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            SMTP email settings
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            Used for employee invites, test messages, and magic-link / OTP sign-in.
            Admin login is allowed for the <strong>From email</strong> (and username / reply-to if they are email addresses).
            Requires the API server (<code className="text-[10px]">npm run server</code>).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">SMTP host</label>
              <input className={fieldClass} placeholder="smtp.gmail.com" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Port</label>
              <input
                type="number"
                className={fieldClass}
                value={smtp.port}
                onChange={(e) => {
                  const port = Number(e.target.value) || 587;
                  setSmtp({ ...smtp, port, secure: port === 465 });
                }}
              />
            </div>
            <div className="flex flex-col justify-end gap-1 pb-1">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <input
                  type="checkbox"
                  className="accent-indigo-600"
                  checked={smtp.secure || smtp.port === 465}
                  onChange={(e) => {
                    const secure = e.target.checked;
                    setSmtp({ ...smtp, secure, port: secure ? 465 : 587 });
                  }}
                />
                Implicit SSL (port 465)
              </label>
              <p className="text-[10px] text-slate-400 leading-snug">
                Hostinger: use <strong>587</strong> (STARTTLS) or <strong>465</strong> (SSL). Do not enable SSL on 587.
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Username</label>
              <input className={fieldClass} value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Password / app password</label>
              <input
                type="password"
                className={fieldClass}
                placeholder="Leave blank to keep existing"
                value={smtp.password}
                onChange={(e) => setSmtp({ ...smtp, password: e.target.value })}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">From email</label>
              <input className={fieldClass} type="email" value={smtp.fromEmail} onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">From name</label>
              <input className={fieldClass} value={smtp.fromName} onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Reply-to (optional)</label>
              <input className={fieldClass} type="email" value={smtp.replyTo || ''} onChange={(e) => setSmtp({ ...smtp, replyTo: e.target.value })} />
            </div>
          </div>
          <button
            onClick={handleSaveSmtp}
            disabled={savingSmtp}
            className="w-full bg-slate-900 text-white py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 disabled:opacity-60"
          >
            {savingSmtp ? 'Saving…' : 'Save SMTP settings'}
          </button>
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <label className="block text-[10px] font-black text-slate-400 uppercase">Test send to</label>
            <div className="flex gap-2">
              <input
                className={fieldClass}
                type="email"
                placeholder={smtp.fromEmail || 'you@company.com'}
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
              <button
                onClick={handleTestMail}
                disabled={testing}
                className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-60 whitespace-nowrap"
              >
                {testing ? 'Sending…' : 'Test mail'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Invite employee
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            Sends a join link so the employee can fill HR details and upload documents. They appear under Payroll → Directory as <strong>Onboarding</strong>.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Email *</label>
              <input className={fieldClass} type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Name</label>
              <input className={fieldClass} value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Designation</label>
              <input className={fieldClass} value={inviteForm.designation} onChange={(e) => setInviteForm({ ...inviteForm, designation: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Department</label>
              <input className={fieldClass} value={inviteForm.department} onChange={(e) => setInviteForm({ ...inviteForm, department: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Offered CTC (INR)</label>
              <input className={fieldClass} type="number" value={inviteForm.ctc} onChange={(e) => setInviteForm({ ...inviteForm, ctc: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Joining date</label>
              <input className={fieldClass} type="date" value={inviteForm.doj} onChange={(e) => setInviteForm({ ...inviteForm, doj: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Type</label>
              <select className={fieldClass} value={inviteForm.employeeType} onChange={(e) => setInviteForm({ ...inviteForm, employeeType: e.target.value })}>
                <option>Full-time</option>
                <option>Part-time</option>
                <option>Contract</option>
                <option>Intern</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleSendInvite}
            disabled={sendingInvite}
            className="w-full bg-emerald-600 text-white py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-60"
          >
            {sendingInvite ? 'Sending…' : 'Send invite email'}
          </button>
          {lastInviteUrl && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase">Shareable join link</p>
              <p className="text-[11px] font-mono text-slate-700 break-all select-all">{lastInviteUrl}</p>
              <button
                type="button"
                className="text-[10px] font-black uppercase text-indigo-600"
                onClick={() => navigator.clipboard?.writeText(lastInviteUrl)}
              >
                Copy link
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Pending &amp; recent invites</h3>
          <button
            onClick={refreshInvites}
            className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-800"
          >
            {loadingInvites ? 'Refreshing…' : 'Refresh + sync HR'}
          </button>
        </div>
        {invites.length === 0 ? (
          <p className="text-xs text-slate-400 font-medium py-6 text-center">No invites yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invites.map((inv) => (
              <li key={inv.id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-900">{inv.name || inv.email}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {inv.email}
                    {inv.designation ? ` · ${inv.designation}` : ''}
                    {' · '}
                    <span className="uppercase font-bold">{inv.status}</span>
                    {' · expires '}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {inv.token && inv.status !== 'accepted' && inv.status !== 'revoked' && (
                    <button
                      type="button"
                      className="px-3 py-2 rounded-xl bg-slate-100 text-[10px] font-black uppercase"
                      onClick={() => {
                        const url = `${window.location.origin}/#/join?token=${inv.token}`;
                        navigator.clipboard?.writeText(url);
                        setStatus({ type: 'info', msg: 'Join link copied.' });
                      }}
                    >
                      Copy link
                    </button>
                  )}
                  {inv.status !== 'accepted' && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(inv.id)}
                      className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 text-[10px] font-black uppercase"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AdminEmailInvites;
