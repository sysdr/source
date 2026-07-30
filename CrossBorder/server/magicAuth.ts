/**
 * Magic-link + OTP login challenges (email via org SMTP).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { getEmployees, getOrgData, setOrgData, getAllOrgIds } from './db';

const CHALLENGE_KEY = 'suez_magic_logins';
const SMTP_ORG_KEY = 'suez_smtp_settings';
const ADMIN_EMAILS_KEY = 'suez_admin_emails';
const TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type MagicRole = 'admin' | 'employee';

export interface MagicChallenge {
  id: string;
  email: string;
  orgId: string;
  role: MagicRole;
  employeeId?: string;
  displayName: string;
  codeHash: string;
  tokenHash: string;
  /** Raw token only kept until send — never persisted after create returns. */
  expiresAt: string;
  createdAt: string;
  attempts: number;
  consumedAt?: string;
}

export interface MagicIdentity {
  role: MagicRole;
  email: string;
  orgId: string;
  displayName: string;
  employeeId?: string;
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Strip accidental JSON quotes around org ids (e.g. `"org-123"`). */
export function normalizeOrgId(orgId: string): string {
  const trimmed = orgId.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadChallenges(orgId: string): MagicChallenge[] {
  const raw = getOrgData(orgId, CHALLENGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw as MagicChallenge[];
}

function saveChallenges(orgId: string, list: MagicChallenge[]): void {
  const pruned = list
    .filter((c) => !c.consumedAt || Date.now() - Date.parse(c.consumedAt) < 24 * 60 * 60 * 1000)
    .slice(-50);
  setOrgData(orgId, CHALLENGE_KEY, pruned);
}

function collectAdminEmails(orgId: string): Set<string> {
  const adminEmails = new Set<string>();
  const adminListRaw = getOrgData(orgId, ADMIN_EMAILS_KEY);
  if (Array.isArray(adminListRaw)) {
    for (const item of adminListRaw) {
      if (typeof item === 'string' && isEmailLike(item)) adminEmails.add(normalizeEmail(item));
    }
  }
  const smtpRaw = getOrgData(orgId, SMTP_ORG_KEY);
  if (smtpRaw && typeof smtpRaw === 'object') {
    const s = smtpRaw as Record<string, unknown>;
    for (const key of ['fromEmail', 'username', 'replyTo'] as const) {
      const v = s[key];
      if (typeof v === 'string' && isEmailLike(v)) adminEmails.add(normalizeEmail(v));
    }
  }
  return adminEmails;
}

function adminHint(orgId: string): string {
  const allowed = [...collectAdminEmails(orgId)];
  if (allowed.length === 0) {
    return 'Configure SMTP From email in Admin Panel, then sign in with that address.';
  }
  return `Sign in with an admin address for this org (e.g. ${allowed[0]}).`;
}

function listCandidateOrgIds(preferredOrgId: string): string[] {
  const preferred = normalizeOrgId(preferredOrgId);
  const all = getAllOrgIds().map(normalizeOrgId);
  const withData = all
    .filter((id) => {
      // Skip ephemeral test / pipeline orgs
      if (/^(magic-api-|magic-pub-|assets-|bank-|compliance-|test-org)/.test(id)) return false;
      if (id === '_system') return false;
      return getOrgData(id, SMTP_ORG_KEY) != null || getEmployees(id).length > 0;
    })
    .map((id) => ({
      id,
      score: getEmployees(id).length * 10 + (getOrgData(id, SMTP_ORG_KEY) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
  const ordered = [preferred, ...withData.filter((id) => id !== preferred)];
  return [...new Set(ordered.filter(Boolean))];
}

export function resolveMagicIdentity(
  orgId: string,
  emailRaw: string,
  preferredRole?: MagicRole | 'auto',
): MagicIdentity | { error: string } {
  const email = normalizeEmail(emailRaw);
  if (!isEmailLike(email)) return { error: 'Enter a valid email address.' };
  const resolvedOrgId = normalizeOrgId(orgId);

  const employees = getEmployees(resolvedOrgId) as Array<Record<string, unknown>>;
  const employee = employees.find((e) => normalizeEmail(String(e.email || '')) === email);

  const adminEmails = collectAdminEmails(resolvedOrgId);
  const isAdmin = adminEmails.has(email);

  const prefer = preferredRole || 'auto';

  if (prefer === 'employee') {
    if (!employee) return { error: 'No employee profile matches this email in the active organisation.' };
    return {
      role: 'employee',
      email,
      orgId: resolvedOrgId,
      displayName: String(employee.name || email),
      employeeId: String(employee.id),
    };
  }

  if (prefer === 'admin') {
    if (!isAdmin) {
      return { error: `This email is not authorised as admin. ${adminHint(resolvedOrgId)}` };
    }
    return { role: 'admin', email, orgId: resolvedOrgId, displayName: 'Admin' };
  }

  // auto
  if (employee && !isAdmin) {
    return {
      role: 'employee',
      email,
      orgId: resolvedOrgId,
      displayName: String(employee.name || email),
      employeeId: String(employee.id),
    };
  }
  if (isAdmin && !employee) {
    return { role: 'admin', email, orgId: resolvedOrgId, displayName: 'Admin' };
  }
  if (isAdmin && employee) {
    return {
      role: 'employee',
      email,
      orgId: resolvedOrgId,
      displayName: String(employee.name || email),
      employeeId: String(employee.id),
    };
  }
  return { error: 'No admin or employee account found for this email in the active organisation.' };
}

/**
 * Resolve identity in the preferred org, then fall back to other orgs that
 * match the email (fixes wrong/default orgId on the landing page).
 */
export function resolveMagicIdentityAcrossOrgs(
  preferredOrgId: string,
  emailRaw: string,
  preferredRole?: MagicRole | 'auto',
): MagicIdentity | { error: string } {
  const email = normalizeEmail(emailRaw);
  if (!isEmailLike(email)) return { error: 'Enter a valid email address.' };

  const prefer = preferredRole || 'auto';
  const candidates = listCandidateOrgIds(preferredOrgId || 'default');
  let lastError = 'No matching account found for this email.';

  for (const orgId of candidates) {
    const result = resolveMagicIdentity(orgId, email, prefer);
    if (!('error' in result)) return result;
    lastError = result.error;
    if (
      result.error.includes('not authorised')
      || result.error.includes('No employee profile')
      || result.error.includes('No admin or employee')
    ) {
      continue;
    }
    return result;
  }

  if (prefer === 'admin') {
    const smtpOrgs = candidates.filter((id) => collectAdminEmails(id).size > 0);
    if (smtpOrgs.length > 0) {
      return { error: `This email is not authorised as admin. ${adminHint(smtpOrgs[0])}` };
    }
  }

  return { error: lastError };
}

export function createMagicChallenge(opts: {
  orgId: string;
  identity: MagicIdentity;
}): { challenge: MagicChallenge; code: string; token: string } {
  const code = String(randomInt(100000, 999999));
  const token = randomBytes(24).toString('hex');
  const now = new Date();
  const challenge: MagicChallenge = {
    id: randomBytes(8).toString('hex'),
    email: opts.identity.email,
    orgId: opts.orgId,
    role: opts.identity.role,
    employeeId: opts.identity.employeeId,
    displayName: opts.identity.displayName,
    codeHash: hashSecret(code),
    tokenHash: hashSecret(token),
    expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    createdAt: now.toISOString(),
    attempts: 0,
  };
  const list = loadChallenges(opts.orgId).filter((c) => c.email !== opts.identity.email || c.consumedAt);
  list.push(challenge);
  saveChallenges(opts.orgId, list);
  return { challenge, code, token };
}

function findActiveChallenge(
  orgId: string,
  predicate: (c: MagicChallenge) => boolean,
): MagicChallenge | null {
  const now = Date.now();
  return (
    loadChallenges(orgId).find(
      (c) => !c.consumedAt && Date.parse(c.expiresAt) > now && predicate(c),
    ) || null
  );
}

function listOrgsForMagicVerify(preferredOrgId: string): string[] {
  const preferred = normalizeOrgId(preferredOrgId || 'default');
  const base = listCandidateOrgIds(preferred);
  const withChallenges = getAllOrgIds()
    .map(normalizeOrgId)
    .filter((id) => {
      const raw = getOrgData(id, CHALLENGE_KEY);
      return Array.isArray(raw) && raw.length > 0;
    });
  return [...new Set([preferred, ...base, ...withChallenges].filter(Boolean))];
}

function normalizeOtpCode(code: string): string {
  return code.replace(/\D/g, '').slice(0, 8);
}

function identityFromChallenge(challenge: MagicChallenge): MagicIdentity {
  return {
    role: challenge.role,
    email: challenge.email,
    orgId: challenge.orgId,
    displayName: challenge.displayName,
    employeeId: challenge.employeeId,
  };
}

/**
 * Verify OTP — searches preferred org first, then every candidate org.
 * Avoids "Invalid code" when the challenge was stored under a different org id
 * than the browser's active organisation.
 */
export function verifyMagicCode(orgId: string, emailRaw: string, code: string): MagicIdentity | { error: string } {
  const email = normalizeEmail(emailRaw);
  const digits = normalizeOtpCode(code);
  if (digits.length < 4) return { error: 'Enter the 6-digit code from your email.' };
  const codeHash = hashSecret(digits);
  const preferred = normalizeOrgId(orgId);
  const candidates = listOrgsForMagicVerify(preferred);

  // 1) Exact match (active or recently consumed) anywhere
  for (const candidate of candidates) {
    const list = loadChallenges(candidate);
    const matchIdx = list.findIndex(
      (c) =>
        c.email === email
        && c.codeHash === codeHash
        && Date.parse(c.expiresAt) > Date.now()
        && (!c.consumedAt || Date.now() - Date.parse(c.consumedAt) < 120_000),
    );
    if (matchIdx < 0) continue;
    const challenge = list[matchIdx];
    if (!challenge.consumedAt) {
      challenge.consumedAt = new Date().toISOString();
      saveChallenges(candidate, list);
    }
    return identityFromChallenge(challenge);
  }

  // 2) Active challenge for this email exists but code is wrong — bump attempts on newest
  let sawActive = false;
  for (const candidate of candidates) {
    const list = loadChallenges(candidate);
    const actives = list
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c.email === email && !c.consumedAt && Date.parse(c.expiresAt) > Date.now())
      .sort((a, b) => Date.parse(b.c.createdAt) - Date.parse(a.c.createdAt));
    if (actives.length === 0) continue;
    sawActive = true;
    const newest = actives[0];
    newest.c.attempts += 1;
    saveChallenges(candidate, list);
    if (newest.c.attempts >= MAX_ATTEMPTS) {
      return { error: 'Too many attempts. Request a new code.' };
    }
    return { error: 'Invalid code.' };
  }

  if (sawActive) return { error: 'Invalid code.' };
  return { error: 'No active login code. Request a new one.' };
}

export function verifyMagicToken(orgId: string, token: string): MagicIdentity | { error: string } {
  const resolvedOrgId = normalizeOrgId(orgId || 'default');
  const rawToken = token.trim();
  if (!rawToken) return { error: 'Missing magic link token.' };
  const tokenHash = hashSecret(rawToken);
  const candidates = listOrgsForMagicVerify(resolvedOrgId);

  for (const candidate of candidates) {
    const list = loadChallenges(candidate);
    const matchIdx = list.findIndex(
      (c) =>
        c.tokenHash === tokenHash
        && Date.parse(c.expiresAt) > Date.now()
        && (!c.consumedAt || Date.now() - Date.parse(c.consumedAt) < 120_000),
    );
    if (matchIdx < 0) continue;
    const challenge = list[matchIdx];
    if (!challenge.consumedAt) {
      challenge.consumedAt = new Date().toISOString();
      saveChallenges(candidate, list);
    }
    return identityFromChallenge(challenge);
  }

  return { error: 'Invalid or expired magic link.' };
}

/** Scan challenges across known orgs by checking provided orgId first (MVP). */
export function verifyMagicTokenInOrg(orgId: string, token: string): MagicIdentity | { error: string } {
  return verifyMagicToken(orgId, token);
}

export function buildMagicLoginEmail(params: {
  orgName: string;
  displayName: string;
  code: string;
  magicUrl: string;
  role: MagicRole;
  expiresAt: string;
}): { subject: string; text: string; html: string } {
  const subject = `Your CrossBorder sign-in code: ${params.code}`;
  const roleLabel = params.role === 'admin' ? 'Admin' : 'Employee';
  const text = `Hi ${params.displayName},

Your ${roleLabel} sign-in code for ${params.orgName} is:

${params.code}

Or open this magic link (expires ${new Date(params.expiresAt).toLocaleString()}):
${params.magicUrl}

If you did not request this, ignore this email.
`;
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;line-height:1.5;">
  <p>Hi ${escapeHtml(params.displayName)},</p>
  <p>Your <strong>${roleLabel}</strong> sign-in code for <strong>${escapeHtml(params.orgName)}</strong>:</p>
  <p style="font-size:28px;font-weight:800;letter-spacing:0.2em;margin:20px 0;">${escapeHtml(params.code)}</p>
  <p style="margin:24px 0;">
    <a href="${escapeAttr(params.magicUrl)}"
       style="background:#059669;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
      Sign in with magic link
    </a>
  </p>
  <p style="font-size:12px;color:#94a3b8;">Expires ${escapeHtml(new Date(params.expiresAt).toLocaleString())}.</p>
</body>
</html>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export { SMTP_ORG_KEY, ADMIN_EMAILS_KEY, CHALLENGE_KEY, findActiveChallenge, collectAdminEmails };
