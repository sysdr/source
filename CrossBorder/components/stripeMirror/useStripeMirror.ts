import { useCallback, useEffect, useRef, useState } from 'react';
import {
  stripeMirrorApi,
  type CustomerPage, type LifecycleFilter, type MirrorAccount, type MirrorRun,
} from '../../services/stripeMirrorClient';

export const PAGE_SIZE = 50;
const POLL_MS = 3000;
const SEARCH_DEBOUNCE_MS = 250;

export interface MirrorFilters {
  account: string;
  lifecycle: LifecycleFilter;
  q: string;
  offset: number;
}

export const INITIAL_FILTERS: MirrorFilters = { account: '', lifecycle: 'all', q: '', offset: 0 };

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function useStripeMirror(orgId: string) {
  const [accounts, setAccounts] = useState<MirrorAccount[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<MirrorRun | null>(null);
  const [page, setPage] = useState<CustomerPage | null>(null);
  const [filters, setFilters] = useState<MirrorFilters>(INITIAL_FILTERS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const debounced = useDebounced(filters, SEARCH_DEBOUNCE_MS);

  const fail = useCallback((e: unknown) => setError((e as Error).message), []);

  const loadAccounts = useCallback(() => stripeMirrorApi.accounts(orgId).then(setAccounts).catch(fail), [orgId, fail]);
  const loadRuns = useCallback(() => stripeMirrorApi.runs(orgId).then((r) => {
    setRunning(r.running);
    setLastRun(r.runs[0] ?? null);
  }).catch(fail), [orgId, fail]);
  const loadCustomers = useCallback(() => {
    setLoading(true);
    return stripeMirrorApi.customers({
      orgId, account: debounced.account, lifecycle: debounced.lifecycle, q: debounced.q,
      limit: PAGE_SIZE, offset: debounced.offset,
    }).then((p) => { setPage(p); setError(null); }).catch(fail).finally(() => setLoading(false));
  }, [orgId, debounced, fail]);

  useEffect(() => { void loadAccounts(); void loadRuns(); }, [loadAccounts, loadRuns]);
  useEffect(() => { void loadCustomers(); }, [loadCustomers]);

  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => { void loadRuns(); }, POLL_MS);
    return () => clearInterval(t);
  }, [running, loadRuns]);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void loadAccounts();
      void loadCustomers();
    }
    wasRunning.current = running;
  }, [running, loadAccounts, loadCustomers]);

  const act = useCallback(async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try { setNotice(await work()); } catch (e) { fail(e); } finally { setBusy(false); }
  }, [fail]);

  const discover = useCallback(() => act(async () => {
    const r = await stripeMirrorApi.discover(orgId);
    await loadAccounts();
    return `Discovered ${r.discovered} accounts (${r.added} newly added).`;
  }), [act, orgId, loadAccounts]);

  const sync = useCallback((accountIds?: string[]) => act(async () => {
    await stripeMirrorApi.sync(orgId, accountIds);
    setRunning(true);
    return `Sync started for ${accountIds ? accountIds.length : 'all'} account(s).`;
  }), [act, orgId]);

  const updateFilters = useCallback((patch: Partial<MirrorFilters>) => {
    setFilters((f) => ({ ...f, offset: 0, ...patch }));
  }, []);

  return { accounts, running, lastRun, page, filters, loading, busy, error, notice, discover, sync, updateFilters };
}
