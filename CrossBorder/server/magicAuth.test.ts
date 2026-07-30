/** Magic link / OTP auth unit tests */
import { describe, expect, it, beforeAll } from 'vitest';
import { upsertEmployee, setOrgData, getOrgData } from './db';
import {
  createMagicChallenge,
  resolveMagicIdentity,
  verifyMagicCode,
  verifyMagicToken,
  ADMIN_EMAILS_KEY,
  CHALLENGE_KEY,
} from './magicAuth';

const ORG = `auth-unit-${Date.now()}`;

beforeAll(() => {
  setOrgData(ORG, 'suez_smtp_settings', {
    host: 'smtp.example.com',
    port: 587,
    username: 'admin@acme.test',
    password: 'secret',
    fromEmail: 'admin@acme.test',
    fromName: 'Acme',
    enabled: true,
  });
  setOrgData(ORG, ADMIN_EMAILS_KEY, ['founder@acme.test']);
  upsertEmployee(ORG, {
    id: 'EMP-MAGIC-1',
    name: 'Ada Lovelace',
    email: 'ada@acme.test',
    designation: 'Engineer',
    ctc: 1000000,
    doj: '2025-01-01',
    status: 'Active',
    documents: { pan: true, aadhaar: true, contract: true },
  });
  setOrgData(ORG, CHALLENGE_KEY, []);
});

describe('magicAuth identity', () => {
  it('resolves SMTP from-address as admin', () => {
    const id = resolveMagicIdentity(ORG, 'admin@acme.test', 'admin');
    expect('error' in id).toBe(false);
    if ('error' in id) return;
    expect(id.role).toBe('admin');
  });

  it('resolves listed admin email', () => {
    const id = resolveMagicIdentity(ORG, 'founder@acme.test', 'admin');
    expect('error' in id).toBe(false);
    if ('error' in id) return;
    expect(id.role).toBe('admin');
  });

  it('resolves employee by directory email', () => {
    const id = resolveMagicIdentity(ORG, 'ada@acme.test', 'employee');
    expect('error' in id).toBe(false);
    if ('error' in id) return;
    expect(id.role).toBe('employee');
    expect(id.employeeId).toBe('EMP-MAGIC-1');
  });

  it('rejects unknown employee email', () => {
    const id = resolveMagicIdentity(ORG, 'nobody@acme.test', 'employee');
    expect('error' in id).toBe(true);
  });

  it('finds admin across orgs when preferred org is wrong', async () => {
    const { resolveMagicIdentityAcrossOrgs } = await import('./magicAuth');
    const id = resolveMagicIdentityAcrossOrgs('default', 'admin@acme.test', 'admin');
    expect('error' in id).toBe(false);
    if ('error' in id) return;
    expect(id.role).toBe('admin');
    expect(id.email).toBe('admin@acme.test');
    expect(id.orgId).toBeTruthy();
  });
});

describe('magicAuth challenge', () => {
  it('verifies OTP and allows short idempotent reuse', () => {
    const identity = resolveMagicIdentity(ORG, 'ada@acme.test', 'employee');
    if ('error' in identity) throw new Error(identity.error);
    const { code } = createMagicChallenge({ orgId: ORG, identity });
    const bad = verifyMagicCode(ORG, 'ada@acme.test', '000000');
    expect('error' in bad).toBe(true);
    const ok = verifyMagicCode(ORG, 'ada@acme.test', code);
    expect('error' in ok).toBe(false);
    if ('error' in ok) return;
    expect(ok.employeeId).toBe('EMP-MAGIC-1');
    // Second submit with same code still works briefly (Strict Mode / double-click)
    const reuse = verifyMagicCode(ORG, 'ada@acme.test', code);
    expect('error' in reuse).toBe(false);

    const again = createMagicChallenge({ orgId: ORG, identity });
    const viaLink = verifyMagicToken(ORG, again.token);
    expect('error' in viaLink).toBe(false);
    const reuseToken = verifyMagicToken(ORG, again.token);
    expect('error' in reuseToken).toBe(false);
  });

  it('persists challenges under org data', () => {
    const identity = resolveMagicIdentity(ORG, 'admin@acme.test', 'admin');
    if ('error' in identity) throw new Error(identity.error);
    createMagicChallenge({ orgId: ORG, identity });
    const stored = getOrgData(ORG, CHALLENGE_KEY);
    expect(Array.isArray(stored)).toBe(true);
    expect((stored as unknown[]).length).toBeGreaterThan(0);
  });
});
