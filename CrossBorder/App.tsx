
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Navigation from './components/Navigation';
import { CurrencySelector, DisplayCurrencyProvider } from './contexts/DisplayCurrencyContext';
import { CompanyProfile } from './types';
import { runOrchestrator, appendTurn } from './agents';
import {
  getCompanyProfile,
  isOnboarded as checkOnboarded,
  getStripeCredentials,
  addAIQuery,
  getAIQueries,
  hasExistingOrganisation,
  clearAllOrganisationData,
  getOrganisationsList,
  addOrganisation,
  getUIState,
  setUIState,
  StorageKeys,
} from './services/storageService';
import { runDailySyncIfDue } from './services/stripeSyncService';
import { seedDefaultFilingTasksForFY } from './services/filingCalendarService';
import { fetchTodayUsdToInrRate } from './services/currencyService';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:        30_000,   // data is fresh for 30s — no refetch on every focus
      gcTime:           5 * 60_000, // keep unused data for 5 min
      retry:            1,
      refetchOnWindowFocus: false, // avoid surprise refetches while user edits
    },
  },
});

const Dashboard         = lazy(() => import('./components/Dashboard'));
const TransferPricing   = lazy(() => import('./components/TransferPricing'));
const TaxEngine         = lazy(() => import('./components/TaxEngine'));
const RevenueIngestion  = lazy(() => import('./components/RevenueIngestion'));
const PayrollEngine     = lazy(() => import('./components/Payroll'));
const AccountingModule  = lazy(() => import('./components/Accounting'));
const BalanceOverview   = lazy(() => import('./components/BalanceOverview'));
const FinanceModule     = lazy(() => import('./components/Finance'));
const ComplianceHub     = lazy(() => import('./components/ComplianceHub'));
const SyncDataScreen    = lazy(() => import('./components/SyncDataScreen'));
const VendorsAPScreen   = lazy(() => import('./components/VendorsAPScreen'));
const JournalScreen     = lazy(() => import('./components/JournalScreen'));
const ForeignIncomeScreen = lazy(() => import('./components/ForeignIncomeScreen'));
const FilingCalendarScreen = lazy(() => import('./components/FilingCalendarScreen'));
const USTaxScreen       = lazy(() => import('./components/USTaxScreen'));
const InvestorPitch     = lazy(() => import('./components/InvestorPitch'));
const Onboarding        = lazy(() => import('./components/Onboarding'));
const AdminPanel        = lazy(() => import('./components/AdminPanel'));
const OrgManager        = lazy(() => import('./components/OrgManager'));
const AgentArchitectureView = lazy(() => import('./components/AgentArchitectureView'));
const Invoices          = lazy(() => import('./components/Invoices'));
const MercuryBankScreen = lazy(() => import('./components/MercuryBankScreen'));

/* ─── Page title map ─────────────────────────────────────────────────────── */
const PAGE_LABELS: Record<string, { title: string; section: string }> = {
  dashboard:  { title: 'Dashboard',          section: 'Overview'              },
  agents:     { title: 'AI Assistant',        section: 'Overview'              },
  balance:    { title: 'Balance & Revenue',   section: 'Overview'              },
  pitch:      { title: 'Investor Pitch',      section: 'Overview'              },
  sync:       { title: 'Data Sync',           section: 'Finance & Accounting'  },
  revenue:    { title: 'Revenue',             section: 'Finance & Accounting'  },
  vendors:    { title: 'Vendors & AP (P2P)',  section: 'Finance & Accounting'  },
  journal:    { title: 'Journal Entries',     section: 'Finance & Accounting'  },
  accounting: { title: 'Financial Books',     section: 'Finance & Accounting'  },
  finance:    { title: 'P&E by Entity',       section: 'Finance & Accounting'  },
  transfer:   { title: 'Transfer Pricing',    section: 'Finance & Accounting'  },
  taxation:   { title: 'Tax Strategy',        section: 'Finance & Accounting'  },
  invoices:   { title: 'Invoices',            section: 'Finance & Accounting'  },
  mercury:    { title: 'Mercury Bank',        section: 'Finance & Accounting'  },
  payroll:    { title: 'Payroll & HR',        section: 'HR & Payroll'          },
  reports:    { title: 'Compliance Hub',      section: 'Compliance'            },
  filing:     { title: 'Filing Calendar',     section: 'Compliance'            },
  foreign:    { title: 'Foreign Income & WHT',section: 'Compliance'            },
  ustax:      { title: 'US Tax (Fed & State)', section: 'Compliance'           },
  admin:      { title: 'Admin Panel',         section: 'Compliance'            },
};

