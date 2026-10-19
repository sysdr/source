import React, { useState } from 'react';
import { getAccessRole } from '../../services/apiClient';
import { getActiveOrgId } from '../../services/storageService';
import type { LifecycleFilter, MirrorCustomer, PersonRef } from '../../services/stripeMirrorClient';
import PeopleView from './PeopleView';
import AccountsTable from './AccountsTable';
import CustomersTable from './CustomersTable';
import PaymentsPanel from './PaymentsPanel';
import { LIFECYCLE_LABEL } from './format';
import { PAGE_SIZE, useStripeMirror } from './useStripeMirror';

const LIFECYCLE_TABS: LifecycleFilter[] = ['all', 'current', 'future', 'past', 'none'];

const RunBanner: React.FC<{ running: boolean; status?: string; failed: number }> = ({ running, status, failed }) => {
  if (running) return <p role="status" className="text-xs font-bold text-indigo-600">Sync running… this can take several minutes for large accounts.</p>;
  if (!status) return null;
  return (
    <p role="status" className={`text-xs font-bold ${failed ? 'text-amber-600' : 'text-emerald-600'}`}>
      Last run {status}{failed ? ` — ${failed} account(s) failed, see Last sync column` : ''}.
    </p>
  );
};

const StripeMirrorDashboard: React.FC = () => {
  const orgId = getActiveOrgId() || 'default';
  const isOwner = getAccessRole() === 'owner';
  const m = useStripeMirror(orgId);
  const [selected, setSelected] = useState<MirrorCustomer | null>(null);
  const [view, setView] = useState<'accounts' | 'profiles'>('accounts');
  const [profileRef, setProfileRef] = useState<PersonRef | null>(null);
  const failed = m.lastRun?.results.filter((r) => !r.ok).length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Stripe Accounts</h2>
          <p className="text-slate-500 mt-1 font-medium">
            Read-only mirror of every account in the organisation: customers (current, trial, past) and their payments.
          </p>
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <button type="button" disabled={m.busy || m.running} onClick={() => void m.discover()}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-[10px] font-black uppercase disabled:opacity-40">
              Discover accounts
            </button>
            <button type="button" disabled={m.busy || m.running || m.accounts.length === 0} onClick={() => void m.sync()}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase disabled:opacity-40">
              Sync all accounts
            </button>
          </div>
        )}
      </header>

      <RunBanner running={m.running} status={m.lastRun?.status} failed={failed} />
      {m.notice && <p role="status" className="text-xs text-slate-500">{m.notice}</p>}
      {m.error && <p role="alert" className="text-xs font-bold text-red-600">{m.error}</p>}

      <div className="flex bg-slate-200 p-1 rounded-xl text-[10px] font-black shadow-inner w-fit">
        {([['accounts', 'ACCOUNTS & CUSTOMERS'], ['profiles', 'CUSTOMER PROFILES']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)}
            className={`px-4 py-1.5 rounded-lg ${view === id ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>

      {view === 'profiles' && <PeopleView orgId={orgId} initialRef={profileRef} />}

      {view === 'accounts' && (m.accounts.length === 0 ? (
        <p className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center text-xs text-slate-500">
          No accounts registered yet. {isOwner ? 'Click “Discover accounts” to find every account under the organisation.' : 'Ask an owner to run discovery.'}
        </p>
      ) : (
        <AccountsTable accounts={m.accounts} activeFilter={m.filters.account} syncing={m.busy || m.running}
          isOwner={isOwner} onFilter={(account) => m.updateFilters({ account })} onSync={(id) => void m.sync([id])} />
      ))}

      {view === 'accounts' && <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-200 p-1 rounded-xl text-[10px] font-black shadow-inner">
            {LIFECYCLE_TABS.map((t) => (
              <button key={t} type="button" onClick={() => m.updateFilters({ lifecycle: t })}
                className={`px-3 py-1.5 rounded-lg ${m.filters.lifecycle === t ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500'}`}>
                {LIFECYCLE_LABEL[t].toUpperCase()} {m.page ? `(${m.page.lifecycleCounts[t]})` : ''}
              </button>
            ))}
          </div>
          <input list="mirror-accounts" value={m.filters.account} aria-label="Filter by account id or name"
            onChange={(e) => m.updateFilters({ account: e.target.value })} placeholder="Account id (acct_…) or name"
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono w-64" />
          <datalist id="mirror-accounts">
            {m.accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
          </datalist>
          <input value={m.filters.q} aria-label="Search customers" onChange={(e) => m.updateFilters({ q: e.target.value })}
            placeholder="Search name, email or cus_…" className="px-3 py-2 rounded-xl border border-slate-200 text-xs w-64" />
        </div>
        <CustomersTable page={m.page} loading={m.loading} offset={m.filters.offset} limit={PAGE_SIZE}
          selected={selected} onSelect={setSelected} onPage={(offset) => m.updateFilters({ offset })} />
      </section>}

      {view === 'accounts' && selected && (
        <PaymentsPanel orgId={orgId} customer={selected} onClose={() => setSelected(null)}
          onOpenProfile={() => {
            setProfileRef(selected.email ? { email: selected.email } : { accountId: selected.accountId, customerId: selected.customerId });
            setView('profiles');
          }} />
      )}
    </div>
  );
};

export default StripeMirrorDashboard;
