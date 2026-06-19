import React, { useState, useMemo } from 'react';
import type { Invoice, InvoiceStatus } from '../../types';
import { useInvoices } from '../../hooks/useInvoices';

interface InvoiceListProps {
  activeId: string | null;
  onSelect: (invoice: Invoice) => void;
  onNew: () => void;
  onDuplicate: (invoice: Invoice) => void;
  onDelete: (id: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ['All', 'Draft', 'Sent', 'Paid', 'Overdue'] as const;

const STATUS_BADGE: Record<InvoiceStatus, { bg: string; color: string; label: string }> = {
  Draft:         { bg: '#f1f5f9',        color: '#64748b',        label: 'Draft'         },
  Sent:          { bg: '#dbeafe',        color: '#1d4ed8',        label: 'Sent'          },
  Viewed:        { bg: '#e0e7ff',        color: '#4338ca',        label: 'Viewed'        },
  PartiallyPaid: { bg: '#ccfbf1',        color: '#0d9488',        label: 'Partial'       },
  Paid:          { bg: '#dcfce7',        color: '#15803d',        label: 'Paid'          },
  Overdue:       { bg: '#fee2e2',        color: '#dc2626',        label: 'Overdue'       },
  Cancelled:     { bg: '#f1f5f9',        color: '#94a3b8',        label: 'Cancelled'     },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtAmount(amount: number, currency: 'INR' | 'USD'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

// ── Skeleton row ───────────────────────────────────────────────────────────────

const SkeletonRow: React.FC = () => (
  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--n-100)', display: 'flex', flexDirection: 'column', gap: 6 }}>
    {[80, 55, 40].map((w) => (
      <div key={w} style={{ height: 10, width: `${w}%`, borderRadius: 4, background: 'var(--n-100)', animation: 'pulse 1.4s ease-in-out infinite' }} />
    ))}
  </div>
);

// ── Main component ─────────────────────────────────────────────────────────────

const InvoiceList: React.FC<InvoiceListProps> = ({ activeId, onSelect, onNew, onDuplicate, onDelete }) => {
  const { data: invoices = [], isLoading } = useInvoices();
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── Derived lists ────────────────────────────────────────────────────────────

  const counts = useMemo(() => {
    const map: Record<string, number> = { All: invoices.length };
    for (const inv of invoices) {
      map[inv.status] = (map[inv.status] ?? 0) + 1;
    }
    return map;
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices
      .filter((inv) => statusFilter === 'All' || inv.status === statusFilter)
      .filter((inv) =>
        !q ||
        inv.number.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q)
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, statusFilter, search]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)', borderRight: '1px solid var(--n-200)', width: 280, minWidth: 240, userSelect: 'none' }}>

      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--n-200)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: 'var(--n-600)', textTransform: 'uppercase' }}>Invoices</span>
          <button
            onClick={onNew}
            style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span> New
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--n-400)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoices…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px 5px 26px', fontSize: 11, borderRadius: 6, border: '1px solid var(--n-200)', background: 'var(--n-50)', outline: 'none', color: 'var(--n-600)' }}
          />
        </div>
      </div>

      {/* Status filter pills */}
      <div style={{ display: 'flex', gap: 4, padding: '7px 10px', borderBottom: '1px solid var(--n-100)', overflowX: 'auto', flexShrink: 0 }}>
        {STATUS_FILTERS.map((s) => {
          const active = statusFilter === s;
          const count = counts[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 10, fontWeight: active ? 700 : 500,
                padding: '2px 7px', borderRadius: 20, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                background: active ? 'var(--accent)' : 'var(--n-100)',
                color: active ? '#fff' : 'var(--n-500)',
                transition: 'all 0.12s',
              }}
            >
              {s}
              <span style={{ fontSize: 9, fontWeight: 700, background: active ? 'rgba(255,255,255,0.25)' : 'var(--n-200)', color: active ? '#fff' : 'var(--n-500)', borderRadius: 8, padding: '0 4px', lineHeight: '14px' }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* List body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: 'var(--n-400)' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{search ? 'No results found' : 'No invoices yet'}</span>
            {!search && (
              <button onClick={onNew} style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                Create your first invoice
              </button>
            )}
          </div>
        ) : (
          filtered.map((inv) => {
            const isActive = inv.id === activeId;
            const isHovered = hoveredId === inv.id;
            const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.Draft;

            return (
              <div
                key={inv.id}
                onClick={() => onSelect(inv)}
                onMouseEnter={() => setHoveredId(inv.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  position: 'relative',
                  padding: '9px 12px',
                  borderBottom: '1px solid var(--n-100)',
                  cursor: 'pointer',
                  background: isActive ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : isHovered ? 'var(--n-50)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
              >
                {/* Row top: number + amount */}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-700, #1e293b)', letterSpacing: 0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
                    {inv.number}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-700, #1e293b)', whiteSpace: 'nowrap' }}>
                    {fmtAmount(inv.total, inv.currency)}
                  </span>
                </div>

                {/* Row middle: customer + status badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--n-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                    {inv.customerName}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: badge.bg, color: badge.color, whiteSpace: 'nowrap' }}>
                    {badge.label}
                  </span>
                </div>

                {/* Row bottom: date */}
                <div style={{ fontSize: 9, color: 'var(--n-400)' }}>{fmtDate(inv.date)}</div>

                {/* Hover actions */}
                {isHovered && (
                  <div
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 2 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Duplicate */}
                    <button
                      title="Duplicate"
                      onClick={() => onDuplicate(inv)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 5, border: '1px solid var(--n-200)', background: 'var(--surface-base)', cursor: 'pointer', color: 'var(--n-500)' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    {/* Delete */}
                    <button
                      title="Delete"
                      onClick={() => onDelete(inv.id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 5, border: '1px solid #fecaca', background: '#fff1f2', cursor: 'pointer', color: '#ef4444' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default InvoiceList;
