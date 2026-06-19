
import React, { useState, useEffect } from 'react';
import { CompanyProfile } from '../types';
import { getOnboardingDraft, setOnboardingDraft, getUIState, setUIState, StorageKeys } from '../services/storageService';

/* ─── Default Profile ────────────────────────────────────────────────────── */
const DEFAULT_PROFILE: CompanyProfile = {
  projectName: '',
  baseCurrency: 'INR',
  parent:     { name: '', type: 'LLP',    taxId: '', pan: '', state: 'Maharashtra', country: 'IN' },
  subsidiary: { name: '', type: 'C-Corp', taxId: '',          state: 'Delaware',    country: 'US' },
  payroll: { pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22 },
  accounting: {
    expenseCategories: ['SaaS & Hosting', 'Rent', 'Contractors', 'Marketing', 'Intercompany Fees'],
    revenueChannels:   ['Stripe US', 'Lemon Squeezy', 'Wire Transfers', 'Partner Capital'],
  },
};

interface OnboardingProps { onComplete: (profile: CompanyProfile) => void; }

/* ─── Step metadata ──────────────────────────────────────────────────────── */
const STEPS = [
  { num: 1, title: 'Project Identity',     subtitle: 'Name your cross-border setup'         },
  { num: 2, title: 'Legal Architecture',   subtitle: 'Parent (IN) and Subsidiary (US)'      },
  { num: 3, title: 'HR & Payroll',         subtitle: 'India statutory compliance settings'  },
  { num: 4, title: 'Accounting Setup',     subtitle: 'Revenue channels and expense buckets' },
  { num: 5, title: 'Ready to Launch',      subtitle: 'Review and activate your OS'          },
];

const TOTAL_STEPS = STEPS.length;

/* ─── Inline SVG ─────────────────────────────────────────────────────────── */
const Ico: React.FC<{ d: string | string[]; size?: number; style?: React.CSSProperties }> = ({ d, size = 16, style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

/* ─── Form field wrapper ──────────────────────────────────────────────────── */
const Field: React.FC<{
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  fullWidth?: boolean;
}> = ({ label, hint, required, children, fullWidth }) => (
  <div className="form-group" style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
    <label className={`form-label${required ? ' form-label-required' : ''}`}>{label}</label>
    {children}
    {hint && <span className="form-hint">{hint}</span>}
  </div>
);

/* ─── Toggle switch ───────────────────────────────────────────────────────── */
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }> = ({ checked, onChange, label, sub }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', borderRadius: 'var(--r-md)',
    border: `1px solid ${checked ? 'var(--accent-border)' : 'var(--n-150)'}`,
    background: checked ? 'var(--accent-muted)' : 'var(--surface-base)',
    cursor: 'pointer', transition: 'all 150ms ease',
  }} onClick={() => onChange(!checked)}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: checked ? 'var(--accent-text)' : 'var(--n-700)' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--n-400)', marginTop: 2 }}>{sub}</div>}
    </div>
    {/* toggle pill */}
    <div style={{
      width: 34, height: 18, borderRadius: 9,
      background: checked ? 'var(--accent)' : 'var(--n-200)',
      position: 'relative', flexShrink: 0,
      transition: 'background 150ms ease',
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 2,
        left: checked ? 16 : 2,
        transition: 'left 150ms ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }} />
    </div>
  </div>
);

/* ─── Currency option card ────────────────────────────────────────────────── */
const CurrencyCard: React.FC<{
  active: boolean;
  onClick: () => void;
  currency: string;
  symbol: string;
  country: string;
  flag: string;
}> = ({ active, onClick, currency, symbol, country, flag }) => (
  <div
    onClick={onClick}
    style={{
      padding: '14px 16px', borderRadius: 'var(--r-lg)', cursor: 'pointer',
      border: active ? '2px solid var(--accent)' : '2px solid var(--n-150)',
      background: active ? 'var(--accent-muted)' : 'var(--surface-base)',
      transition: 'all 150ms ease',
      display: 'flex', alignItems: 'center', gap: 12,
    }}
  >
    <span style={{ fontSize: 22, lineHeight: 1 }}>{flag}</span>
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: active ? 'var(--accent-text)' : 'var(--n-800)', fontFamily: 'var(--font-mono)' }}>
        {symbol} {currency}
      </div>
      <div style={{ fontSize: 11, color: 'var(--n-400)', marginTop: 2 }}>{country}</div>
    </div>
    {active && (
      <div style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Ico d="M4 8l3 3 5-5" size={12} style={{ color: '#fff' }} />
      </div>
    )}
  </div>
);

