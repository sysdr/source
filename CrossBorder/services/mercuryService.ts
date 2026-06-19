/**
 * Mercury Bank integration service.
 *
 * Handles API communication, local config persistence, and transaction sync
 * for Mercury bank accounts (US entity).
 */

import { getTransactions, setTransactions, StorageKeys } from './storageService';
import { Transaction } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────

const MERCURY_BASE = 'https://app.mercury.com/api/v1';
const MERCURY_CONFIG_KEY = StorageKeys.MERCURY_CONFIG;
const MERCURY_CURSORS_KEY = StorageKeys.MERCURY_CURSORS;

// ── Types ────────────────────────────────────────────────────────────────────

export interface MercuryAccount {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'treasury' | 'venture_debt';
  routingNumber: string;
  accountNumber: string;
  currentBalance: number;
  availableBalance: number;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: string;
  nickname?: string;
  legalBusinessName?: string;
  currencies: string[];
  electronicRoutingInfo?: {
    accountNumber: string;
    routingNumber: string;
    bankName?: string;
    wireRoutingNumber?: string;
  };
}

export interface MercuryTransaction {
  id: string;
  amount: number; // positive = credit (money in), negative = debit (money out)
  bankDescription: string;
  counterpartyName: string;
  counterpartyId?: string;
  note: string;
  postedDate: string; // YYYY-MM-DD
  createdAt: string;
  estimatedDeliveryDate?: string;
  failedAt?: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  kind:
    | 'externalTransfer'
    | 'internalTransfer'
    | 'outgoingDomesticWire'
    | 'outgoingInternationalWire'
    | 'creditCardCredit'
    | 'creditCardTransaction'
    | 'debitCardTransaction'
    | 'other';
  feesPaid?: number;
  externalMemo?: string;
  reasonForFailure?: string;
  details?: {
    type?: string;
    domesticWireRoutingInfo?: Record<string, string>;
    electronicRoutingInfo?: Record<string, string>;
  };
}

export interface MercurySyncResult {
  success: boolean;
  accountsSynced: number;
  transactionsAdded: number;
  error?: string;
}

export interface MercuryConfig {
  apiToken: string;
  lastSyncAt: string | null;
  accounts: Array<{ id: string; name: string; addedAt: string }>;
}

export interface MercurySyncCursors {
  [accountId: string]: string; // ISO date string of last synced transaction
}

// ── Config helpers ───────────────────────────────────────────────────────────

