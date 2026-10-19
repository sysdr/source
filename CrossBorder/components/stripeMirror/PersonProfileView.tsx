import React from 'react';
import type { PersonPayment, PersonProfile, SubscriptionDetail } from '../../services/stripeMirrorClient';
import { LIFECYCLE_LABEL, LIFECYCLE_STYLE, formatMinor, formatPaid, formatPlan, formatUnix } from './format';

const SUB_STYLE: Record<string, string> = {
  active: 'text-emerald-600', trialing: 'text-amber-600', past_due: 'text-red-600', unpaid: 'text-red-600',
  canceled: 'text-slate-400', paused: 'text-amber-600',
};

function subTiming(s: SubscriptionDetail): string {
  if (s.endedAt || s.canceledAt) return `ended ${formatUnix(s.endedAt ?? s.canceledAt)}`;
  if (s.status === 'trialing') return `trial ends ${formatUnix(s.trialEnd)}`;
  const next = formatUnix(s.currentPeriodEnd);
  return s.cancelAtPeriodEnd ? `cancels ${next}` : `renews ${next}`;
}

const SubscriptionRow: React.FC<{ s: SubscriptionDetail }> = ({ s }) => (
  <tr>
    <td className="px-5 py-2.5">
      {s.items.length === 0 && <span className="text-slate-400">No items</span>}
      {s.items.map((i, n) => <span key={n} className="block font-bold text-slate-800">{formatPlan(i)}</span>)}
      <span className="block font-mono text-[10px] text-slate-400">{s.id}</span>
    </td>
    <td className="px-3 py-2.5 text-slate-600">{s.accountName}</td>
    <td className={`px-3 py-2.5 font-black uppercase text-[10px] ${SUB_STYLE[s.status] ?? 'text-slate-500'}`}>
      {s.status.replace('_', ' ')}
      <span className="block normal-case font-medium text-slate-400">{subTiming(s)}</span>
    </td>
    <td className="px-5 py-2.5 text-slate-500">{formatUnix(s.created)}</td>
  </tr>
);

const PaymentHistoryRow: React.FC<{ p: PersonPayment }> = ({ p }) => (
  <tr>
    <td className="px-5 py-2.5 text-slate-500">{formatUnix(p.created)}</td>
    <td className="px-3 py-2.5 font-bold tabular-nums">
      {formatMinor(p.amount, p.currency)}
      {p.amountRefunded > 0 && <span className="block text-[10px] font-medium text-red-500">−{formatMinor(p.amountRefunded, p.currency)} refunded</span>}
    </td>
    <td className={`px-3 py-2.5 font-black uppercase text-[10px] ${p.status === 'succeeded' ? 'text-emerald-600' : 'text-red-600'}`}>
      {p.refunded ? 'refunded' : p.status}
      {p.failureMessage && <span className="block normal-case font-medium">{p.failureMessage}</span>}
    </td>
    <td className="px-3 py-2.5 text-slate-600">{p.accountName}</td>
    <td className="px-5 py-2.5 text-slate-500">
      {p.description || p.invoiceId || '—'}
      <span className="block font-mono text-[10px] text-slate-400">{p.id}</span>
    </td>
    <td className="px-5 py-2.5 text-right">
      {p.receiptUrl && <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 text-[10px] font-black uppercase">Receipt</a>}
    </td>
  </tr>
);

const Section: React.FC<{ title: string; count: number; empty: string; children: React.ReactNode }> = ({ title, count, empty, children }) => (
  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
    <h3 className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50">{title} ({count})</h3>
    {count === 0 ? <p className="p-5 text-xs text-slate-400">{empty}</p> : <table className="w-full text-left text-xs"><tbody className="divide-y divide-slate-100">{children}</tbody></table>}
  </div>
);

const PersonProfileView: React.FC<{ profile: PersonProfile }> = ({ profile }) => {
  const { person } = profile;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-indigo-200 shadow-sm p-5 flex flex-wrap justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900">{person.name || person.email || person.key}</h3>
          <p className="text-xs text-slate-500">{person.email || 'No email on file'}</p>
          <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${LIFECYCLE_STYLE[person.lifecycle]}`}>
            {LIFECYCLE_LABEL[person.lifecycle]}
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-6 text-right">
          <div><dt className="text-[10px] font-black uppercase text-slate-400">Accounts</dt><dd className="text-sm font-black">{person.accountCount}</dd></div>
          <div><dt className="text-[10px] font-black uppercase text-slate-400">Live subscriptions</dt><dd className="text-sm font-black">{person.liveSubscriptions}</dd></div>
          <div><dt className="text-[10px] font-black uppercase text-slate-400">Net paid</dt><dd className="text-sm font-black tabular-nums">{formatPaid(person.paid)}</dd></div>
        </dl>
      </div>
      <Section title="Subscriptions across accounts" count={profile.subscriptions.length} empty="No subscriptions.">
        {profile.subscriptions.map((s) => <SubscriptionRow key={`${s.accountId}|${s.id}`} s={s} />)}
      </Section>
      <Section title="Payment history" count={profile.payments.length} empty="No payments.">
        {profile.payments.map((p) => <PaymentHistoryRow key={`${p.accountId}|${p.id}`} p={p} />)}
      </Section>
      <p className="text-[10px] text-slate-400">
        Stripe customer records: {profile.customers.map((c) => `${c.customerId} (${c.accountName})`).join(' · ')}
      </p>
    </div>
  );
};

export default PersonProfileView;
