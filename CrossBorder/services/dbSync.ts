/**
 * Client-side API wrapper for the SQLite-backed storage endpoints.
 *
 * - hydrateFromDB()   – load persisted keys into localStorage on startup
 * - dbSet()           – fire-and-forget write to the database
 * - dbDelete()        – fire-and-forget delete from the database
 * - dbClear()         – delete all keys (used on full app reset)
 */

const DB_API_BASE = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL
  ?? 'http://localhost:3001';

const HYDRATED_FLAG = 'suez_db_hydrated_at';

const CORE_KEYS = new Set([
  'suez_organisations',
  'suez_employees',
  'suez_transactions',
  'suez_payroll_runs',
  'suez_invoices',
  'suez_company_profile',
  'suez_active_org_id',
  'suez_onboarded',
  'suez_smtp_settings',
  'suez_revenue_data',
  'suez_stripe_org_config',
  'suez_stripe_sync_schedule',
  'suez_stripe_sync_cursors',
  'suez_transfer_pricing',
  'suez_tax_engine',
  'suez_platform_rules',
  'suez_employee_invites',
  'suez_vault',
  'invoice_company_profiles',
  'invoice_client_profiles',
  'invoice_active_company',
]);

function remoteTxnCount(storage: Record<string, unknown>): number {
  const orgs = storage.suez_organisations as
    | { activeOrgId?: string; organisations?: Record<string, { transactions?: unknown[] }> }
    | undefined;
  const flat = storage.suez_transactions;
  if (Array.isArray(flat) && flat.length > 0) return flat.length;
  if (!orgs?.organisations) return 0;
  const active = orgs.activeOrgId && orgs.organisations[orgs.activeOrgId]
    ? orgs.organisations[orgs.activeOrgId]
    : Object.values(orgs.organisations)[0];
  return Array.isArray(active?.transactions) ? active.transactions.length : 0;
}

function localTxnCount(): number {
  try {
    const raw = localStorage.getItem('suez_organisations');
    if (!raw) return 0;
    const orgs = JSON.parse(raw) as {
      activeOrgId?: string;
      organisations?: Record<string, { transactions?: unknown[] }>;
    };
    const active = orgs.activeOrgId && orgs.organisations?.[orgs.activeOrgId]
      ? orgs.organisations[orgs.activeOrgId]
      : Object.values(orgs.organisations || {})[0];
    return Array.isArray(active?.transactions) ? active.transactions.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch storage from the API (rebuilds KV from domain tables server-side)
 * and populate localStorage so clones get the committed SQLite dataset.
 */
export async function hydrateFromDB(): Promise<boolean> {
  try {
    const res = await fetch(`${DB_API_BASE}/api/storage`, { method: 'GET' });
    if (!res.ok) return false;
    const data = await res.json() as Record<string, unknown>;
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return false;

    const remoteTx = remoteTxnCount(data);
    const localTx = localTxnCount();
    const neverHydrated = localStorage.getItem(HYDRATED_FLAG) === null;
    const noLocalOrg = localStorage.getItem('suez_organisations') === null;
    const forceCore = neverHydrated || noLocalOrg || remoteTx > localTx;

    for (const [key, value] of Object.entries(data)) {
      const missing = localStorage.getItem(key) === null;
      if (missing || (forceCore && CORE_KEYS.has(key))) {
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
    localStorage.setItem(HYDRATED_FLAG, new Date().toISOString());
    return true;
  } catch {
    // Server not running — fine, the app still works via localStorage alone
    return false;
  }
}

/**
 * Persist a key-value pair to the database (fire-and-forget).
 * Failures are silently swallowed; the source of truth remains localStorage.
 */
export function dbSet(key: string, value: unknown): void {
  fetch(`${DB_API_BASE}/api/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => {/* server unavailable — skip */});
}

/**
 * Remove a key from the database (fire-and-forget).
 */
export function dbDelete(key: string): void {
  fetch(`${DB_API_BASE}/api/storage/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  }).catch(() => {/* server unavailable — skip */});
}

/**
 * Clear all keys from the database (used on full app reset).
 */
export function dbClear(): void {
  fetch(`${DB_API_BASE}/api/storage`, { method: 'DELETE' })
    .catch(() => {/* server unavailable — skip */});
}
