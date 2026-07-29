/**
 * Accountant invite tokens — 72-hour read-only access (REQ-073 / T-033).
 */
export const ACCOUNTANT_INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export type AccountantInviteStatus = 'pending' | 'active' | 'expired' | 'revoked';

export interface AccountantInvite {
  id: string;
  token: string;
  orgId: string;
  orgName?: string;
  email: string;
  status: AccountantInviteStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export function createAccountantInvite(input: {
  id: string;
  token: string;
  orgId: string;
  orgName?: string;
  email: string;
  nowMs?: number;
  ttlMs?: number;
}): AccountantInvite {
  const nowMs = input.nowMs ?? Date.now();
  const ttl = input.ttlMs ?? ACCOUNTANT_INVITE_TTL_MS;
  return {
    id: input.id,
    token: input.token,
    orgId: input.orgId,
    orgName: input.orgName,
    email: input.email.trim().toLowerCase(),
    status: 'pending',
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttl).toISOString(),
  };
}

export function validateAccountantInvite(
  invite: AccountantInvite | null | undefined,
  nowMs = Date.now(),
): { ok: true; invite: AccountantInvite } | { ok: false; error: string; status?: AccountantInviteStatus } {
  if (!invite) return { ok: false, error: 'Invite not found' };
  if (invite.status === 'revoked') return { ok: false, error: 'Invite was revoked', status: 'revoked' };
  if (new Date(invite.expiresAt).getTime() < nowMs) {
    return { ok: false, error: 'Invite has expired (72-hour window)', status: 'expired' };
  }
  return { ok: true, invite };
}

export function activateAccountantInvite(
  invite: AccountantInvite,
  nowMs = Date.now(),
): AccountantInvite {
  return {
    ...invite,
    status: 'active',
    acceptedAt: new Date(nowMs).toISOString(),
  };
}

export function revokeAccountantInvite(
  invite: AccountantInvite,
  nowMs = Date.now(),
): AccountantInvite {
  return {
    ...invite,
    status: 'revoked',
    revokedAt: new Date(nowMs).toISOString(),
  };
}

export function buildAccountantInviteUrl(appBase: string, token: string): string {
  const base = appBase.replace(/\/$/, '');
  return `${base}/#/accountant?token=${encodeURIComponent(token)}`;
}
