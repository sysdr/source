import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/apiClient';
import type { Employee, EmployeeUploadedDoc } from '../types';

const MAX_DOC_BYTES = 1_500_000; // ~1.5 MB per file (base64)

type InvitePreview = {
  email: string;
  orgId: string;
  orgName: string;
  name?: string;
  designation?: string;
  department?: string;
  ctc?: number;
  doj?: string;
  employeeType?: string;
  expiresAt: string;
};

const DOC_KINDS: { kind: EmployeeUploadedDoc['kind']; label: string }[] = [
  { kind: 'pan', label: 'PAN card' },
  { kind: 'aadhaar', label: 'Aadhaar' },
  { kind: 'bank', label: 'Cancelled cheque / bank proof' },
  { kind: 'photo', label: 'Photo' },
  { kind: 'contract', label: 'Signed offer / contract' },
  { kind: 'other', label: 'Other' },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

const fieldClass =
  'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none font-medium text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

const EmployeeJoin: React.FC<{ token: string }> = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [docs, setDocs] = useState<EmployeeUploadedDoc[]>([]);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    dateOfBirth: '',
    gender: '' as '' | Employee['gender'],
    fatherOrSpouseName: '',
    address: '',
    designation: '',
    department: '',
    employeeType: 'Full-time' as NonNullable<Employee['employeeType']>,
    doj: '',
    panNumber: '',
    aadhaarNumber: '',
    uan: '',
    esiNumber: '',
    bankAccountNumber: '',
    bankIFSC: '',
    bankName: '',
    taxRegime: 'new' as 'new' | 'old',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await api.getInviteByToken(token);
      if (cancelled) return;
      if (result.error || !result.invite) {
        setError(result.error || 'Invite not found');
        setLoading(false);
        return;
      }
      const inv = result.invite as InvitePreview;
      setInvite(inv);
      setForm((f) => ({
        ...f,
        name: inv.name || '',
        designation: inv.designation || '',
        department: inv.department || '',
        doj: inv.doj || new Date().toISOString().slice(0, 10),
        employeeType: (inv.employeeType as Employee['employeeType']) || 'Full-time',
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const expiresLabel = useMemo(() => {
    if (!invite?.expiresAt) return '';
    return new Date(invite.expiresAt).toLocaleString();
  }, [invite]);

  const onUpload = async (kind: EmployeeUploadedDoc['kind'], file: File | null) => {
    if (!file) return;
    if (file.size > MAX_DOC_BYTES) {
      setError(`File too large (max ~1.5 MB): ${file.name}`);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const doc: EmployeeUploadedDoc = {
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
        uploadedAt: new Date().toISOString(),
      };
      setDocs((prev) => [...prev.filter((d) => d.kind !== kind), doc]);
      setError(null);
    } catch {
      setError('Could not read that file. Try a smaller PDF or image.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Full name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await api.completeInvite(token, {
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      gender: form.gender || undefined,
      fatherOrSpouseName: form.fatherOrSpouseName.trim() || undefined,
      address: form.address.trim() || undefined,
      designation: form.designation.trim() || undefined,
      department: form.department.trim() || undefined,
      employeeType: form.employeeType,
      doj: form.doj || undefined,
      panNumber: form.panNumber.trim() || undefined,
      aadhaarNumber: form.aadhaarNumber.trim() || undefined,
      uan: form.uan.trim() || undefined,
      esiNumber: form.esiNumber.trim() || undefined,
      bankAccountNumber: form.bankAccountNumber.trim() || undefined,
      bankIFSC: form.bankIFSC.trim() || undefined,
      bankName: form.bankName.trim() || undefined,
      taxRegime: form.taxRegime,
      ctc: invite?.ctc,
      uploadedDocuments: docs,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error || 'Could not submit profile');
      return;
    }
    setDone(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm font-medium text-slate-500">Loading invite…</div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="bg-white max-w-md w-full p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-3">
          <h1 className="text-xl font-black text-slate-900 tracking-tight">Invite unavailable</h1>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="bg-white max-w-md w-full p-10 rounded-3xl border border-slate-200 shadow-sm text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-black">✓</div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">You&apos;re in</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Your profile was submitted to <strong>{invite?.orgName}</strong>. HR will activate you for leave and payroll once they review your details.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Employee onboarding</p>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">{invite?.orgName}</h1>
          <p className="text-sm text-slate-500">
            Complete your profile for HR, leave, and payroll. Invite emailed to <strong>{invite?.email}</strong>
            {expiresLabel ? ` · expires ${expiresLabel}` : ''}.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-8 space-y-8">
          <section className="space-y-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Personal</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Full name *</label>
                <input className={fieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Phone</label>
                <input className={fieldClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Date of birth</label>
                <input type="date" className={fieldClass} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Gender</label>
                <select className={fieldClass} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as Employee['gender'] | '' })}>
                  <option value="">—</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Father / spouse name</label>
                <input className={fieldClass} value={form.fatherOrSpouseName} onChange={(e) => setForm({ ...form, fatherOrSpouseName: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Address</label>
                <textarea className={fieldClass} rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Role</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Designation</label>
                <input className={fieldClass} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Department</label>
                <input className={fieldClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Employment type</label>
                <select className={fieldClass} value={form.employeeType} onChange={(e) => setForm({ ...form, employeeType: e.target.value as Employee['employeeType'] })}>
                  <option value="Full-time">Full-time</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Contract">Contract</option>
                  <option value="Intern">Intern</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Date of joining</label>
                <input type="date" className={fieldClass} value={form.doj} onChange={(e) => setForm({ ...form, doj: e.target.value })} />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Statutory &amp; bank</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">PAN</label>
                <input className={fieldClass} value={form.panNumber} onChange={(e) => setForm({ ...form, panNumber: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Aadhaar</label>
                <input className={fieldClass} value={form.aadhaarNumber} onChange={(e) => setForm({ ...form, aadhaarNumber: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">UAN</label>
                <input className={fieldClass} value={form.uan} onChange={(e) => setForm({ ...form, uan: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">ESI number</label>
                <input className={fieldClass} value={form.esiNumber} onChange={(e) => setForm({ ...form, esiNumber: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Bank account</label>
                <input className={fieldClass} value={form.bankAccountNumber} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">IFSC</label>
                <input className={fieldClass} value={form.bankIFSC} onChange={(e) => setForm({ ...form, bankIFSC: e.target.value.toUpperCase() })} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Bank name</label>
                <input className={fieldClass} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Tax regime</label>
                <select className={fieldClass} value={form.taxRegime} onChange={(e) => setForm({ ...form, taxRegime: e.target.value as 'new' | 'old' })}>
                  <option value="new">New</option>
                  <option value="old">Old</option>
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Documents</h2>
            <p className="text-xs text-slate-500">Upload PDF or images (max ~1.5 MB each). These are stored with your employee record for HR.</p>
            <div className="space-y-3">
              {DOC_KINDS.map(({ kind, label }) => {
                const existing = docs.find((d) => d.kind === kind);
                return (
                  <div key={kind} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800">{label}</p>
                      {existing && <p className="text-[11px] text-emerald-600 truncate">{existing.fileName}</p>}
                    </div>
                    <input
                      type="file"
                      accept="image/*,.pdf,application/pdf"
                      className="text-xs"
                      onChange={(e) => onUpload(kind, e.target.files?.[0] ?? null)}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-xs font-bold text-rose-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-60 transition-all"
          >
            {submitting ? 'Submitting…' : 'Submit & join company'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default EmployeeJoin;
