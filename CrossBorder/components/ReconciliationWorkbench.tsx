import React, { useCallback, useEffect, useState } from 'react';
import { getActiveOrgId } from '../services/storageService';
import type { ReconItemStatus, ReconPaneSummary, ThreeWayReconciliationReport } from '../services/threeWayReconciliation';

const API_BASE = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
  || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001` : 'http://localhost:3001');

type PaneKey = 'stripeMercury' | 'ledgerBank' | 'gstr2bPurchases';

const PANE_META: Record<PaneKey, { title: string; subtitle: string }> = {
  stripeMercury: {
    title: 'Stripe ↔ Mercury',
    subtitle: 'Payouts / charges vs Mercury bank credits',
  },
  ledgerBank: {
    title: 'Ledger ↔ Bank',
    subtitle: 'Books vs Indian bank statement imports',
  },
  gstr2bPurchases: {
    title: 'GSTR-2B ↔ Purchases',
    subtitle: 'Claimed ITC vs purchase-register ITC',
  },
};

function statusColor(status: ReconItemStatus): string {
  if (status === 'matched') return '#047857';
  if (status === 'disputed') return '#b45309';
  return '#b91c1c';
}

function PaneCard({
  paneKey,
  summary,
  filter,
}: {
  paneKey: PaneKey;
  summary: ReconPaneSummary;
  filter: ReconItemStatus | 'all';
}) {
  const meta = PANE_META[paneKey];
  const items = filter === 'all' ? summary.items : summary.items.filter((i) => i.status === filter);

  return (
    <section
      className="rounded-2xl border overflow-hidden flex flex-col min-h-[320px]"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
    >
      <header className="px-4 py-3 border-b flex flex-wrap items-start justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <h2 className="font-heading text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{meta.title}</h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{meta.subtitle}</p>
        </div>
        <div className="flex gap-2 text-[10px] font-black uppercase tracking-wider">
          <span style={{ color: '#047857' }}>{summary.matched} matched</span>
          <span style={{ color: '#b91c1c' }}>{summary.unmatched} unmatched</span>
          <span style={{ color: '#b45309' }}>{summary.disputed} disputed</span>
        </div>
      </header>
      <div className="flex-1 overflow-auto max-h-80">
        {items.length === 0 ? (
          <p className="p-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>No items in this filter</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {items.map((item) => (
              <li key={item.id} className="px-4 py-3 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="px-2 py-0.5 rounded-full font-black uppercase tracking-wider text-[9px]"
                    style={{ color: statusColor(item.status), background: `${statusColor(item.status)}18` }}
                  >
                    {item.status}
                  </span>
                  {item.reason && <span style={{ color: 'var(--text-muted)' }}>{item.reason}</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Left</p>
                    {item.left ? (
                      <p style={{ color: 'var(--text-primary)' }}>
                        {item.left.date} · {item.left.label}
                        <span className="font-mono ml-1">₹{item.left.amount.toLocaleString('en-IN')}</span>
                      </p>
                    ) : (
                      <p style={{ color: 'var(--text-muted)' }}>—</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Right</p>
                    {item.right ? (
                      <p style={{ color: 'var(--text-primary)' }}>
                        {item.right.date} · {item.right.label}
                        <span className="font-mono ml-1">₹{item.right.amount.toLocaleString('en-IN')}</span>
                      </p>
                    ) : (
                      <p style={{ color: 'var(--text-muted)' }}>—</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const ReconciliationWorkbench: React.FC = () => {
  const [threeWay, setThreeWay] = useState<ThreeWayReconciliationReport | null>(null);
  const [complianceErrors, setComplianceErrors] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ReconItemStatus | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const orgId = getActiveOrgId() || 'default';
      const res = await fetch(`${API_BASE}/api/reconciliation/workbench?orgId=${encodeURIComponent(orgId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        threeWay: ThreeWayReconciliationReport;
        compliance?: { summary?: { errors?: number } };
      };
      setThreeWay(data.threeWay);
      setComplianceErrors(data.compliance?.summary?.errors ?? 0);
    } catch (e) {
      setError((e as Error).message || 'Failed to load workbench');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Reconciliation Workbench
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Three-way view: Stripe/Mercury, ledger/bank, and GSTR-2B ITC (REQ-058)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'matched', 'unmatched', 'disputed'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border"
              style={{
                borderColor: filter === f ? 'var(--bg-sidebar)' : 'var(--border-subtle)',
                background: filter === f ? 'var(--bg-sidebar)' : 'transparent',
                color: filter === f ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {f}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ background: 'var(--bg-sidebar)' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {complianceErrors > 0 && (
        <div className="rounded-xl px-4 py-3 text-sm border" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
          {complianceErrors} compliance guard error{complianceErrors === 1 ? '' : 's'} also found — run Data Sync / ledger checks.
        </div>
      )}

      {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading reconciliation…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {threeWay && !loading && (
        <>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Generated {new Date(threeWay.generatedAt).toLocaleString()}
          </p>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <PaneCard paneKey="stripeMercury" summary={threeWay.stripeMercury} filter={filter} />
            <PaneCard paneKey="ledgerBank" summary={threeWay.ledgerBank} filter={filter} />
            <PaneCard paneKey="gstr2bPurchases" summary={threeWay.gstr2bPurchases} filter={filter} />
          </div>
        </>
      )}
    </div>
  );
};

export default ReconciliationWorkbench;
