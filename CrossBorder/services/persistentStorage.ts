/**
 * Persistent Storage Module
 *
 * Stores every configuration, every data fetch, and every calculated value.
 * Writes to storage only when the value has changed from the main source (change detection).
 * Uses a stable hash of the payload to avoid redundant writes and events.
 */

const HASHES_KEY = 'suez_ps_hashes';

/** Stable stringify for objects (sorted keys) so hash is deterministic */
function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** Simple numeric hash from string (djb2-style), then base36 for short key */
function hashString(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

export function hashValue(value: unknown): string {
  return hashString(stableStringify(value));
}

function getHashes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(HASHES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function setHashes(hashes: Record<string, string>): void {
  try {
    localStorage.setItem(HASHES_KEY, JSON.stringify(hashes));
  } catch (e) {
    console.error('persistentStorage: failed to save hashes', e);
  }
}

export type StorageNamespace = 'config' | 'fetch' | 'calculated';

export interface PersistentStorageOptions {
  /** Skip change detection and always write */
  force?: boolean;
  /** Optional namespace for grouping (config, fetch, calculated) */
  namespace?: StorageNamespace;
}

/**
 * Persist a value only if it has changed from what is currently stored.
 * Returns true if the value was written, false if it was unchanged (no write).
 * On QuotaExceededError, frees heavy ledger/FX keys and retries once.
 */
export function setIfChanged<T>(
  key: string,
  value: T,
  options: PersistentStorageOptions = {}
): boolean {
  const { force = false } = options;
  const newHash = hashValue(value);

  if (!force) {
    const hashes = getHashes();
    if (hashes[key] === newHash) return false;
  }

  const write = (): void => {
    localStorage.setItem(key, JSON.stringify(value));
    const hashes = getHashes();
    hashes[key] = newHash;
    setHashes(hashes);
  };

  try {
    write();
    return true;
  } catch (e) {
    if (!isQuotaExceeded(e)) {
      console.error(`persistentStorage: failed to write ${key}`, e);
      return false;
    }
    console.warn(`persistentStorage: quota exceeded writing ${key}; freeing space and retrying`);
    freeLocalStoragePressure(key);
    try {
      write();
      return true;
    } catch (e2) {
      console.error(`persistentStorage: failed to write ${key} after quota recovery`, e2);
      return false;
    }
  }
}

function isQuotaExceeded(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: string; code?: number };
  return err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014;
}

/** Drop FX caches and strip embedded ledgers from organisations so config writes can succeed. */
export function freeLocalStoragePressure(preferKeep?: string): void {
  const removeKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === preferKeep) continue;
      if (k.startsWith('suez_fx_') || k.startsWith('suez_calc_')) removeKeys.push(k);
    }
    for (const k of removeKeys) localStorage.removeItem(k);

    // Ledger arrays live in SQLite — do not keep multi‑MB copies in localStorage.
    for (const heavy of ['suez_transactions', 'suez_revenue_data']) {
      if (heavy === preferKeep) continue;
      localStorage.removeItem(heavy);
    }

    const orgRaw = localStorage.getItem('suez_organisations');
    if (orgRaw && preferKeep !== 'suez_organisations') {
      try {
        const state = JSON.parse(orgRaw) as {
          activeOrgId?: string | null;
          organisations?: Record<string, Record<string, unknown>>;
        };
        if (state.organisations) {
          for (const org of Object.values(state.organisations)) {
            org.transactions = [];
            const rev = org.revenueData as { transactions?: unknown[] } | undefined;
            if (rev && typeof rev === 'object') rev.transactions = [];
          }
          localStorage.setItem('suez_organisations', JSON.stringify(state));
        }
      } catch {
        /* leave as-is */
      }
    }
  } catch (e) {
    console.error('persistentStorage: freeLocalStoragePressure failed', e);
  }
}

/**
 * Read a value from persistent storage. Returns null if missing or invalid.
 */
export function get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Remove a key from persistent storage and from the hash index.
 */
export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
    const hashes = getHashes();
    delete hashes[key];
    setHashes(hashes);
  } catch (e) {
    console.error(`persistentStorage: failed to remove ${key}`, e);
  }
}

/** Clear the hash index (e.g. after app-wide storage clear). */
export function clearHashes(): void {
  try {
    localStorage.removeItem(HASHES_KEY);
  } catch (e) {
    console.error('persistentStorage: failed to clear hashes', e);
  }
}

/**
 * Check whether the stored value for a key is different from the given value (without writing).
 */
export function hasChanged(key: string, value: unknown): boolean {
  const hashes = getHashes();
  const newHash = hashValue(value);
  return hashes[key] !== newHash;
}

// --- Keys for fetched and calculated data (namespaced) ---

export const PersistentKeys = {
  /** FX rate cache: key = suez_fx_{date}_{from}_{to} */
  fxRate: (date: string, from: string, to: string) =>
    `suez_fx_${date}_${from.toUpperCase()}_${to.toUpperCase()}`,
  /** Today's USD→INR rate (from API or manual) */
  todayUsdInr: 'suez_fx_today_usd_inr',
  /** Investor pitch computed metrics per org: suez_calc_investor_metrics_{orgId} */
  investorMetrics: (orgId: string) => `suez_calc_investor_metrics_${orgId}`,
} as const;