export function getMercuryConfig(): MercuryConfig {
  try {
    const raw = localStorage.getItem(MERCURY_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as MercuryConfig;
  } catch {
    // ignore parse errors
  }
  return { apiToken: '', lastSyncAt: null, accounts: [] };
}

export function setMercuryConfig(config: MercuryConfig): void {
  localStorage.setItem(MERCURY_CONFIG_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event('suez_data_updated'));
}

// ── Cursor helpers ───────────────────────────────────────────────────────────

export function getMercuryCursors(): MercurySyncCursors {
  try {
    const raw = localStorage.getItem(MERCURY_CURSORS_KEY);
    if (raw) return JSON.parse(raw) as MercurySyncCursors;
  } catch {
    // ignore parse errors
  }
  return {};
}

export function setMercuryCursors(cursors: MercurySyncCursors): void {
  localStorage.setItem(MERCURY_CURSORS_KEY, JSON.stringify(cursors));
}

export function clearMercuryCursors(): void {
  localStorage.removeItem(MERCURY_CURSORS_KEY);
}

// ── Auth helper ──────────────────────────────────────────────────────────────

export function buildMercuryHeaders(apiToken: string): HeadersInit {
  return {
    Authorization: 'Basic ' + btoa(apiToken + ':'),
    'Content-Type': 'application/json',
  };
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function fetchMercuryAccounts(apiToken: string): Promise<MercuryAccount[]> {
  const res = await fetch(`${MERCURY_BASE}/accounts`, {
    headers: buildMercuryHeaders(apiToken),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.message) message = body.message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const data = await res.json();
  return data.accounts as MercuryAccount[];
}

export async function fetchMercuryTransactions(
  apiToken: string,
  accountId: string,
  options?: { offset?: number; limit?: number; start?: string; end?: string },
): Promise<{ transactions: MercuryTransaction[]; total: number }> {
  const params = new URLSearchParams();
  params.set('limit', String(options?.limit ?? 500));
  if (options?.offset !== undefined) params.set('offset', String(options.offset));
  if (options?.start) params.set('start', options.start);
  if (options?.end) params.set('end', options.end);

  const url = `${MERCURY_BASE}/accounts/${accountId}/transactions?${params.toString()}`;
  const res = await fetch(url, { headers: buildMercuryHeaders(apiToken) });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.message) message = body.message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const data = await res.json();
  return {
    transactions: data.transactions as MercuryTransaction[],
    total: data.total as number,
  };
}

// ── Category derivation ──────────────────────────────────────────────────────

export function deriveMercuryCategory(tx: MercuryTransaction): string {
  if (tx.kind.includes('Wire')) return 'Wire Transfer';
  if (tx.kind === 'internalTransfer') return 'Internal Transfer';
  if (tx.kind.includes('creditCard')) return 'Credit Card';
  if (tx.kind.includes('debitCard')) return 'Debit Card';
  if (tx.amount >= 0) return 'Revenue';
  return 'Operating Expense';
}

// ── Account sync ─────────────────────────────────────────────────────────────

export async function syncMercuryAccount(
  apiToken: string,
  accountId: string,
  accountName: string,
  options?: { forceFullSync?: boolean },
): Promise<{ added: number; total: number }> {
  const cursors = getMercuryCursors();
  const cursor = cursors[accountId];

  let startDate: string | undefined;
  if (!options?.forceFullSync && cursor) {
    // Go back 1 day from cursor to handle edge cases
    const d = new Date(cursor);
    d.setDate(d.getDate() - 1);
    startDate = d.toISOString().split('T')[0];
  }

  // Paginate through all transactions
  const allMercuryTxs: MercuryTransaction[] = [];
  const limit = 500;
  let offset = 0;
  let total = 0;

  do {
    const result = await fetchMercuryTransactions(apiToken, accountId, {
      limit,
      offset,
      start: startDate,
    });
    allMercuryTxs.push(...result.transactions);
    total = result.total;
    offset += result.transactions.length;
    if (result.transactions.length < limit) break;
  } while (offset < total);

  if (allMercuryTxs.length === 0) {
    return { added: 0, total: 0 };
  }

  // Map Mercury transactions to the app's Transaction type
  const now = new Date().toISOString();
  const mapped: Transaction[] = allMercuryTxs.map((tx) => ({
    id: `mercury_${tx.id}`,
    date: tx.postedDate || tx.createdAt.split('T')[0],
    description:
      tx.counterpartyName || tx.bankDescription || tx.note || 'Mercury Transaction',
    amount: Math.abs(tx.amount),
    currency: 'USD' as const,
    source: 'Mercury' as const,
    category: deriveMercuryCategory(tx),
    status:
      tx.status === 'sent'
        ? 'Completed'
        : tx.status === 'pending'
          ? 'Pending'
          : tx.status === 'failed'
            ? 'Failed'
            : 'Completed',
    type: tx.amount >= 0 ? 'Income' : 'Expense',
    entity: 'subsidiary' as const,
    narration: [tx.bankDescription, tx.externalMemo, tx.note].filter(Boolean).join(' | '),
    lastSyncedAt: now,
  }));

  // Dedup against existing transactions
  const existing = getTransactions();
  const existingIds = new Set(existing.map((t) => t.id));
  const newTxs = mapped.filter((t) => !existingIds.has(t.id));

  if (newTxs.length > 0) {
    setTransactions([...newTxs, ...existing]);
  }

  // Update cursor to the most recent postedDate in the fetched batch
  const latestDate = allMercuryTxs
    .map((tx) => tx.postedDate || tx.createdAt.split('T')[0])
    .sort()
    .reverse()[0];

  if (latestDate) {
    const updated = { ...getMercuryCursors(), [accountId]: latestDate };
    setMercuryCursors(updated);
  }

  return { added: newTxs.length, total: allMercuryTxs.length };
}

// ── Full sync across all accounts ────────────────────────────────────────────

export async function runMercurySyncForAllAccounts(options?: {
  forceFullSync?: boolean;
  onStatus?: (msg: string) => void;
}): Promise<MercurySyncResult> {
  const config = getMercuryConfig();

  if (!config.apiToken) {
    return {
      success: false,
      accountsSynced: 0,
      transactionsAdded: 0,
      error: 'No Mercury API token configured.',
    };
  }

  if (options?.forceFullSync) {
    clearMercuryCursors();
  }

  let accountsSynced = 0;
  let transactionsAdded = 0;

  for (const account of config.accounts) {
    try {
      options?.onStatus?.(`Syncing ${account.name}…`);
      const result = await syncMercuryAccount(
        config.apiToken,
        account.id,
        account.name,
        { forceFullSync: options?.forceFullSync },
      );
      transactionsAdded += result.added;
      accountsSynced += 1;
      options?.onStatus?.(`${account.name}: +${result.added} transactions`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      options?.onStatus?.(`Error syncing ${account.name}: ${message}`);
    }
  }

  // Update lastSyncAt
  const updated: MercuryConfig = { ...config, lastSyncAt: new Date().toISOString() };
  setMercuryConfig(updated);

  return {
    success: true,
    accountsSynced,
    transactionsAdded,
  };
}