/* ─── Loading fallback ───────────────────────────────────────────────────── */
function TabFallback() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 14 }}>
      <div className="spinner spinner-lg" />
      <p style={{ fontSize: 13, color: 'var(--n-400)', fontWeight: 500 }}>Loading module…</p>
    </div>
  );
}

/* ─── SVG helper (inline, so no dep on Navigation's Icon) ────────────────── */
const Ico: React.FC<{ d: string | string[]; size?: number; style?: React.CSSProperties }> = ({ d, size = 16, style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

/* ─── Main App ───────────────────────────────────────────────────────────── */
const App: React.FC = () => {
  const [activeTab, setActiveTabState]       = useState(() => getUIState(StorageKeys.UI_ACTIVE_TAB, 'dashboard'));
  const [query, setQuery]                    = useState('');
  const [advice, setAdvice]                  = useState('');
  const [isLoadingAdvice, setIsLoadingAdvice]= useState(false);
  const [showQueryHistory, setShowQueryHistory] = useState(false);
  const [queryHistory, setQueryHistory]      = useState(() => getAIQueries());
  const [agentsUsed, setAgentsUsed]          = useState<string[]>([]);
  const [showAuditDetail, setShowAuditDetail]= useState(false);
  const [lastAuditRun, setLastAuditRun]      = useState<{
    userMessage: string; reply: string;
    agentsUsed: string[]; toolCalls: { toolId: string; error?: string }[];
    intent?: string; success: boolean;
  } | null>(null);
  const [isOnboardedState, setIsOnboardedState] = useState<boolean>(checkOnboarded());
  const [companyProfile, setCompanyProfile]  = useState<CompanyProfile | null>(() => getCompanyProfile());
  const [showStartupPage, setShowStartupPage]= useState(() => !checkOnboarded() || !hasExistingOrganisation());
  const [showOrgManager, setShowOrgManager]  = useState(false);
  const [aiWidgetOpen, setAiWidgetOpen]      = useState(false);
  const [fxRate, setFxRate]                  = useState<number | null>(null);

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    setUIState(StorageKeys.UI_ACTIVE_TAB, tab);
  };

  const stripeCredentials = getStripeCredentials();
  const [stripeApiKey, setStripeApiKey]       = useState(stripeCredentials.apiKey);
  const [stripeAccountId, setStripeAccountId] = useState(stripeCredentials.accountId);

  useEffect(() => {
    const refresh = () => setCompanyProfile(getCompanyProfile());
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, []);

  useEffect(() => {
    if (isOnboardedState && !showStartupPage) {
      runDailySyncIfDue();
      const now = new Date();
      const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const currentFYKey = `${fyStart}-${fyStart + 1}`;
      seedDefaultFilingTasksForFY(currentFYKey);
    }
  }, [isOnboardedState, showStartupPage]);

  useEffect(() => {
    fetchTodayUsdToInrRate().then((rate: number | undefined) => {
      if (rate) setFxRate(rate);
    }).catch(() => {/* rate unavailable */});
  }, []);

  /* ── Handlers ────────────────────────────────────────────────────────── */
  const handleOnboardingComplete = (profile: CompanyProfile) => {
    addOrganisation(profile);
    setCompanyProfile(getCompanyProfile());
    setIsOnboardedState(true);
  };

  const handleAskAI = async () => {
    if (!query.trim()) return;
    setIsLoadingAdvice(true);
    setAgentsUsed([]);
    const result = await runOrchestrator({
      userMessage: query,
      recentTurns: queryHistory.slice(0, 5).map((q) => ({ role: 'assistant' as const, content: q.response })),
    });
    const response = result.success ? result.reply : (result.error || 'Something went wrong.');
    setAdvice(response);
    if (result.success && result.agentsUsed?.length) {
      setAgentsUsed(result.agentsUsed.filter((a) => a !== 'orchestrator'));
    }
    setLastAuditRun({
      userMessage: query,
      reply: response,
      agentsUsed: (result.agentsUsed ?? []).filter((a) => a !== 'orchestrator'),
      toolCalls: (result.auditTrail?.[0]?.toolCalls ?? []).map((t) => ({ toolId: t.toolId, error: t.error })),
      intent: result.intent,
      success: result.success,
    });
    appendTurn('user', query);
    appendTurn('assistant', response);
    addAIQuery(query, response);
    setQueryHistory(getAIQueries());
    setIsLoadingAdvice(false);
  };

  const loadPreviousQuery = (q: { query: string; response: string }) => {
    setQuery(q.query);
    setAdvice(q.response);
    setAgentsUsed([]);
    setLastAuditRun(null);
    setShowQueryHistory(false);
  };

  const handleLoadExisting = () => {
    if (hasExistingOrganisation()) {
      setShowOrgManager(true);
    } else {
      alert('No previously saved organisation data found. Create a new organisation to get started.');
    }
  };

  const handleOrgSelect = () => {
    setCompanyProfile(getCompanyProfile());
    setIsOnboardedState(checkOnboarded());
    setShowStartupPage(false);
    setShowOrgManager(false);
  };

  const handleStartFresh = () => {
    if (hasExistingOrganisation()) {
      if (!confirm('This will clear ALL organisations and data. Continue?')) return;
      clearAllOrganisationData();
      setCompanyProfile(null);
      setIsOnboardedState(false);
    }
    setShowStartupPage(false);
    setShowOrgManager(false);
  };

  /* ──────────────────────────────────────────────────────────────────────
     STARTUP PAGE — redesigned premium launcher
  ────────────────────────────────────────────────────────────────────── */
  if (showStartupPage) {
    const hasSavedData = hasExistingOrganisation();
    const orgCount     = getOrganisationsList().length;

    return (
      <>
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
          {/* Ambient glow orbs */}
          <div style={{ position: 'absolute', top: '-15%', right: '-10%', width: 500, height: 500,
            borderRadius: '50%', background: 'rgba(99,102,241,0.12)', filter: 'blur(80px)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: '-15%', left: '-10%', width: 400, height: 400,
            borderRadius: '50%', background: 'rgba(5,150,105,0.08)', filter: 'blur(80px)', pointerEvents: 'none' }} />

          <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 420 }}>
            {/* Card */}
            <div style={{
              background: '#ffffff',
              borderRadius: 'var(--r-2xl)',
              boxShadow: 'var(--shadow-xl), 0 0 0 1px rgba(255,255,255,0.06)',
              overflow: 'hidden',
            }}>
              {/* Card header */}
              <div style={{
                padding: '28px 32px 24px',
                background: 'linear-gradient(135deg, #060c1a 0%, #0d1a33 100%)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                {/* Logo mark */}
                <div style={{
                  width: 44, height: 44,
                  borderRadius: 'var(--r-lg)',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: '#fff',
                  letterSpacing: '-0.03em',
                  boxShadow: '0 4px 14px rgba(99,102,241,0.45)',
                  marginBottom: 16,
                }}>CB</div>

                <h1 style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.15 }}>
                  CrossBorder ERP
                </h1>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.38)', letterSpacing: '0.07em', textTransform: 'uppercase', marginTop: 6 }}>
                  Cross-Border Financial OS · India LLP + US Corp
                </p>
              </div>

              {/* Card body */}
              <div style={{ padding: '24px 32px 28px' }}>
                {hasSavedData && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                    borderRadius: 'var(--r-md)', marginBottom: 20,
                    background: 'var(--success-bg)', border: '1px solid var(--success-border)',
                  }}>
                    <Ico d="M3 8l4 4 6-6" size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success-text)' }}>
                      {orgCount} organisation{orgCount !== 1 ? 's' : ''} saved locally
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Primary CTA */}
                  <button
                    type="button"
                    onClick={handleLoadExisting}
                    className="btn btn-primary btn-lg"
                    style={{ width: '100%', justifyContent: 'center', gap: 8 }}
                  >
                    <Ico d={['M3 4h10a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1z', 'M2 7h12']} size={15} />
                    {hasSavedData ? 'Select Organisation' : 'Load Saved Data'}
                  </button>

                  {/* Manage orgs */}
                  <button
                    type="button"
                    onClick={() => setShowOrgManager(true)}
                    className="btn btn-secondary btn-lg"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Manage Organisations
                  </button>

                  {/* Divider */}
                  <div className="divider-label" style={{ margin: '6px 0' }}>or</div>

                  {/* Create new */}
                  <button
                    type="button"
                    onClick={handleStartFresh}
                    className="btn btn-ghost btn-lg"
                    style={{ width: '100%', justifyContent: 'center', border: '1px solid var(--n-200)' }}
                  >
                    {hasSavedData ? 'Clear All & Create New' : 'Create New Organisation'}
                  </button>
                </div>

                {hasSavedData && (
                  <p style={{ fontSize: 11, color: 'var(--n-400)', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
                    "Clear All & Create New" will permanently delete all saved organisations and data.
                  </p>
                )}
              </div>
            </div>

            {/* Footer note */}
            <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 20, letterSpacing: '0.02em' }}>
              All data is stored locally in your browser · No server required
            </p>
          </div>
        </div>

        {showOrgManager && (
          <Suspense fallback={null}>
            <OrgManager
              onClose={() => setShowOrgManager(false)}
              onSelect={handleOrgSelect}
              onAddComplete={handleOrgSelect}
            />
          </Suspense>
        )}
      </>
    );
  }

  /* ──────────────────────────────────────────────────────────────────────
     ONBOARDING
  ────────────────────────────────────────────────────────────────────── */
  if (!isOnboardedState) {
    return (
      <Suspense fallback={
        <div style={{ minHeight: '100vh', background: '#060c1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner spinner-lg" style={{ borderTopColor: '#6366f1' }} />
        </div>
      }>
        <Onboarding onComplete={handleOnboardingComplete} />
      </Suspense>
    );
  }

  /* ──────────────────────────────────────────────────────────────────────
     MAIN APP SHELL
  ────────────────────────────────────────────────────────────────────── */
  const pageInfo = PAGE_LABELS[activeTab] ?? { title: 'Module', section: 'CrossBorder' };

  const renderContent = () => {
    const content = (() => {
      switch (activeTab) {
        case 'dashboard':   return <Dashboard stripeApiKey={stripeApiKey} onConnectClick={() => setActiveTab('revenue')} />;
        case 'agents':      return <AgentArchitectureView />;
        case 'balance':     return <BalanceOverview />;
        case 'pitch':       return <InvestorPitch />;
        case 'sync':        return <SyncDataScreen />;
        case 'revenue':     return (
          <RevenueIngestion
            stripeApiKey={stripeApiKey}
            setStripeApiKey={setStripeApiKey}
            stripeAccountId={stripeAccountId}
            setStripeAccountId={setStripeAccountId}
          />
        );
        case 'accounting':  return <AccountingModule />;
        case 'vendors':     return <VendorsAPScreen />;
        case 'journal':     return <JournalScreen />;
        case 'foreign':     return <ForeignIncomeScreen />;
        case 'filing':      return <FilingCalendarScreen />;
        case 'ustax':       return <USTaxScreen />;
        case 'finance':     return <FinanceModule />;
        case 'payroll':     return <PayrollEngine />;
        case 'transfer':    return <TransferPricing />;
        case 'taxation':    return <TaxEngine />;
        case 'invoices':    return <Invoices />;
        case 'mercury':     return <MercuryBankScreen />;
        case 'reports':     return <ComplianceHub />;
        case 'admin':       return <AdminPanel onOpenOrgManager={() => setShowOrgManager(true)} />;
        default: return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 'var(--r-xl)', background: 'var(--n-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--n-400)', marginBottom: 16 }}>
              <Ico d="M8 2l1 4h4l-3 2.5 1 4L8 10l-3 2.5 1-4L3 6h4z" size={24} />
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--n-700)', margin: 0 }}>Module Under Construction</h2>
            <p style={{ fontSize: 13, color: 'var(--n-400)', marginTop: 8 }}>This section is coming soon.</p>
          </div>
        );
      }
    })();
    return <Suspense fallback={<TabFallback />}>{content}</Suspense>;
  };

  return (
    <QueryClientProvider client={queryClient}>
    <DisplayCurrencyProvider>
      <div style={{ display: 'flex', height: '100vh', background: 'var(--surface-page)', overflow: 'hidden' }}>

        {/* ── Sidebar ────────────────────────────────────────────────── */}
        <Navigation
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          orgName={companyProfile?.projectName}
        />

        {/* ── Main Content Area ───────────────────────────────────────── */}
        <div className="main-content">

          {/* ── Top Header ─────────────────────────────────────────────── */}
          <header className="page-header">
            {/* Breadcrumb */}
            <div className="header-breadcrumb">
              <span className="header-breadcrumb-item">CrossBorder ERP</span>
              <span className="header-breadcrumb-sep" aria-hidden="true">
                <Ico d="M6 4l4 4-4 4" size={12} style={{ color: 'var(--n-300)' }} />
              </span>
              <span className="header-breadcrumb-item">{pageInfo.section}</span>
              <span className="header-breadcrumb-sep" aria-hidden="true">
                <Ico d="M6 4l4 4-4 4" size={12} style={{ color: 'var(--n-300)' }} />
              </span>
              <span className="header-breadcrumb-item current">{pageInfo.title}</span>
            </div>

            {/* Right side controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

              {/* FX Rate Ticker */}
              {fxRate && (
                <div className="header-fx-ticker">
                  <span className="header-fx-label">USD/INR</span>
                  <span style={{ fontWeight: 600, color: 'var(--n-700)' }}>
                    ₹{fxRate.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Fiscal Year Badge */}
              <div className="header-fy-badge">FY 2025–26</div>

              {/* Currency Selector */}
              <CurrencySelector />

              {/* Org Switcher */}
              <button
                type="button"
                onClick={() => setShowOrgManager(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--n-200)',
                  background: 'var(--surface-base)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--n-700)',
                  cursor: 'pointer',
                  transition: 'all var(--t-base)',
                  maxWidth: 180,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title="Switch organisation"
              >
                <Ico d={['M3 4h10a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1z', 'M2 7h12']} size={13} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
                  {companyProfile?.projectName || 'Select org'}
                </span>
                <Ico d="M4 6l4 4 4-4" size={11} style={{ color: 'var(--n-400)', flexShrink: 0 }} />
              </button>

              {/* AI Assistant toggle */}
              <button
                type="button"
                className="header-icon-btn"
                onClick={() => setAiWidgetOpen(!aiWidgetOpen)}
                title="AI Assistant"
                aria-label="Toggle AI Assistant"
                style={{ position: 'relative' }}
              >
                <Ico d={['M8 2a3 3 0 100 6 3 3 0 000-6z', 'M2 14c0-3 2.7-5 6-5s6 2 6 5']} size={16} />
                {advice && (
                  <span style={{
                    position: 'absolute', top: 6, right: 6,
                    width: 7, height: 7, borderRadius: '50%',
                    background: 'var(--success)', border: '1.5px solid #fff',
                  }} />
                )}
              </button>

              {/* Notifications */}
              <button type="button" className="header-icon-btn" title="Notifications" aria-label="Notifications">
                <Ico d={['M8 2a5 5 0 00-5 5v3l-1 2h12l-1-2V7a5 5 0 00-5-5z', 'M6.5 13a1.5 1.5 0 003 0']} size={16} />
                <span className="header-notif-dot" aria-hidden="true" />
              </button>

              {/* User Avatar */}
              <div className="header-avatar" title="Account settings" role="button">
                {(companyProfile?.projectName ?? 'CB').slice(0, 2).toUpperCase()}
              </div>
            </div>
          </header>

          {/* ── Page Content ──────────────────────────────────────────── */}
          <main className="page-body">
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
              {renderContent()}
            </div>
          </main>
        </div>

        {/* ── Org Manager Overlay ──────────────────────────────────────── */}
        {showOrgManager && (
          <Suspense fallback={null}>
            <OrgManager
              onClose={() => setShowOrgManager(false)}
              onSelect={() => {
                setCompanyProfile(getCompanyProfile());
                setShowOrgManager(false);
              }}
            />
          </Suspense>
        )}

        {/* ── AI Assistant Widget ──────────────────────────────────────── */}
        {aiWidgetOpen && (
          <div style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 360,
            zIndex: 'var(--z-modal)' as never,
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden',
            border: '1px solid var(--n-150)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 480,
          }}>
            {/* Widget header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px',
              background: 'var(--sidebar-bg)',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#4ade80',
                boxShadow: '0 0 6px rgba(74,222,128,0.6)',
                animation: 'pulse 2s ease-in-out infinite',
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)', flex: 1 }}>
                CrossBorder AI
              </span>
              <button
                type="button"
                onClick={() => setShowQueryHistory(!showQueryHistory)}
                title="Query history"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: '4px 6px', borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}
              >
                {showQueryHistory ? 'Back' : 'History'}
              </button>
              <button
                type="button"
                onClick={() => { setAiWidgetOpen(false); setAdvice(''); setLastAuditRun(null); setShowAuditDetail(false); }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--r-sm)' }}
                title="Close"
              >
                <Ico d={['M4 4l8 8', 'M12 4l-8 8']} size={14} />
              </button>
            </div>

            {/* Widget body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: 'var(--surface-base)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {showQueryHistory ? (
                /* History view */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p className="text-label" style={{ color: 'var(--n-400)', marginBottom: 4 }}>Previous Queries</p>
                  {queryHistory.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--n-400)' }}>No previous queries.</p>
                  ) : (
                    queryHistory.slice(0, 10).map((q) => (
                      <button
                        key={q.id}
                        onClick={() => loadPreviousQuery(q)}
                        style={{
                          width: '100%', textAlign: 'left', padding: '9px 12px',
                          borderRadius: 'var(--r-md)', border: '1px solid var(--n-150)',
                          background: 'var(--surface-sunken)', cursor: 'pointer',
                          transition: 'all var(--t-base)',
                        }}
                      >
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--n-800)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.query}</p>
                        <p style={{ fontSize: 11, color: 'var(--n-400)', margin: '2px 0 0' }}>
                          {new Date(q.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                /* Chat view */
                <>
                  {advice && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* User bubble */}
                      <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 12px', borderRadius: '10px 10px 2px 10px', background: 'var(--accent)', color: '#fff', fontSize: 13 }}>
                        {query}
                      </div>
                      {/* Agent bubble */}
                      <div style={{ alignSelf: 'flex-start', maxWidth: '92%', padding: '10px 14px', borderRadius: '10px 10px 10px 2px', background: 'var(--surface-sunken)', border: '1px solid var(--n-150)', fontSize: 13, color: 'var(--n-800)', lineHeight: 1.55 }}>
                        {advice}
                      </div>

                      {agentsUsed.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {agentsUsed.map((a) => (
                            <span key={a} className="badge neutral" style={{ fontSize: 10 }}>{a}</span>
                          ))}
                        </div>
                      )}

                      {lastAuditRun && (
                        <div style={{ paddingTop: 8, borderTop: '1px solid var(--n-100)' }}>
                          <button
                            type="button"
                            onClick={() => setShowAuditDetail(!showAuditDetail)}
                            style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--n-400)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
                          >
                            <Ico d={showAuditDetail ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} size={12} />
                            Audit trail
                          </button>
                          {showAuditDetail && (
                            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--n-500)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {lastAuditRun.intent && (
                                <p style={{ margin: 0 }}><strong>Intent:</strong> {lastAuditRun.intent}</p>
                              )}
                              {lastAuditRun.toolCalls.length > 0 && (
                                <p style={{ margin: 0 }}>
                                  <strong>Tools:</strong>{' '}
                                  {lastAuditRun.toolCalls.map((t) => t.error ? `${t.toolId}(err)` : t.toolId).join(', ')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {!advice && (
                    <div className="empty-state" style={{ padding: '24px 8px' }}>
                      <div className="empty-icon">
                        <Ico d={['M8 2a3 3 0 100 6 3 3 0 000-6z', 'M2 14c0-3 2.7-5 6-5s6 2 6 5']} size={22} />
                      </div>
                      <p className="empty-title" style={{ fontSize: 13 }}>Ask about your finances</p>
                      <p className="empty-desc" style={{ fontSize: 12 }}>
                        GST liability, TDS sections, Form 5472, transfer pricing, payroll…
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Input bar */}
            {!showQueryHistory && (
              <div style={{ padding: '10px 12px', background: 'var(--surface-base)', borderTop: '1px solid var(--n-100)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Ask about GST, TDS, Form 5472…"
                  className="form-input"
                  style={{ flex: 1, margin: 0, fontSize: 13 }}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
                />
                <button
                  type="button"
                  onClick={handleAskAI}
                  disabled={!query.trim() || isLoadingAdvice}
                  className="btn btn-primary btn-icon"
                  title="Send"
                >
                  {isLoadingAdvice
                    ? <div className="spinner spinner-sm" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} />
                    : <Ico d="M3 8h10M9 4l4 4-4 4" size={14} />
                  }
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </DisplayCurrencyProvider>
    </QueryClientProvider>
  );
};

export default App;