/* ─── Tag chip ────────────────────────────────────────────────────────────── */
const TagChip: React.FC<{ label: string; onRemove: () => void; variant?: 'accent' | 'neutral' }> = ({ label, onRemove, variant = 'neutral' }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '3px 10px', borderRadius: 'var(--r-full)', fontSize: 12, fontWeight: 600,
    background: variant === 'accent' ? 'var(--accent-muted)' : 'var(--n-100)',
    color: variant === 'accent' ? 'var(--accent-text)' : 'var(--n-600)',
    border: `1px solid ${variant === 'accent' ? 'var(--accent-border)' : 'var(--n-200)'}`,
  }}>
    {label}
    <button
      type="button"
      onClick={onRemove}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit', opacity: 0.6 }}
      aria-label={`Remove ${label}`}
    >×</button>
  </span>
);

/* ═══════════════════════════════════════════════════════════════════════════
   Onboarding Component
═══════════════════════════════════════════════════════════════════════════ */
const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStepState]     = useState(() => getUIState(StorageKeys.UI_ONBOARDING_STEP, 1));
  const [profile, setProfile]    = useState<CompanyProfile>(() => getOnboardingDraft() || DEFAULT_PROFILE);
  const [newChannel, setNewChannel]   = useState('');
  const [newCategory, setNewCategory] = useState('');

  const setStep = (v: number | ((prev: number) => number)) => {
    setStepState((prev: number) => {
      const next = typeof v === 'function' ? v(prev) : v;
      setUIState(StorageKeys.UI_ONBOARDING_STEP, next);
      return next;
    });
  };

  useEffect(() => { setOnboardingDraft(profile); }, [profile]);

  const nextStep = () => setStep((p) => p + 1);
  const prevStep = () => setStep((p) => p - 1);

  const handleFinish = () => {
    setOnboardingDraft(null);
    onComplete(profile);
  };

  const addChannel  = () => { if (newChannel.trim())  { setProfile({ ...profile, accounting: { ...profile.accounting, revenueChannels:   [...profile.accounting.revenueChannels,   newChannel.trim()]  } }); setNewChannel('');  } };
  const addCategory = () => { if (newCategory.trim()) { setProfile({ ...profile, accounting: { ...profile.accounting, expenseCategories: [...profile.accounting.expenseCategories, newCategory.trim()] } }); setNewCategory(''); } };

  /* ── Step content ──────────────────────────────────────────────────── */
  const renderStep = () => {
    switch (step) {

      /* ── Step 1: Project Identity ──────────────────────────────────── */
      case 1:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: 'slideUp 200ms ease forwards' }}>
            <Field label="Project / Organisation Name" required hint="This identifies your cross-border setup across all modules.">
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Project Suez, Acme Global"
                value={profile.projectName}
                onChange={(e) => setProfile({ ...profile, projectName: e.target.value })}
                autoFocus
              />
            </Field>

            <div>
              <div className="form-label" style={{ marginBottom: 10 }}>Base Currency</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <CurrencyCard
                  active={profile.baseCurrency === 'INR'}
                  onClick={() => setProfile({ ...profile, baseCurrency: 'INR', parent: { ...profile.parent, country: 'IN' }, subsidiary: { ...profile.subsidiary, country: 'US' } })}
                  currency="INR" symbol="₹" country="India (Parent)" flag="🇮🇳"
                />
                <CurrencyCard
                  active={profile.baseCurrency === 'USD'}
                  onClick={() => setProfile({ ...profile, baseCurrency: 'USD', parent: { ...profile.parent, country: 'US' }, subsidiary: { ...profile.subsidiary, country: 'IN' } })}
                  currency="USD" symbol="$" country="United States (Parent)" flag="🇺🇸"
                />
              </div>
              <p className="form-hint" style={{ marginTop: 8 }}>
                Base currency is the home currency of the parent company. All reports will default to this currency.
              </p>
            </div>
          </div>
        );

      /* ── Step 2: Legal Architecture ────────────────────────────────── */
      case 2:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: 'slideUp 200ms ease forwards' }}>
            {/* India LLP */}
            <div style={{
              padding: '16px', borderRadius: 'var(--r-lg)',
              border: '1px solid var(--india-200)',
              background: 'var(--india-50)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>🇮🇳</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--india-700)' }}>
                  Indian Parent · LLP / Private Ltd
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Entity Name</label>
                  <input type="text" className="form-input" placeholder="e.g. Suez Technologies LLP"
                    value={profile.parent.name}
                    onChange={(e) => setProfile({ ...profile, parent: { ...profile.parent, name: e.target.value } })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">GSTIN</label>
                  <input type="text" className="form-input num" placeholder="27AAXXX0000X1Z5"
                    value={profile.parent.taxId}
                    onChange={(e) => setProfile({ ...profile, parent: { ...profile.parent, taxId: e.target.value.toUpperCase() } })}
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">PAN</label>
                  <input type="text" className="form-input num" placeholder="AAXXX0000X"
                    value={profile.parent.pan}
                    onChange={(e) => setProfile({ ...profile, parent: { ...profile.parent, pan: e.target.value.toUpperCase() } })}
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">State of Registration</label>
                  <select className="form-select" value={profile.parent.state}
                    onChange={(e) => setProfile({ ...profile, parent: { ...profile.parent, state: e.target.value } })}>
                    {['Maharashtra', 'Karnataka', 'Delhi', 'Tamil Nadu', 'Telangana', 'Gujarat', 'Haryana', 'West Bengal', 'Rajasthan', 'Uttar Pradesh'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* US Corp */}
            <div style={{
              padding: '16px', borderRadius: 'var(--r-lg)',
              border: '1px solid var(--us-200)',
              background: 'var(--us-50)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>🇺🇸</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--us-700)' }}>
                  US Subsidiary · C-Corp / LLC
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Subsidiary Name</label>
                  <input type="text" className="form-input" placeholder="e.g. Suez Technologies Inc."
                    value={profile.subsidiary.name}
                    onChange={(e) => setProfile({ ...profile, subsidiary: { ...profile.subsidiary, name: e.target.value } })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">State of Incorporation</label>
                  <select className="form-select" value={profile.subsidiary.state}
                    onChange={(e) => setProfile({ ...profile, subsidiary: { ...profile.subsidiary, state: e.target.value } })}>
                    <option>Delaware</option>
                    <option>Wyoming</option>
                    <option>Nevada</option>
                    <option>Florida</option>
                    <option>Texas</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">EIN (optional)</label>
                  <input type="text" className="form-input num" placeholder="XX-XXXXXXX"
                    value={profile.subsidiary.taxId}
                    onChange={(e) => setProfile({ ...profile, subsidiary: { ...profile.subsidiary, taxId: e.target.value } })}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      /* ── Step 3: HR & Payroll ───────────────────────────────────────── */
      case 3:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'slideUp 200ms ease forwards' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Toggle
                checked={profile.payroll.pfEnabled}
                onChange={(v) => setProfile({ ...profile, payroll: { ...profile.payroll, pfEnabled: v } })}
                label="Provident Fund (EPF)"
                sub="12% employer + employee contribution"
              />
              <Toggle
                checked={profile.payroll.esiEnabled}
                onChange={(v) => setProfile({ ...profile, payroll: { ...profile.payroll, esiEnabled: v } })}
                label="Employee State Insurance (ESI)"
                sub="Applicable if salary ≤ ₹21,000/mo"
              />
            </div>

            <Field label="Professional Tax (PT) State" hint="PT rates and applicability vary by state.">
              <select className="form-select" value={profile.payroll.ptState}
                onChange={(e) => setProfile({ ...profile, payroll: { ...profile.payroll, ptState: e.target.value } })}>
                {['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Delhi', 'Telangana', 'West Bengal', 'Andhra Pradesh', 'Gujarat'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>

            <Field label="Standard Working Days / Month" hint="Used for LOP deductions and pro-rated salary calculations.">
              <input
                type="number"
                className="form-input num"
                min={20}
                max={31}
                value={profile.payroll.standardWorkingDays}
                onChange={(e) => setProfile({ ...profile, payroll: { ...profile.payroll, standardWorkingDays: Number(e.target.value) } })}
              />
            </Field>

            <div className="alert info" style={{ fontSize: 12 }}>
              <Ico d="M8 5v3M8 11v1" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                CrossBorder auto-generates Form 24Q (TDS), PF ECR, ESI returns, PT challans, and bank payment files based on these settings.
              </span>
            </div>
          </div>
        );

      /* ── Step 4: Accounting Setup ───────────────────────────────────── */
      case 4:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: 'slideUp 200ms ease forwards' }}>
            {/* Revenue channels */}
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Revenue Channels</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {profile.accounting.revenueChannels.map((ch) => (
                  <TagChip key={ch} label={ch} variant="accent"
                    onRemove={() => setProfile({ ...profile, accounting: { ...profile.accounting, revenueChannels: profile.accounting.revenueChannels.filter((c) => c !== ch) } })}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" className="form-input" placeholder="Add channel (e.g. Razorpay)" style={{ flex: 1 }}
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChannel(); } }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={addChannel} style={{ flexShrink: 0 }}>Add</button>
              </div>
            </div>

            {/* Expense categories */}
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Expense Categories</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {profile.accounting.expenseCategories.map((cat) => (
                  <TagChip key={cat} label={cat}
                    onRemove={() => setProfile({ ...profile, accounting: { ...profile.accounting, expenseCategories: profile.accounting.expenseCategories.filter((c) => c !== cat) } })}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" className="form-input" placeholder="Add category (e.g. R&D)" style={{ flex: 1 }}
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={addCategory} style={{ flexShrink: 0 }}>Add</button>
              </div>
            </div>

            <div className="alert info" style={{ fontSize: 12 }}>
              <Ico d="M8 2a6 6 0 100 12A6 6 0 008 2z" size={14} style={{ flexShrink: 0 }} />
              <span>
                CrossBorder uses <strong>Accrual Accounting</strong> to satisfy US Form 1120 and Indian Tax Audit (Sec 44AB) requirements. All intercompany flows are tagged for Transfer Pricing compliance.
              </span>
            </div>
          </div>
        );

      /* ── Step 5: Confirmation ───────────────────────────────────────── */
      case 5:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, animation: 'slideUp 200ms ease forwards', textAlign: 'center' }}>
            {/* Success icon */}
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--brand-700) 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(18,70,214,0.35)',
            }}>
              <Ico d="M4 8l3 3 5-5" size={28} style={{ color: '#fff', strokeWidth: '2' }} />
            </div>

            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--n-900)', letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                {profile.projectName || 'Your Organisation'} is ready
              </h2>
              <p style={{ fontSize: 13, color: 'var(--n-500)', lineHeight: 1.6, margin: 0 }}>
                All cross-border modules have been configured for<br />
                <strong>{profile.parent.name || 'Indian LLP'}</strong> + <strong>{profile.subsidiary.name || 'US Corp'}</strong>
              </p>
            </div>

            {/* Summary grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%', textAlign: 'left' }}>
              {[
                { label: 'Base Currency', value: profile.baseCurrency === 'INR' ? '₹ INR (India)' : '$ USD (US)' },
                { label: 'EPF / PF',      value: profile.payroll.pfEnabled ? 'Enabled · 12%' : 'Disabled' },
                { label: 'ESI',           value: profile.payroll.esiEnabled ? 'Enabled' : 'Disabled' },
                { label: 'PT State',      value: profile.payroll.ptState },
                { label: 'Revenue Ch.',   value: `${profile.accounting.revenueChannels.length} channels` },
                { label: 'Expense Cat.',  value: `${profile.accounting.expenseCategories.length} categories` },
              ].map((item) => (
                <div key={item.label} className="card-inset" style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--n-400)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n-800)' }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const currentStep = STEPS[step - 1];

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #060c1a 0%, #0c1931 55%, #060b18 100%)',
      padding: 24,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient orbs */}
      <div style={{ position: 'absolute', top: '-10%', right: '-8%', width: 500, height: 500,
        borderRadius: '50%', background: 'rgba(99,102,241,0.10)', filter: 'blur(80px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-10%', left: '-8%', width: 400, height: 400,
        borderRadius: '50%', background: 'rgba(5,150,105,0.07)', filter: 'blur(80px)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 540 }}>
        {/* Main card */}
        <div style={{
          background: '#ffffff',
          borderRadius: 'var(--r-2xl)',
          boxShadow: 'var(--shadow-xl), 0 0 0 1px rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}>
          {/* Card header / brand + step info */}
          <div style={{
            padding: '20px 28px',
            background: 'linear-gradient(135deg, #060c1a 0%, #0d1a33 100%)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 'var(--r-md)',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: '#fff',
                  boxShadow: '0 2px 8px rgba(99,102,241,0.45)',
                }}>CB</div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>CrossBorder Setup</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-mono)' }}>
                {step} / {TOTAL_STEPS}
              </span>
            </div>

            {/* Step title */}
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-0.015em', marginBottom: 4 }}>
                {currentStep.title}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', fontWeight: 500 }}>
                {currentStep.subtitle}
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ display: 'flex', gap: 4, marginTop: 16 }}>
              {STEPS.map((s) => (
                <div key={s.num} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: step >= s.num ? '#6366f1' : 'rgba(255,255,255,0.12)',
                  transition: 'background 300ms ease',
                }} />
              ))}
            </div>
          </div>

          {/* Step content */}
          <div style={{ padding: '24px 28px', minHeight: 320 }}>
            {renderStep()}
          </div>

          {/* Footer navigation */}
          <div style={{
            padding: '16px 28px 22px',
            background: 'var(--n-25)',
            borderTop: '1px solid var(--n-100)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            {step > 1 && step < 5 && (
              <button type="button" className="btn btn-secondary" onClick={prevStep} style={{ gap: 6 }}>
                <Ico d="M10 4l-4 4 4 4" size={13} />
                Back
              </button>
            )}

            <div style={{ flex: 1 }} />

            {step < 5 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={nextStep}
                disabled={step === 1 && !profile.projectName.trim()}
                style={{ gap: 6 }}
              >
                Continue
                <Ico d="M6 4l4 4-4 4" size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={handleFinish}
                style={{ gap: 8 }}
              >
                <Ico d="M3 8l4 4 6-6" size={15} />
                Launch Financial OS
              </button>
            )}
          </div>
        </div>

        {/* Footer note */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, padding: '0 4px' }}>
          <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.04em', fontWeight: 600 }}>
            CrossBorder ERP · All data stored locally
          </p>
          <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.04em', fontWeight: 600 }}>
            No server · No telemetry
          </p>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
