/**
 * Resolve a shareable app base URL for email invites / magic links.
 * Prefer non-loopback hosts so recipients on other devices can open the link.
 */

import os from 'node:os';

const DEFAULT_FRONTEND_PORT = 9000;

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function frontendPortFromEnv(): number {
  const raw = process.env.APP_FRONTEND_PORT || process.env.FRONTEND_PORT || '';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FRONTEND_PORT;
}

/** Prefer common LAN ranges over link-local / odd adapters. */
function scoreLanAddress(address: string): number {
  if (address.startsWith('192.168.')) return 30;
  if (address.startsWith('10.')) return 20;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 15;
  if (address.startsWith('169.254.')) return 1;
  return 5;
}

export function getPreferredLanIpv4(): string | null {
  const candidates: { address: string; score: number }[] = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      const family = String(net.family);
      if ((family !== 'IPv4' && family !== '4') || net.internal) continue;
      candidates.push({ address: net.address, score: scoreLanAddress(net.address) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? null;
}

function originFromUrl(u: URL): string {
  return u.origin.replace(/\/$/, '');
}

function nonLoopbackOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const u = tryParseUrl(raw.trim());
  if (!u || isLoopbackHost(u.hostname)) return null;
  return originFromUrl(u);
}

function portFromCandidate(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const u = tryParseUrl(raw.trim());
  if (!u) return fallback;
  if (u.port) return Number(u.port);
  return u.protocol === 'https:' ? 443 : 80;
}

/**
 * Pick the best public app base for outbound email links.
 * Order: non-loopback candidate → APP_BASE_URL (non-loopback) → LAN IP + frontend port → candidate/env/localhost.
 */
export function resolvePublicAppBaseUrl(candidate?: string): string {
  const envBase = (process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  const fromCandidate = nonLoopbackOrigin(candidate);
  if (fromCandidate) return fromCandidate;

  const fromEnv = nonLoopbackOrigin(envBase);
  if (fromEnv) return fromEnv;

  const lan = getPreferredLanIpv4();
  const port = portFromCandidate(candidate, portFromCandidate(envBase, frontendPortFromEnv()));
  if (lan) {
    if (port === 80) return `http://${lan}`;
    if (port === 443) return `https://${lan}`;
    return `http://${lan}:${port}`;
  }

  if (candidate?.trim()) return candidate.trim().replace(/\/$/, '');
  if (envBase) return envBase;
  return `http://localhost:${frontendPortFromEnv()}`;
}
