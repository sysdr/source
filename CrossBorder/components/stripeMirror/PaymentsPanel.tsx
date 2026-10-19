import React, { useEffect, useState } from 'react';
import { stripeMirrorApi, type MirrorCustomer, type MirrorPayment } from '../../services/stripeMirrorClient';
import { formatMinor, formatPaid, formatUnix } from './format';

interface Props {
  orgId: string;
  customer: MirrorCustomer;
  onClose: () => void;
  onOpenProfile?: () => void;
}

interface Loaded {
  payments: MirrorPayment[];
  netPaid: Record<string, number>;
}

const STATUS_STYLE: Record<string, string> = {
  succeeded: 'text-emerald-600',
  failed: 'text-red-600',
  pending: 'text-amber-600',
};

const PaymentRow: React.FC<{ p: MirrorPayment }> = ({ p }) => (
  <tr>
    <td className="px-5 py-2.5 text-slate-500">{formatUnix(p.created)}</td>
    <td className="px-3 py-2.5 font-bold tabular-nums">
      {formatMinor(p.amount, p.currency)}
      {p.amountRefunded > 0 && (
        <span className="block text-[10px] font-medium text-red-500">
          −{formatMinor(p.amountRefunded, p.currency)} refunded
        </span>
      )}
    </td>
    <td className={`px-3 py-2.5 font-black uppercase text-[10px] ${STATUS_STYLE[p.status] ?? 'text-slate-500'}`}>
      {p.refunded ? 'refunded' : p.status}
      {p.failureMessage && <span className="block normal-case font-medium text-red-500">{p.failureMessage}</span>}
    </td>
    <td className="px-3 py-2.5 text-slate-500">
      {p.description || p.invoiceId || '—'}
      <span className="block font-mono text-[10px] text-slate-400">{p.id}{p.paymentMethodType ? ` · ${p.paymentMethodType}` : ''}</span>
    </td>
    <td className="px-5 py-2.5 text-right">
      {p.receiptUrl && (
        <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 text-[10px] font-black uppercase">Receipt</a>
      )}
    </td>
  </tr>
);

const PaymentsPanel: React.FC<Props> = ({ orgId, customer, onClose, onOpenProfile }) => {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    stripeMirrorApi.payments(orgId, customer.accountId, customer.customerId)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [orgId, customer.accountId, customer.customerId]);

  return (
    <div className="bg-white rounded-3xl border border-indigo-200 shadow-sm overflow-hidden">
      <div className="flex items-start justify-between px-5 py-4 bg-indigo-50/50">
        <div>
          <h3 className="text-sm font-black text-slate-900">{customer.name || customer.email || customer.customerId}</h3>
          <p className="text-[10px] font-mono text-slate-400">{customer.customerId} · {customer.accountId}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase text-slate-400">Net paid</p>
          <p className="text-sm font-black tabular-nums">{data ? formatPaid(data.netPaid) : '…'}</p>
        </div>
        {onOpenProfile && (
          <button type="button" onClick={onOpenProfile} className="ml-4 text-[10px] font-black uppercase text-indigo-600">
            Full profile
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close payments" className="ml-4 text-slate-400 hover:text-slate-700">✕</button>
      </div>
      {error && <p role="alert" className="p-5 text-xs text-red-600">{error}</p>}
      {!error && !data && <p className="p-5 text-xs text-slate-400">Loading payments…</p>}
      {data && data.payments.length === 0 && <p className="p-5 text-xs text-slate-400">No payments mirrored for this customer.</p>}
      {data && data.payments.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            <tr><th className="px-5 py-2">Date</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Detail</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.payments.map((p) => <PaymentRow key={p.id} p={p} />)}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default PaymentsPanel;
