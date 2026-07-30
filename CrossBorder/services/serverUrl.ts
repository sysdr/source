/**
 * Resolves the API base URL for browser clients.
 * Prefer VITE_SERVER_URL / VITE_API_BASE; otherwise use the page hostname
 * so LAN devices hitting http://<lan-ip>:9000 talk to http://<lan-ip>:3001.
 */
export function getServerBaseUrl(): string {
  const env = (import.meta as { env?: { VITE_SERVER_URL?: string; VITE_API_BASE?: string } }).env;
  const fromEnv = env?.VITE_SERVER_URL || env?.VITE_API_BASE;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3001`;
  }

  return 'http://localhost:3001';
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * App URL embedded in invite / magic emails.
 * Prefer VITE_APP_BASE_URL when it is a non-loopback host; otherwise the page origin.
 * If the page is localhost, the API rewrites the link to a LAN IP before sending email.
 */
export function getAppPublicBaseUrl(): string {
  const env = (import.meta as { env?: { VITE_APP_BASE_URL?: string } }).env;
  const fromEnv = env?.VITE_APP_BASE_URL?.trim().replace(/\/$/, '');
  if (fromEnv) {
    try {
      if (!isLoopbackHost(new URL(fromEnv).hostname)) return fromEnv;
    } catch { /* ignore invalid env */ }
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }

  return fromEnv || 'http://localhost:9000';
}
