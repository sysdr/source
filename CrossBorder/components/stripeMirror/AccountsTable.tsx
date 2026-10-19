import React from 'react';
import type { MirrorAccount } from '../../services/stripeMirrorClient';
import { formatIso } from './format';

interface Props {
  accounts: MirrorAccount[];
  activeFilter: string;
  syncing: boolean;
  isOwner: boolean;
  onFilter: (accountId: string) => void;
  onSync: (accountId: string) => void;
}

const STATUS_STYLE: Record<MirrorAccount['lastStatus'], string> = {
  ok: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  never: 'bg-slate-100 text-slate-500',
};

const AccountsTable: React.FC<Props> = ({ accounts, activeFilter, syncing, isOwner, onFilter, onSync }) => (
  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
    <table className="w-full text-left text-xs">
      <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
        <tr>
          <th className="px-5 py-3">Account</th>
          <th className="px-3 py-3 text-right">Customers</th>
          <th className="px-3 py-3 text-right">Subscriptions</th>
          <th className="px-3 py-3 text-right">Payments</th>
          <th className="px-3 py-3">Last sync</th>
          <th className="px-3 py-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {accounts.map((a) => (
          <tr key={a.accountId} className={activeFilter === a.accountId ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}>
            <td className="px-5 py-3">
              <button type="button" onClick={() => onFilter(activeFilter === a.accountId ? '' : a.accountId)}
                className="text-left" title="Filter customers by this account">
                <span className="block font-bold text-slate-800">{a.name}</span>
                <span className="block font-mono text-[10px] text-slate-400">
                  {a.accountId}{a.kind === 'connect_child' ? ` · child of ${a.parentAccountId}` : ''}
                </span>
              </button>
            </td>
            <td className="px-3 py-3 text-right tabular-nums">{a.counts.customers}</td>
            <td className="px-3 py-3 text-right tabular-nums">{a.counts.subscriptions + a.counts.schedules}</td>
            <td className="px-3 py-3 text-right tabular-nums">{a.counts.charges}</td>
            <td className="px-3 py-3">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${STATUS_STYLE[a.lastStatus]}`}>
                {a.lastStatus}
              </span>
              <span className="ml-2 text-slate-400">{formatIso(a.lastSyncedAt)}</span>
              {a.lastError && <span className="block text-[10px] text-red-600 mt-1">{a.lastError}</span>}
            </td>
            <td className="px-3 py-3 text-right">
              {isOwner && (
                <button type="button" disabled={syncing} onClick={() => onSync(a.accountId)}
                  className="text-[10px] font-black uppercase text-indigo-600 disabled:text-slate-300">
                  Sync
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default AccountsTable;
