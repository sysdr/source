import React from 'react';
import type { CustomerPage, MirrorCustomer } from '../../services/stripeMirrorClient';
import { LIFECYCLE_LABEL, LIFECYCLE_STYLE, formatPaid, formatUnix } from './format';

interface Props {
  page: CustomerPage | null;
  loading: boolean;
  offset: number;
  limit: number;
  selected: MirrorCustomer | null;
  onSelect: (customer: MirrorCustomer) => void;
  onPage: (offset: number) => void;
}

const CustomerRow: React.FC<{ c: MirrorCustomer; active: boolean; onSelect: () => void }> = ({ c, active, onSelect }) => (
  <tr onClick={onSelect} className={`cursor-pointer ${active ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}>
    <td className="px-5 py-3">
      <span className="block font-bold text-slate-800">{c.name || '(no name)'}</span>
      <span className="block text-slate-500">{c.email || '—'}</span>
      <span className="block font-mono text-[10px] text-slate-400">{c.customerId}</span>
    </td>
    <td className="px-3 py-3">
      <span className="block text-slate-700">{c.accountName}</span>
      <span className="block font-mono text-[10px] text-slate-400">{c.accountId}</span>
    </td>
    <td className="px-3 py-3">
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${LIFECYCLE_STYLE[c.lifecycle]}`}>
        {LIFECYCLE_LABEL[c.lifecycle]}
      </span>
      <span className="block text-[10px] text-slate-400 mt-1">
        {[...c.subscriptionStatuses, ...c.scheduleStatuses.map((s) => `schedule:${s}`)].join(', ') || 'no subscriptions'}
      </span>
    </td>
    <td className="px-3 py-3 text-slate-500">{formatUnix(c.created)}</td>
    <td className="px-3 py-3 text-right tabular-nums">{c.paymentCount}</td>
    <td className="px-5 py-3 text-right font-bold tabular-nums">{formatPaid(c.paid)}</td>
  </tr>
);

const CustomersTable: React.FC<Props> = ({ page, loading, offset, limit, selected, onSelect, onPage }) => {
  const total = page?.total ?? 0;
  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <tr>
            <th className="px-5 py-3">Customer</th>
            <th className="px-3 py-3">Account</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Created</th>
            <th className="px-3 py-3 text-right">Payments</th>
            <th className="px-5 py-3 text-right">Net paid</th>
          </tr>
        </thead>
        <tbody className={`divide-y divide-slate-100 ${loading ? 'opacity-50' : ''}`}>
          {page?.customers.map((c) => (
            <CustomerRow key={`${c.accountId}|${c.customerId}`} c={c}
              active={selected?.customerId === c.customerId && selected.accountId === c.accountId}
              onSelect={() => onSelect(c)} />
          ))}
        </tbody>
      </table>
      {page && total === 0 && (
        <p className="p-8 text-center text-xs text-slate-400">No customers match these filters.</p>
      )}
      <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-[10px] font-black uppercase text-slate-400">
        <span>{total === 0 ? '0' : `${offset + 1}–${Math.min(offset + limit, total)}`} of {total}</span>
        <span className="space-x-4">
          <button type="button" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}
            className="disabled:text-slate-200 text-indigo-600">Prev</button>
          <button type="button" disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}
            className="disabled:text-slate-200 text-indigo-600">Next</button>
        </span>
      </div>
    </div>
  );
};

export default CustomersTable;
