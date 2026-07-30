import React, { useState, useEffect, useMemo } from 'react';
import { getModulePermissions } from '../services/storageService';
import { isPeopleModuleEnabled } from '../services/featureFlags';
import type { AppUserRole } from '../services/sessionAuth';

interface NavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  orgName?: string | null;
  portalRole?: AppUserRole;
  userLabel?: string | null;
  onSignOut?: () => void;
}

const MODULE_PERMISSION_MAP: Record<string, string> = {
  revenue: 'stripe',
  sync:    'stripe',
  transfer:'tp',
  agents:  'ai',
  reports: 'filing',
};

const Icon: React.FC<{ d: string | string[]; size?: number; className?: string }> = ({
  d, size = 16, className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const ICONS: Record<string, string | string[]> = {
  dashboard:  ['M2 2h5v5H2z', 'M9 2h5v5H9z', 'M2 9h5v5H2z', 'M9 9h5v5H9z'],
  agents:     ['M8 2a3 3 0 100 6 3 3 0 000-6z', 'M2 14c0-3 2.7-5 6-5s6 2 6 5'],
  balance:    ['M2 8h12', 'M4 4l4 4 4-4', 'M3 11h10a1 1 0 001-1V6a1 1 0 00-1-1H3a1 1 0 00-1 1v4a1 1 0 001 1z'],
  pitch:      ['M2 12l4-4 3 3 5-7', 'M12 4h2v2'],
  sync:       ['M13 3.5A6 6 0 112.5 8', 'M2 3.5V8H6.5'],
  revenue:    ['M8 2v12', 'M5 5h4.5a2 2 0 010 4H5', 'M5 9h5a2 2 0 010 4H5v-4'],
  vendors:    ['M7 2H3a1 1 0 00-1 1v3l2 1-2 1v3a1 1 0 001 1h4', 'M9 2h4a1 1 0 011 1v3l-2 1 2 1v3a1 1 0 01-1 1H9'],
  journal:    ['M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z', 'M5 5h6', 'M5 8h6', 'M5 11h4'],
  accounting: ['M2 14V8l6-6 6 6v6H2z', 'M6 14V10h4v4'],
  finance:    ['M2 14l4-5 3 3 5-8', 'M11 4h3v3'],
  transfer:   ['M11 4l3 3-3 3', 'M2 7h12', 'M5 12l-3 3 3 3'],
  taxation:   ['M8 2l1.8 3.6L14 6.2l-3 2.9.7 4.1L8 11l-3.7 2.2.7-4.1-3-2.9 4.2-.6z'],
  payroll:    ['M2 6h12', 'M2 10h12', 'M5 2v12', 'M9 2v12'],
  people:     ['M8 2a3 3 0 100 6 3 3 0 000-6z', 'M2 14c0-3 2.7-5 6-5s6 2 6 5', 'M12 9v4', 'M10 11h4'],
  'emp-home': ['M2 2h5v5H2z', 'M9 2h5v5H9z', 'M2 9h5v5H2z', 'M9 9h5v5H9z'],
  'emp-profile': ['M8 2a3 3 0 100 6 3 3 0 000-6z', 'M2 14c0-3 2.7-5 6-5s6 2 6 5'],
  'emp-pay':  ['M8 2v12', 'M5 5h4.5a2 2 0 010 4H5', 'M5 9h5a2 2 0 010 4H5v-4'],
  'emp-leave': ['M3 2h10a1 1 0 011 1v2H2V3a1 1 0 011-1z', 'M2 5h12v9a1 1 0 01-1 1H3a1 1 0 01-1-1V5z'],
  reports:    ['M4 2h8l2 2v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z', 'M6 7h4', 'M6 10h4'],
  filing:     ['M3 2h10a1 1 0 011 1v2H2V3a1 1 0 011-1z', 'M2 5h12v9a1 1 0 01-1 1H3a1 1 0 01-1-1V5z', 'M8 9v3', 'M6.5 10.5l1.5-1.5 1.5 1.5'],
  foreign:    ['M8 2a6 6 0 100 12A6 6 0 008 2z', 'M2 8h12', 'M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6', 'M8 2c1.5 2 2.5 3.8 2.5 6s-1 4-2.5 6'],
  ustax:      ['M2 4h12v9a1 1 0 01-1 1H3a1 1 0 01-1-1V4z', 'M5 4V2h6v2', 'M5 8h6', 'M5 11h4'],
  admin:      ['M8 2l1.5 3H13l-2.7 2 1 3L8 8.4 5.7 10l1-3L4 5h3.5z', 'M8 12a2 2 0 100 4 2 2 0 000-4'],
  chevronDown: 'M4 6l4 4 4-4',
  chevronRight: 'M6 4l4 4-4 4',
  building:   ['M2 14V6l6-4 6 4v8H2z', 'M6 14V10h4v4'],
  flag:       'M3 2v12M3 2l10 3-10 3',
  check:      'M3 8l4 4 6-6',
};

interface Tab { id: string; label: string; icon: string; badge?: number | string }
interface Section { title: string; tabs: Tab[] }

const SECTIONS: Section[] = [
  {
    title: 'Overview',
    tabs: [
      { id: 'dashboard',  label: 'Dashboard',       icon: 'dashboard'  },
      { id: 'agents',     label: 'AI Assistant',    icon: 'agents'     },
      { id: 'balance',    label: 'Balance & Revenue',icon: 'balance'   },
      { id: 'pitch',      label: 'Investor Pitch',  icon: 'pitch'      },
    ],
  },
  {
    title: 'Finance & Accounting',
    tabs: [
      { id: 'sync',       label: 'Data Sync',        icon: 'sync'       },
      { id: 'revenue',    label: 'Revenue',          icon: 'revenue'    },
      { id: 'vendors',    label: 'Vendors & AP',     icon: 'vendors'    },
      { id: 'journal',    label: 'Journal Entries',  icon: 'journal'    },
      { id: 'recon',      label: 'Reconciliation',   icon: 'accounting' },
      { id: 'accounting', label: 'Financial Books',  icon: 'accounting' },
      { id: 'finance',    label: 'P&E by Entity',    icon: 'finance'    },
      { id: 'transfer',   label: 'Transfer Pricing', icon: 'transfer'   },
      { id: 'taxation',   label: 'Tax Strategy',     icon: 'taxation'   },
      { id: 'mercury',    label: 'Mercury Bank',     icon: 'balance'    },
      { id: 'invoices',   label: 'Invoices',         icon: 'reports'    },
    ],
  },
  {
    title: 'HR & Payroll',
    tabs: [
      { id: 'people',     label: 'People',           icon: 'people'     },
      { id: 'payroll',    label: 'Payroll',          icon: 'payroll'    },
    ],
  },
  {
    title: 'Compliance',
    tabs: [
      { id: 'reports',    label: 'Compliance Hub',   icon: 'reports'    },
      { id: 'filing',     label: 'Filing Calendar',  icon: 'filing'     },
      { id: 'foreign',    label: 'Foreign Income & WHT', icon: 'foreign' },
      { id: 'ustax',      label: 'US Tax (Fed & State)', icon: 'ustax'   },
      { id: 'admin',      label: 'Admin Panel',      icon: 'admin'      },
    ],
  },
];

const EMPLOYEE_SECTIONS: Section[] = [
  {
    title: 'My workspace',
    tabs: [
      { id: 'emp-home', label: 'Home', icon: 'emp-home' },
      { id: 'emp-profile', label: 'My profile', icon: 'emp-profile' },
      { id: 'emp-pay', label: 'Pay & slips', icon: 'emp-pay' },
      { id: 'emp-leave', label: 'Leave', icon: 'emp-leave' },
    ],
  },
];

const COLLAPSED_KEY = 'nav_sidebar_collapsed';

const Navigation: React.FC<NavProps> = ({
  activeTab,
  setActiveTab,
  orgName,
  portalRole = 'admin',
  userLabel,
  onSignOut,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted]         = useState(false);
  const [collapsed, setCollapsed]     = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
  });
  const permissions                   = getModulePermissions();
  const peopleEnabled                 = isPeopleModuleEnabled();

  const sections = useMemo(() => {
    if (portalRole === 'employee') return EMPLOYEE_SECTIONS;
    if (peopleEnabled) return SECTIONS;
    return SECTIONS.map((section) => {
      if (section.title !== 'HR & Payroll') return section;
      return {
        ...section,
        tabs: section.tabs
          .filter((t) => t.id !== 'people')
          .map((t) => (t.id === 'payroll' ? { ...t, label: 'Payroll & HR' } : t)),
      };
    });
  }, [peopleEnabled, portalRole]);

  useEffect(() => { setMounted(true); }, []);

  // Sync CSS variable when collapsed state changes
  useEffect(() => {
    const root = document.documentElement;
    if (collapsed) {
      root.style.setProperty('--sidebar-width', '52px');
    } else {
      root.style.setProperty('--sidebar-width', '240px');
    }
    try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch { /* noop */ }
  }, [collapsed]);

  const toggleCollapse = () => setCollapsed(c => !c);

  const isTabEnabled = (tabId: string): boolean => {
    const permId = MODULE_PERMISSION_MAP[tabId];
    if (!permId) return true;
    const p = permissions.find((x) => x.id === permId);
    return p?.enabled ?? true;
  };

  const handleTabClick = (tabId: string) => {
    if (isTabEnabled(tabId)) {
      setActiveTab(tabId);
      setSidebarOpen(false);
    }
  };

  const initials = (name?: string | null) =>
    name ? name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) : 'CB';

  const sidebarContent = (
    <>
      {/* ── Brand Header ────────────────────────────────────────────────── */}
      <div className="sidebar-header" style={{ position: 'relative' }}>
        <div className="sidebar-brand">
          <div className="sidebar-logo" aria-hidden="true">CB</div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">CrossBorder</div>
            <div className="sidebar-brand-sub">Financial OS</div>
          </div>
        </div>
        {/* Collapse toggle — only visible on desktop */}
        <button
          type="button"
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="sidebar-collapse-btn"
          style={{ display: 'none' /* shown via CSS @media */ } as React.CSSProperties}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon d={collapsed ? 'M6 4l4 4-4 4' : 'M10 4l-4 4 4 4'} size={12} />
        </button>
      </div>

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {sections.map((section) => (
          <div key={section.title} className="sidebar-section">
            <span className="sidebar-section-label">{section.title}</span>
            <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {section.tabs.map((tab) => {
                const enabled = isTabEnabled(tab.id);
                const active  = activeTab === tab.id;
                const iconDef = ICONS[tab.icon] ?? ICONS.dashboard;

                return (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => handleTabClick(tab.id)}
                      disabled={!enabled}
                      aria-current={active ? 'page' : undefined}
                      data-label={tab.label}
                      className={`sidebar-item${active ? ' active' : ''}${!enabled ? ' disabled' : ''}`}
                    >
                      <span className="sidebar-icon" aria-hidden="true">
                        <Icon d={iconDef} />
                      </span>
                      <span className="sidebar-label">{tab.label}</span>
                      {!enabled ? (
                        <span className="sidebar-badge off">OFF</span>
                      ) : tab.badge ? (
                        <span className={`sidebar-badge${typeof tab.badge === 'number' && tab.badge > 5 ? ' critical' : ''}`}>
                          {tab.badge}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── Entity Pills + Org Footer ────────────────────────────────────── */}
      <div className="sidebar-footer">
        {portalRole === 'admin' && (
          <div className="sidebar-entity-pills">
            <div className="entity-pill india" title="Indian LLP (Parent)">
              <div className="entity-dot" />
              IN LLP
            </div>
            <div className="entity-pill us" title="US Subsidiary">
              <div className="entity-dot" />
              US Corp
            </div>
          </div>
        )}

        <div className="sidebar-org-chip" style={{ marginTop: 8 }}>
          <div className="sidebar-org-avatar" aria-hidden="true">
            {initials(userLabel || orgName)}
          </div>
          <div className="sidebar-org-info">
            <div className="sidebar-org-name">{userLabel || orgName || 'Select organisation'}</div>
            <div className="sidebar-org-meta">
              {portalRole === 'employee' ? 'Employee portal' : 'Admin · Active organisation'}
            </div>
          </div>
        </div>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="w-full mt-2 px-3 py-2 rounded-lg text-xs font-semibold text-left"
            style={{ color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)' }}
          >
            Sign out
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile hamburger ────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation"
        aria-expanded={sidebarOpen}
        className="mobile-menu-btn"
        style={{
          position: 'fixed',
          top: 14,
          left: 14,
          zIndex: 'var(--z-fixed)' as never,
          width: 38,
          height: 38,
          borderRadius: 'var(--r-md)',
          background: 'var(--sidebar-bg)',
          border: '1px solid var(--sidebar-border)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <Icon d={['M3 4h10', 'M3 8h10', 'M3 12h10']} />
      </button>

      {/* ── Mobile overlay ──────────────────────────────────────────────── */}
      {mounted && (
        <div
          role="presentation"
          onClick={() => setSidebarOpen(false)}
          style={{
            display: sidebarOpen ? 'block' : 'none',
            position: 'fixed',
            inset: 0,
            zIndex: 'calc(var(--z-fixed) - 1)' as never,
            background: 'rgba(6,12,26,0.55)',
            backdropFilter: 'blur(4px)',
          }}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={`sidebar${sidebarOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}
        aria-label="Application navigation"
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
          style={{
            display: 'none',
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 1,
            width: 28,
            height: 28,
            borderRadius: 'var(--r-sm)',
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="lg:hidden flex"
        >
          <Icon d={['M4 4l8 8', 'M12 4l-8 8']} />
        </button>

        {sidebarContent}
      </aside>
    </>
  );
};

export default Navigation;
