import React, { useEffect, useState } from 'react';
import {
  stripeMirrorApi, type PersonProfile, type PersonRef, type PersonSummary,
} from '../../services/stripeMirrorClient';
import PersonProfileView from './PersonProfileView';
import { LIFECYCLE_LABEL, LIFECYCLE_STYLE, formatPaid } from './format';

interface Props {
  orgId: string;
  initialRef: PersonRef | null;
}

const PAGE = 50;
const DEBOUNCE_MS = 250;

const PeopleView: React.FC<Props> = ({ orgId, initialRef }) => {
  const [q, setQ] = useState(initialRef?.email ?? '');
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<{ people: PersonSummary[]; total: number } | null>(null);
  const [ref, setRef] = useState<PersonRef | null>(initialRef);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      stripeMirrorApi.people(orgId, q, PAGE, offset)
        .then((r) => { if (!cancelled) { setList(r); setError(null); } })
        .catch((e: Error) => { if (!cancelled) setError(e.message); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [orgId, q, offset]);

  useEffect(() => {
    if (!ref) { setProfile(null); return undefined; }
    let cancelled = false;
    stripeMirrorApi.person(orgId, ref)
      .then((p) => { if (!cancelled) { setProfile(p); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [orgId, ref]);

  const total = list?.total ?? 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-6 items-start">
      <aside className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <input value={q} aria-label="Search customer profiles" placeholder="Name, email, cus_… or acct_…"
          onChange={(e) => { setQ(e.target.value); setOffset(0); }}
          className="w-full px-4 py-3 text-xs border-b border-slate-100 outline-none" />
        <ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
          {list?.people.map((p) => (
            <li key={p.key}>
              <button type="button" onClick={() => setRef(p.email ? { email: p.email } : { accountId: p.key.split('|')[0], customerId: p.key.split('|')[1] })}
                className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${profile?.person.key === p.key ? 'bg-indigo-50/60' : ''}`}>
                <span className="flex justify-between gap-2">
                  <span className="font-bold text-xs text-slate-800 truncate">{p.name || p.email || p.key}</span>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${LIFECYCLE_STYLE[p.lifecycle]}`}>{LIFECYCLE_LABEL[p.lifecycle]}</span>
                </span>
                <span className="block text-[11px] text-slate-500 truncate">{p.email || 'no email'}</span>
                <span className="block text-[10px] text-slate-400">
                  {p.accountCount} account(s) · {p.paymentCount} payment(s) · {formatPaid(p.paid)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {list && total === 0 && <p className="p-6 text-center text-xs text-slate-400">No customers match.</p>}
        <div className="flex justify-between px-4 py-2 border-t border-slate-100 text-[10px] font-black uppercase text-slate-400">
          <span>{total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <span className="space-x-3">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="text-indigo-600 disabled:text-slate-200">Prev</button>
            <button type="button" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className="text-indigo-600 disabled:text-slate-200">Next</button>
          </span>
        </div>
      </aside>
      <div>
        {error && <p role="alert" className="text-xs font-bold text-red-600 mb-3">{error}</p>}
        {profile ? <PersonProfileView profile={profile} /> : (
          <p className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center text-xs text-slate-500">
            Select a customer to see all their subscriptions and payments across accounts.
          </p>
        )}
      </div>
    </div>
  );
};

export default PeopleView;
