import type { Lifecycle } from '../../services/stripeMirrorClient';

/** Stripe amounts are minor units; fraction digits come from the currency itself (JPY 0, USD 2, KWD 3). */
export function formatMinor(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  try {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
    return fmt.format(amount / 10 ** fmt.resolvedOptions().maximumFractionDigits);
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`;
  }
}

export function formatPaid(paid: Record<string, number>): string {
  const parts = Object.entries(paid).filter(([, v]) => v !== 0).map(([cur, v]) => formatMinor(v, cur));
  return parts.length ? parts.join(' + ') : '—';
}

export function formatUnix(seconds: number | null): string {
  return seconds === null ? '—' : new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function formatIso(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : 'never';
}

export const LIFECYCLE_LABEL: Record<Lifecycle | 'all', string> = {
  all: 'All', current: 'Current', future: 'Future / trial', past: 'Past', none: 'No activity',
};

export const LIFECYCLE_STYLE: Record<Lifecycle, string> = {
  current: 'bg-emerald-100 text-emerald-700',
  future: 'bg-amber-100 text-amber-700',
  past: 'bg-slate-200 text-slate-600',
  none: 'bg-slate-100 text-slate-400',
};

export function formatPlan(item: { productName: string | null; nickname: string | null; unitAmount: number | null;
  currency: string | null; interval: string | null; intervalCount: number | null; quantity: number | null }): string {
  const name = item.productName || item.nickname || 'Unnamed plan';
  if (item.unitAmount === null || !item.currency) return name;
  const every = item.interval ? ` / ${item.intervalCount && item.intervalCount > 1 ? `${item.intervalCount} ` : ''}${item.interval}` : '';
  const qty = item.quantity && item.quantity > 1 ? ` × ${item.quantity}` : '';
  return `${name} — ${formatMinor(item.unitAmount, item.currency)}${every}${qty}`;
}
