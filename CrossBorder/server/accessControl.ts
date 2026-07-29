/**
 * Server: single-writer sessions + accountant invites (T-032 / T-033).
 */
import { randomUUID } from 'node:crypto';
import { getOrgData, setOrgData } from './db.js';
import {
  claimWriterSession,
  heartbeatWriterSession,
  releaseWriterSession,
  isWriterSessionActive,
  type WriterSession,
} from '../services/sessionWriter.js';
import {
  activateAccountantInvite,
  buildAccountantInviteUrl,
  createAccountantInvite,
  revokeAccountantInvite,
  validateAccountantInvite,
  type AccountantInvite,
} from '../services/accountantInvite.js';

const WRITER_KEY = 'writerSession';
const ACCOUNTANT_INVITES_KEY = 'accountantInvites';

function getWriter(orgId: string): WriterSession | null {
  const raw = getOrgData(orgId, WRITER_KEY);
  if (!raw || typeof raw !== 'object') return null;
  return raw as WriterSession;
}

function setWriter(orgId: string, writer: WriterSession | null): void {
  setOrgData(orgId, WRITER_KEY, writer);
}

function listAccountantInvites(orgId: string): AccountantInvite[] {
  const raw = getOrgData(orgId, ACCOUNTANT_INVITES_KEY);
  return Array.isArray(raw) ? (raw as AccountantInvite[]) : [];
}

function saveAccountantInvites(orgId: string, list: AccountantInvite[]): void {
  setOrgData(orgId, ACCOUNTANT_INVITES_KEY, list);
}

export function getWriterStatus(orgId: string) {
  const writer = getWriter(orgId);
  const active = isWriterSessionActive(writer);
  return {
    active,
    writer: active ? writer : null,
    singleWriterPolicy: true as const,
    message: active
      ? `Write lock held by session ${writer!.sessionId.slice(0, 8)}…`
      : 'No active writer — claim to edit',
  };
}

export function claimWriter(orgId: string, sessionId: string, label?: string) {
  const current = getWriter(orgId);
  const result = claimWriterSession(current, sessionId, { label });
  if (result.status !== 'conflict' && result.writer) {
    setWriter(orgId, result.writer);
  }
  return result;
}

export function heartbeatWriter(orgId: string, sessionId: string) {
  const current = getWriter(orgId);
  const result = heartbeatWriterSession(current, sessionId);
  if (result.writer) setWriter(orgId, result.writer);
  return result;
}

export function releaseWriter(orgId: string, sessionId: string) {
  const current = getWriter(orgId);
  const result = releaseWriterSession(current, sessionId);
  setWriter(orgId, result.writer);
  return result;
}

export function createAccountantInviteForOrg(input: {
  orgId: string;
  email: string;
  orgName?: string;
  appBase: string;
}) {
  const invite = createAccountantInvite({
    id: randomUUID(),
    token: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
    orgId: input.orgId,
    orgName: input.orgName,
    email: input.email,
  });
  const list = listAccountantInvites(input.orgId);
  saveAccountantInvites(input.orgId, [invite, ...list]);
  indexAccountantInvite(invite.token, input.orgId);
  return {
    invite,
    inviteUrl: buildAccountantInviteUrl(input.appBase, invite.token),
  };
}

export function getAccountantInviteByToken(token: string): AccountantInvite | null {
  // Scan orgs via — we store invites per org; token lookup needs a scan of known invites.
  // For MVP, store a reverse index key.
  const index = getOrgData('_system', 'accountantInviteIndex') as Record<string, string> | null;
  const orgId = index?.[token];
  if (!orgId) {
    // Fallback: not indexed yet — return null
    return null;
  }
  return listAccountantInvites(orgId).find((i) => i.token === token) ?? null;
}

export function indexAccountantInvite(token: string, orgId: string): void {
  const index = (getOrgData('_system', 'accountantInviteIndex') as Record<string, string> | null) ?? {};
  index[token] = orgId;
  setOrgData('_system', 'accountantInviteIndex', index);
}

export function openAccountantInvite(token: string) {
  const invite = getAccountantInviteByToken(token);
  const validation = validateAccountantInvite(invite);
  if (validation.ok === false) {
    if (invite && validation.status === 'expired') {
      const list = listAccountantInvites(invite.orgId).map((i) =>
        i.token === token ? { ...i, status: 'expired' as const } : i,
      );
      saveAccountantInvites(invite.orgId, list);
    }
    return validation;
  }
  const activated = activateAccountantInvite(validation.invite);
  const list = listAccountantInvites(activated.orgId).map((i) =>
    i.token === token ? activated : i,
  );
  saveAccountantInvites(activated.orgId, list);
  return { ok: true as const, invite: activated, role: 'accountant' as const };
}

export function listAccountantInvitesForOrg(orgId: string): AccountantInvite[] {
  return listAccountantInvites(orgId);
}

export function revokeAccountantInviteForOrg(orgId: string, inviteId: string) {
  const list = listAccountantInvites(orgId);
  const idx = list.findIndex((i) => i.id === inviteId);
  if (idx < 0) return { ok: false as const, error: 'Invite not found' };
  list[idx] = revokeAccountantInvite(list[idx]);
  saveAccountantInvites(orgId, list);
  return { ok: true as const, invite: list[idx] };
}

/** Resolve role from accountant token header (if valid). */
export function resolveAccountantTokenRole(token: string | undefined): {
  role: 'accountant';
  orgId: string;
  invite: AccountantInvite;
} | null {
  if (!token) return null;
  const invite = getAccountantInviteByToken(token);
  const validation = validateAccountantInvite(invite);
  if (validation.ok === false) return null;
  return { role: 'accountant', orgId: validation.invite.orgId, invite: validation.invite };
}
