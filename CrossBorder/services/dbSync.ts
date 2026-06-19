/**
 * Client-side API wrapper for the SQLite-backed storage endpoints.
 *
 * - hydrateFromDB()   – load all persisted keys into localStorage on startup
 * - dbSet()           – fire-and-forget write to the database
 * - dbDelete()        – fire-and-forget delete from the database
 * - dbClear()         – delete all keys (used on full app reset)
 */

const DB_API_BASE = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL
  ?? 'http://localhost:3001';

/**
 * Fetch all key-value pairs from the database and populate localStorage.
 * Called once on app startup before the React tree mounts.
 * Silently no-ops if the server is unavailable (falls back to existing localStorage).
 */
export async function hydrateFromDB(): Promise<void> {
  try {
    const res = await fetch(`${DB_API_BASE}/api/storage`, { method: 'GET' });
    if (!res.ok) return;
    const data = await res.json() as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      // Only hydrate if the key isn't already present (localStorage wins for
      // any data that was written after the last DB sync — unlikely, but safe).
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
  } catch {
    // Server not running — fine, the app still works via localStorage alone
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
