import { afterEach, describe, expect, it } from 'vitest';
import type http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from './index';
import { createBackup, getBackupStatus, verifyBackup } from './backup';
import { setOrgData, upsertEmployee } from './db';

let activeServer: http.Server | null = null;

const startServer = async () => {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  activeServer = server;
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Could not resolve test server address');
  }
  return `http://127.0.0.1:${addr.port}`;
};

afterEach(async () => {
  if (!activeServer) return;
  await new Promise<void>((resolve, reject) => {
    activeServer?.close((err) => (err ? reject(err) : resolve()));
  });
  activeServer = null;
  delete process.env.SUEZ_API_KEY;
  delete process.env.CORS_ORIGINS;
  delete process.env.RATE_LIMIT_MAX;
  delete process.env.MAX_BODY_BYTES;
  delete process.env.ENFORCE_ROLE_AUTH;
  delete process.env.PII_ENCRYPTION_KEY;
  delete process.env.BACKUP_DIR;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_ORG_ID;
  delete process.env.FF_STRIPE_WEBHOOK_INGEST;
});

describe('server API', () => {
  it('returns health payload without auth', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(typeof json.ts).toBe('string');
  });

  it('returns 401 for orchestrator when auth fails', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: 'hello' }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when userMessage is missing', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'secret-key',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'userMessage required' });
  });

  it('blocks disallowed browser origins', async () => {
    process.env.CORS_ORIGINS = 'http://allowed.test';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://blocked.test' },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Origin not allowed' });
  });

  it('allows X-SUEZ-ROLE on CORS preflight', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:9000';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/session/writer/claim`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:9000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-suez-role',
      },
    });
    expect(response.status).toBe(204);
    const allow = response.headers.get('access-control-allow-headers') || '';
    expect(allow.toLowerCase()).toContain('x-suez-role');
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:9000');
  });

  it('applies orchestrator rate limit', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    process.env.RATE_LIMIT_MAX = '1';
    const baseUrl = await startServer();
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': 'secret-key',
    };

    const first = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(400);

    const second = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toEqual({ error: 'Too many requests' });
  });

  it('returns 413 for oversized payloads', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    process.env.MAX_BODY_BYTES = '10';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/orchestrator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'secret-key',
      },
      body: JSON.stringify({ userMessage: 'this request body is too large for limit' }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'Payload too large' });
  });

  it('blocks write endpoints for non-owner roles when role auth is enabled (REQ-072)', async () => {
    process.env.ENFORCE_ROLE_AUTH = 'true';
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/storage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'accountant',
      },
      body: JSON.stringify({ key: 'k', value: 1 }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Write access denied for role' });
  });

  it('enforces single-writer claim and 72h accountant invite (REQ-070 / REQ-073)', async () => {
    process.env.ENFORCE_ROLE_AUTH = 'true';
    const baseUrl = await startServer();
    const orgId = `writer-org-${Date.now()}`;

    const claimA = await fetch(`${baseUrl}/api/session/writer/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, sessionId: 'session-a', label: 'Owner A' }),
    });
    expect(claimA.status).toBe(200);

    const claimB = await fetch(`${baseUrl}/api/session/writer/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, sessionId: 'session-b', label: 'Owner B' }),
    });
    expect(claimB.status).toBe(409);
    const conflict = await claimB.json() as { status: string; warning?: string };
    expect(conflict.status).toBe('conflict');
    expect(conflict.warning).toMatch(/Concurrent/i);

    const inviteRes = await fetch(`${baseUrl}/api/accountant-invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SUEZ-ROLE': 'owner' },
      body: JSON.stringify({ orgId, email: 'ca@example.com', orgName: 'Demo Co', appBase: 'http://localhost:5173' }),
    });
    expect(inviteRes.status).toBe(200);
    const inviteJson = await inviteRes.json() as {
      ok: boolean;
      inviteUrl: string;
      invite: { token: string; expiresAt: string };
    };
    expect(inviteJson.ok).toBe(true);
    expect(inviteJson.inviteUrl).toContain('#/accountant?token=');

    const openRes = await fetch(`${baseUrl}/api/accountant-invites/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteJson.invite.token }),
    });
    expect(openRes.status).toBe(200);
    const openJson = await openRes.json() as { ok: boolean; role: string };
    expect(openJson.role).toBe('accountant');

    const blocked = await fetch(`${baseUrl}/api/storage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ACCOUNTANT-TOKEN': inviteJson.invite.token,
      },
      body: JSON.stringify({ key: 'k2', value: 2, orgId }),
    });
    expect(blocked.status).toBe(403);
  });

  it('writes audit events for successful mutations (REQ-005 / REQ-030)', async () => {
    const baseUrl = await startServer();
    const orgId = 'audit-org';
    const post = await fetch(`${baseUrl}/api/storage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'audit-key', value: { ok: true }, orgId }),
    });
    expect(post.status).toBe(200);

    const audit = await fetch(`${baseUrl}/api/audit?orgId=${orgId}`);
    expect(audit.status).toBe(200);
    const json = await audit.json() as { events: Array<{ payload: { action: string } }> };
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events.some((e) => e.payload?.action === 'storage_upsert')).toBe(true);
  });

  it('masks employee PII by default and reveals for owner opt-in (REQ-026 / REQ-027)', async () => {
    process.env.PII_ENCRYPTION_KEY = 'test-key-material';
    const baseUrl = await startServer();
    const orgId = 'pii-org';
    const employee = {
      id: 'emp-1',
      name: 'Test User',
      designation: 'Engineer',
      ctc: 1000000,
      doj: '2026-01-01',
      status: 'Active',
      email: 'test@example.com',
      documents: { pan: true, aadhaar: true, contract: false },
      panNumber: 'ABCDE1234F',
      aadhaarNumber: '123456789012',
      bankAccountNumber: '1234567890',
      bankIFSC: 'HDFC0001234',
    };
    const post = await fetch(`${baseUrl}/api/employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, employee }),
    });
    expect(post.status).toBe(200);

    const maskedRes = await fetch(`${baseUrl}/api/employees?orgId=${orgId}`);
    expect(maskedRes.status).toBe(200);
    const maskedJson = await maskedRes.json() as { employees: Array<Record<string, string>> };
    expect(maskedJson.employees[0].panNumber).not.toBe('ABCDE1234F');
    expect(maskedJson.employees[0].aadhaarNumber).not.toBe('123456789012');

    const revealRes = await fetch(`${baseUrl}/api/employees?orgId=${orgId}`, {
      headers: {
        'X-SUEZ-ROLE': 'owner',
        'X-Show-Sensitive': 'true',
      },
    });
    expect(revealRes.status).toBe(200);
    const revealJson = await revealRes.json() as { employees: Array<Record<string, string>> };
    expect(revealJson.employees[0].panNumber).toBe('ABCDE1234F');
    expect(revealJson.employees[0].aadhaarNumber).toBe('123456789012');
  });

  it('migrates legacy plaintext PII to encrypted format (REQ-026 / REQ-028)', async () => {
    // Step 1: write plaintext employee without encryption key
    delete process.env.PII_ENCRYPTION_KEY;
    const baseUrl = await startServer();
    const orgId = 'legacy-pii-org';
    const employee = {
      id: 'emp-legacy-1',
      name: 'Legacy User',
      designation: 'Analyst',
      ctc: 900000,
      doj: '2026-01-01',
      status: 'Active',
      email: 'legacy@example.com',
      documents: { pan: true, aadhaar: true, contract: false },
      panNumber: 'ABCDE1234F',
      aadhaarNumber: '123456789012',
      bankAccountNumber: '555566667777',
      bankIFSC: 'HDFC0001234',
    };
    const post = await fetch(`${baseUrl}/api/employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, employee }),
    });
    expect(post.status).toBe(200);

    // Step 2: status should report plaintext rows before migration
    process.env.SUEZ_API_KEY = 'secret-key';
    process.env.PII_ENCRYPTION_KEY = 'migration-key';
    const statusBefore = await fetch(`${baseUrl}/api/admin/pii-migration-status`, {
      headers: { 'X-API-Key': 'secret-key' },
    });
    expect(statusBefore.status).toBe(200);
    const before = await statusBefore.json() as {
      encryptionEnabled: boolean;
      employeeRowsWithPlaintext: number;
      migrationComplete: boolean;
      orgsWithPlaintext: string[];
    };
    expect(before.encryptionEnabled).toBe(true);
    expect(before.employeeRowsWithPlaintext).toBeGreaterThan(0);
    expect(before.migrationComplete).toBe(false);
    expect(before.orgsWithPlaintext).toContain(orgId);

    // Step 3: run migration
    const migrate = await fetch(`${baseUrl}/api/admin/pii-migrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'secret-key',
      },
      body: JSON.stringify({}),
    });
    expect(migrate.status).toBe(200);
    const migration = await migrate.json() as { employeeRowsUpdated: number };
    expect(migration.employeeRowsUpdated).toBeGreaterThan(0);

    // Step 4: status should show no remaining plaintext for this org
    const statusAfter = await fetch(`${baseUrl}/api/admin/pii-migration-status`, {
      headers: { 'X-API-Key': 'secret-key' },
    });
    expect(statusAfter.status).toBe(200);
    const after = await statusAfter.json() as {
      employeeRowsWithPlaintext: number;
      migrationComplete: boolean;
      orgsWithPlaintext: string[];
    };
    expect(after.orgsWithPlaintext).not.toContain(orgId);

    // Step 5: ensure value still decrypts/reveals correctly for owner
    const revealRes = await fetch(`${baseUrl}/api/employees?orgId=${orgId}`, {
      headers: {
        'X-SUEZ-ROLE': 'owner',
        'X-Show-Sensitive': 'true',
      },
    });
    expect(revealRes.status).toBe(200);
    const revealJson = await revealRes.json() as { employees: Array<Record<string, string>> };
    expect(revealJson.employees[0].panNumber).toBe('ABCDE1234F');
    expect(revealJson.employees[0].aadhaarNumber).toBe('123456789012');
  });

  it('creates and verifies SQLite backups with RPO status (REQ-032/REQ-067)', async () => {
    const backupDir = mkdtempSync(path.join(tmpdir(), 'suez-backup-'));
    process.env.BACKUP_DIR = backupDir;
    process.env.SUEZ_API_KEY = 'secret-key';
    const baseUrl = await startServer();

    const unauthorized = await fetch(`${baseUrl}/api/admin/backup`, { method: 'POST' });
    expect(unauthorized.status).toBe(401);

    const createRes = await fetch(`${baseUrl}/api/admin/backup`, {
      method: 'POST',
      headers: { 'X-API-Key': 'secret-key' },
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as {
      ok: boolean;
      backup: { fileName: string; sizeBytes: number };
    };
    expect(created.ok).toBe(true);
    expect(created.backup.fileName).toMatch(/^suez-.*\.db$/);
    expect(created.backup.sizeBytes).toBeGreaterThan(0);

    const statusRes = await fetch(`${baseUrl}/api/admin/backup/status`, {
      headers: { 'X-API-Key': 'secret-key' },
    });
    expect(statusRes.status).toBe(200);
    const status = await statusRes.json() as {
      backupCount: number;
      rpoCompliant: boolean;
      predeployFresh: boolean;
      latest: { fileName: string } | null;
    };
    expect(status.backupCount).toBeGreaterThanOrEqual(1);
    expect(status.rpoCompliant).toBe(true);
    expect(status.predeployFresh).toBe(true);
    expect(status.latest?.fileName).toBe(created.backup.fileName);

    const listRes = await fetch(`${baseUrl}/api/admin/backup`, {
      headers: { 'X-API-Key': 'secret-key' },
    });
    expect(listRes.status).toBe(200);
    const listed = await listRes.json() as { backups: Array<{ fileName: string }> };
    expect(listed.backups.some((b) => b.fileName === created.backup.fileName)).toBe(true);

    const verifyRes = await fetch(`${baseUrl}/api/admin/backup/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'secret-key',
      },
      body: JSON.stringify({}),
    });
    expect(verifyRes.status).toBe(200);
    const verified = await verifyRes.json() as {
      ok: boolean;
      checks: {
        fileExists: boolean;
        opens: boolean;
        hasKvStore: boolean;
        hasTransactions: boolean;
        hasEmployees: boolean;
      };
    };
    expect(verified.ok).toBe(true);
    expect(verified.checks.fileExists).toBe(true);
    expect(verified.checks.opens).toBe(true);
    expect(verified.checks.hasKvStore).toBe(true);
    expect(verified.checks.hasTransactions).toBe(true);
    expect(verified.checks.hasEmployees).toBe(true);

    rmSync(backupDir, { recursive: true, force: true });
  });

  it('ingests stripe webhook with idempotent event store (REQ-044)', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    const baseUrl = await startServer();
    const orgId = `stripe-webhook-org-${Date.now()}`;
    const eventId = `evt_test_${Date.now()}`;
    const chargeId = `ch_test_${Date.now()}`;
    const event = {
      id: eventId,
      type: 'charge.succeeded',
      data: {
        object: {
          id: chargeId,
          amount: 15500,
          currency: 'usd',
          created: 1760000000,
          description: 'Webhook payment',
          status: 'succeeded',
          billing_details: { address: { country: 'US' } },
        },
      },
    };

    const first = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret-key' },
      body: JSON.stringify({ orgId, event, idempotencyKey: `idem-${eventId}` }),
    });
    expect(first.status).toBe(200);
    const firstJson = await first.json() as { ok: boolean; duplicate: boolean };
    expect(firstJson.ok).toBe(true);
    expect(firstJson.duplicate).toBe(false);

    const second = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret-key' },
      body: JSON.stringify({ orgId, event, idempotencyKey: `idem-${eventId}` }),
    });
    expect(second.status).toBe(200);
    const secondJson = await second.json() as { ok: boolean; duplicate: boolean };
    expect(secondJson.ok).toBe(true);
    expect(secondJson.duplicate).toBe(true);

    const txRes = await fetch(`${baseUrl}/api/transactions?orgId=${orgId}`);
    expect(txRes.status).toBe(200);
    const txJson = await txRes.json() as { transactions: Array<Record<string, unknown>> };
    const webhookTx = txJson.transactions.find((t) => t.id === `stripe_${chargeId}`);
    expect(webhookTx).toBeTruthy();
    expect(webhookTx?.source).toBe('Stripe');
    expect(webhookTx?.amount).toBe(155);
    expect(webhookTx?.classification).toBeTruthy();
    expect(webhookTx?.customerCountry || webhookTx?.customerLocation).toBeTruthy();

    const eventsRes = await fetch(`${baseUrl}/api/stripe/events?orgId=${orgId}`, {
      headers: { 'X-API-Key': 'secret-key' },
    });
    expect(eventsRes.status).toBe(200);
    const eventsJson = await eventsRes.json() as { events: Array<{ eventId: string }> };
    expect(eventsJson.events.filter((e) => e.eventId === eventId)).toHaveLength(1);
  });

  it('normalizes refunded stripe webhook events', async () => {
    const baseUrl = await startServer();
    const stamp = Date.now();
    const orgId = `stripe-refund-org-${stamp}`;
    const event = {
      id: `evt_refund_${stamp}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_refund_${stamp}`,
          amount: 2000,
          amount_refunded: 2000,
          currency: 'usd',
          created: 1760000100,
          refunded: true,
          status: 'succeeded',
          billing_details: { address: { country: 'US' } },
        },
      },
    };
    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, event }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; ingested: boolean; transactionId?: string };
    expect(json.ok).toBe(true);
    expect(json.ingested).toBe(true);
    expect(json.transactionId).toBe(`stripe_ch_refund_${stamp}`);

    const txRes = await fetch(`${baseUrl}/api/transactions?orgId=${orgId}`);
    const txJson = await txRes.json() as { transactions: Array<Record<string, unknown>> };
    const row = txJson.transactions.find((t) => t.id === `stripe_ch_refund_${stamp}`);
    expect(row?.status).toBe('Refunded');
  });

  it('requires auth for legacy webhook when SUEZ_API_KEY is set', async () => {
    process.env.SUEZ_API_KEY = 'secret-key';
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: 'o1',
        event: { id: 'evt_unauth', type: 'charge.succeeded', data: { object: { id: 'ch_x', amount: 100, currency: 'usd', created: 1, status: 'succeeded' } } },
      }),
    });
    expect(res.status).toBe(401);
  });

  it('acks customer.subscription.updated without charge as metadata-only (REQ-078)', async () => {
    const baseUrl = await startServer();
    const stamp = Date.now();
    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: `sub-org-${stamp}`,
        event: {
          id: `evt_sub_${stamp}`,
          type: 'customer.subscription.updated',
          data: { object: { id: `sub_${stamp}`, status: 'active', metadata: { plan: 'pro' } } },
        },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; ledgerPosted?: boolean; reason?: string };
    expect(json.ok).toBe(true);
    expect(json.ledgerPosted).toBe(false);
    expect(json.reason).toBe('subscription_metadata_only');
  });

  it('verifies Stripe-Signature when STRIPE_WEBHOOK_SECRET is configured', async () => {
    const { createHmac } = await import('node:crypto');
    const secret = 'whsec_test_integration';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    process.env.STRIPE_WEBHOOK_ORG_ID = `sig-org-${Date.now()}`;
    const baseUrl = await startServer();
    const chargeId = `ch_sig_${Date.now()}`;
    const event = {
      id: `evt_sig_${Date.now()}`,
      type: 'charge.succeeded',
      data: {
        object: {
          id: chargeId,
          amount: 5000,
          currency: 'usd',
          created: 1760000200,
          status: 'succeeded',
          billing_details: { address: { country: 'US' } },
        },
      },
    };
    const rawBody = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': `t=${ts},v1=${v1}`,
      },
      body: rawBody,
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; transactionId?: string };
    expect(json.ok).toBe(true);
    expect(json.transactionId).toBe(`stripe_${chargeId}`);
  });

  it('validates and runs payroll batch with row-level failures (REQ-011 / REQ-035 / REQ-059)', async () => {
    const baseUrl = await startServer();
    const orgId = `payroll-org-${Date.now()}`;
    const good = {
      id: 'emp-good',
      name: 'Good Emp',
      designation: 'Engineer',
      ctc: 1200000,
      doj: '2025-01-01',
      status: 'Active',
      email: 'good@example.com',
      documents: { pan: true, aadhaar: true, contract: true },
      panNumber: 'ABCDE1234F',
      bankAccountNumber: '123456789012',
      bankIFSC: 'HDFC0001234',
      taxRegime: 'new' as const,
    };
    const bad = {
      ...good,
      id: 'emp-bad',
      name: 'Bad Emp',
      email: 'bad@example.com',
      panNumber: '',
      bankAccountNumber: '',
      bankIFSC: '',
      taxRegime: undefined,
    };

    const validateRes = await fetch(`${baseUrl}/api/payroll/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, employees: [good, bad] }),
    });
    expect(validateRes.status).toBe(200);
    const validation = await validateRes.json() as {
      validCount: number;
      failedCount: number;
      failures: Array<{ employeeId: string; codes: string[] }>;
    };
    expect(validation.validCount).toBe(1);
    expect(validation.failedCount).toBe(1);
    expect(validation.failures[0].employeeId).toBe('emp-bad');

    const runRes = await fetch(`${baseUrl}/api/payroll/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        month: 'January',
        year: 2026,
        employees: [good, bad],
        payrollConfig: {
          pfEnabled: true,
          esiEnabled: false,
          ptState: 'Maharashtra',
          standardWorkingDays: 22,
        },
      }),
    });
    expect(runRes.status).toBe(200);
    const runJson = await runRes.json() as {
      ok: boolean;
      run: { employeeCount: number; totalNet: number };
      outputs: { suggestedExports: Array<{ kind: string }> };
      validation: { failedCount: number };
    };
    expect(runJson.ok).toBe(true);
    expect(runJson.run.employeeCount).toBe(1);
    expect(runJson.validation.failedCount).toBe(1);
    expect(runJson.outputs.suggestedExports.length).toBeGreaterThan(0);

    const list = await fetch(`${baseUrl}/api/payroll?orgId=${orgId}`);
    const listed = await list.json() as { runs: Array<{ employeeCount: number }> };
    expect(listed.runs.some((r) => r.employeeCount === 1)).toBe(true);
  });

  it('updates employee via PUT with field validations (REQ-037)', async () => {
    const baseUrl = await startServer();
    const orgId = `emp-edit-org-${Date.now()}`;
    const empId = `EMP-EDIT-${Date.now()}`;
    const createPayload = {
      orgId,
      employee: {
        id: empId,
        name: 'Edit Me',
        designation: 'Engineer',
        ctc: 800000,
        doj: '2025-01-01',
        status: 'Onboarding',
        email: 'editme@example.com',
        documents: { pan: true, aadhaar: true, contract: true },
        panNumber: 'ABCDE1234F',
        aadhaarNumber: '123456789012',
        taxRegime: 'new',
        bankAccountNumber: '1234567890',
        bankIFSC: 'HDFC0001234',
      },
    };
    const create = await fetch(`${baseUrl}/api/employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    });
    expect(create.status).toBe(200);

    const update = await fetch(`${baseUrl}/api/employees/${empId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        employee: {
          id: empId,
          designation: 'Senior Engineer',
          ctc: 950000,
          status: 'Active',
          taxRegime: 'old',
          bankIFSC: 'SBIN0001234',
        },
      }),
    });
    expect(update.status).toBe(200);

    const bad = await fetch(`${baseUrl}/api/employees/${empId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        employee: {
          id: empId,
          panNumber: 'BADPAN',
        },
      }),
    });
    // Invalid related IDs are coerced empty so admin CTC/profile saves are not blocked
    expect(bad.status).toBe(200);
    const badBody = await bad.json() as { employee: { panNumber?: string } };
    expect(badBody.employee.panNumber === '' || !badBody.employee.panNumber).toBe(true);

    const list = await fetch(`${baseUrl}/api/employees?orgId=${orgId}`, {
      headers: { 'X-API-Key': 'secret-key' },
    });
    const listed = await list.json() as { employees: Array<Record<string, unknown>> };
    const row = listed.employees.find((e) => e.id === empId);
    expect(row?.designation).toBe('Senior Engineer');
    expect(row?.ctc).toBe(950000);
    expect(row?.taxRegime).toBe('old');
  });

  it('locks period and blocks journal posts; year-end closes P&L (REQ-015 / REQ-060)', async () => {
    const baseUrl = await startServer();
    const orgId = `period-close-org-${Date.now()}`;

    const createJe = await fetch(`${baseUrl}/api/journals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        entry: {
          date: '2025-06-15',
          description: 'Revenue',
          lines: [
            { glAccountCode: '1000', debit: 5000, credit: 0, currency: 'INR' },
            { glAccountCode: '4000', debit: 0, credit: 5000, currency: 'INR' },
          ],
        },
      }),
    });
    expect(createJe.status).toBe(200);

    const close = await fetch(`${baseUrl}/api/period-closes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, period: '2025-06', closedBy: 'test' }),
    });
    expect(close.status).toBe(200);

    const statusRes = await fetch(`${baseUrl}/api/period-closes?orgId=${orgId}&period=2025-06`);
    const statusJson = await statusRes.json() as { status: string };
    expect(statusJson.status).toBe('locked');

    const blocked = await fetch(`${baseUrl}/api/journals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        entry: {
          date: '2025-06-20',
          description: 'Should fail',
          lines: [
            { glAccountCode: '1000', debit: 100, credit: 0 },
            { glAccountCode: '4000', debit: 0, credit: 100 },
          ],
        },
      }),
    });
    expect(blocked.status).toBe(422);

    // Separate org for year-end (June already locked above)
    const yeOrg = `year-end-org-${Date.now()}`;
    await fetch(`${baseUrl}/api/journals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: yeOrg,
        entry: {
          date: '2025-03-01',
          description: 'Income',
          lines: [
            { glAccountCode: '1000', debit: 10000, credit: 0 },
            { glAccountCode: '4000', debit: 0, credit: 10000 },
          ],
        },
      }),
    });
    await fetch(`${baseUrl}/api/journals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: yeOrg,
        entry: {
          date: '2025-09-01',
          description: 'Expense',
          lines: [
            { glAccountCode: '6200', debit: 2500, credit: 0 },
            { glAccountCode: '1000', debit: 0, credit: 2500 },
          ],
        },
      }),
    });

    const ye = await fetch(`${baseUrl}/api/period-closes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: yeOrg,
        yearEnd: true,
        yearEndYear: 2025,
        closedBy: 'test',
      }),
    });
    expect(ye.status).toBe(200);
    const yeJson = await ye.json() as {
      ok: boolean;
      retainedEarningsAmount: number;
      closingEntry: { period: string; status: string };
      lockedPeriods: unknown[];
    };
    expect(yeJson.ok).toBe(true);
    expect(yeJson.retainedEarningsAmount).toBe(7500);
    expect(yeJson.closingEntry.period).toBe('2025-12');
    expect(yeJson.lockedPeriods.length).toBe(12);

    const blockedDec = await fetch(`${baseUrl}/api/journals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: yeOrg,
        entry: {
          date: '2025-12-31',
          description: 'After lock',
          lines: [
            { glAccountCode: '1000', debit: 10, credit: 0 },
            { glAccountCode: '4000', debit: 0, credit: 10 },
          ],
        },
      }),
    });
    expect(blockedDec.status).toBe(422);
  });

  it('imports Indian bank CSV, matches ledger, persists unmatched (REQ-079)', async () => {
    const baseUrl = await startServer();
    const orgId = `bank-csv-org-${Date.now()}`;

    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        transaction: {
          id: `tx-match-${Date.now()}`,
          date: '2026-04-01',
          description: 'Known credit',
          amount: 12000,
          currency: 'INR',
          source: 'Manual',
          category: 'Revenue',
          status: 'Completed',
          type: 'Income',
        },
      }),
    });

    const csv = [
      'Date,Description,Debit,Credit,Balance',
      '2026-04-01,NEFT KNOWN CREDIT,,12000,12000',
      '2026-04-02,UPI UNKNOWN SPEND,800,,11200',
    ].join('\n');

    const res = await fetch(`${baseUrl}/api/bank-statements/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, csv }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      matchedCount: number;
      unmatchedCount: number;
      suggestedTransactions: unknown[];
    };
    expect(json.matchedCount).toBe(1);
    expect(json.unmatchedCount).toBe(1);

    const txRes = await fetch(`${baseUrl}/api/transactions?orgId=${orgId}`);
    const txJson = await txRes.json() as { transactions: Array<{ source?: string; amount?: number }> };
    expect(txJson.transactions.some((t) => t.source === 'IndianBank' && t.amount === 800)).toBe(true);
  });

  it('posts fixed-asset depreciation and exports Tally vouchers (REQ-063 / REQ-081)', async () => {
    const baseUrl = await startServer();
    const orgId = `assets-tally-org-${Date.now()}`;

    const assetRes = await fetch(`${baseUrl}/api/fixed-assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        asset: {
          id: 'fa-1',
          name: 'MacBook',
          category: 'Computer',
          purchaseDate: '2025-01-01',
          cost: 120000,
          depreciationRate: 40,
          accumulated: 0,
          method: 'WDV',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      }),
    });
    expect(assetRes.status).toBe(200);

    const depRes = await fetch(`${baseUrl}/api/fixed-assets/depreciate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, period: '2025-12', periodFraction: 1 }),
    });
    expect(depRes.status).toBe(200);
    const depJson = await depRes.json() as {
      ok: boolean;
      journal: { lines: Array<{ debit: number; credit: number }> };
      assets: Array<{ accumulated: number }>;
    };
    expect(depJson.ok).toBe(true);
    expect(depJson.assets[0].accumulated).toBe(48000);
    expect(depJson.journal.lines[0].debit).toBe(48000);

    const tallyRes = await fetch(`${baseUrl}/api/exports/tally?orgId=${orgId}&period=2025-12`);
    expect(tallyRes.status).toBe(200);
    const tally = await tallyRes.json() as {
      vouchersCsv: string;
      trialBalanceCsv: string;
      voucherRowCount: number;
    };
    expect(tally.voucherRowCount).toBeGreaterThan(0);
    expect(tally.vouchersCsv).toContain('Voucher Type');
    expect(tally.vouchersCsv).toContain('Depreciation');
    expect(tally.trialBalanceCsv).toContain('Ledger Name');
  });

  it('returns three-way reconciliation workbench panes (REQ-058)', async () => {
    const baseUrl = await startServer();
    const orgId = `recon-wb-org-${Date.now()}`;

    await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        transactions: [
          {
            id: `stripe-${Date.now()}`,
            date: '2026-05-01',
            description: 'Stripe charge',
            amount: 2000,
            currency: 'INR',
            source: 'Stripe',
            category: 'Revenue',
            status: 'Completed',
            type: 'Income',
          },
          {
            id: `mercury-${Date.now()}`,
            date: '2026-05-02',
            description: 'Mercury credit',
            amount: 2000,
            currency: 'INR',
            source: 'Mercury',
            category: 'Revenue',
            status: 'Completed',
            type: 'Income',
          },
          {
            id: `purchase-${Date.now()}`,
            date: '2026-05-03',
            description: 'Laptop',
            amount: 10000,
            currency: 'INR',
            source: 'Manual',
            category: 'Equipment',
            status: 'Completed',
            type: 'Purchase',
            gstRate: 18,
            gstImpact: 1800,
            itcEligible: true,
          },
        ],
      }),
    });

    const res = await fetch(`${baseUrl}/api/reconciliation/workbench?orgId=${orgId}`);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean;
      threeWay: {
        stripeMercury: { matched: number };
        gstr2bPurchases: { unmatched: number };
      };
    };
    expect(json.ok).toBe(true);
    expect(json.threeWay.stripeMercury.matched).toBe(1);
    expect(json.threeWay.gstr2bPurchases.unmatched).toBe(1);
  });

  it('derives compliance status with readiness blockers (REQ-002 / REQ-036 / REQ-041)', async () => {
    const baseUrl = await startServer();
    const orgId = `compliance-org-${Date.now()}`;
    await fetch(`${baseUrl}/api/org/${orgId}/filingTasks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: [{
          id: 'filing-gstr1-old',
          type: 'GSTR-1',
          period: '2025-01',
          dueDate: '2025-02-11',
          status: 'Pending',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        }],
      }),
    });

    const res = await fetch(`${baseUrl}/api/compliance/status?orgId=${orgId}`);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean;
      summary: { overdue: number; blocked: number };
      items: Array<{ derivedStatus: string; readiness: string }>;
    };
    expect(json.ok).toBe(true);
    expect(json.summary.overdue).toBe(1);
    expect(json.items[0].derivedStatus).toBe('Overdue');
    expect(json.items[0].readiness).toBe('blocked');
  });

  it('acknowledges filings and tracks FIRC/ODI (REQ-080 / REQ-018 / T-030 / T-031)', async () => {
    const baseUrl = await startServer();
    const orgId = `fema-org-${Date.now()}`;

    await fetch(`${baseUrl}/api/org/${orgId}/filingTasks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: [{
          id: 'filing-gstr3b',
          type: 'GSTR-3B',
          period: '2026-01',
          dueDate: '2026-02-20',
          status: 'Pending',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      }),
    });

    const denyRes = await fetch(`${baseUrl}/api/filings/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, taskId: 'filing-gstr3b', filedDate: '2026-02-18' }),
    });
    expect(denyRes.status).toBe(400);

    const ackRes = await fetch(`${baseUrl}/api/filings/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        taskId: 'filing-gstr3b',
        acknowledgementNumber: 'AA270226999999Z',
        filedDate: '2026-02-18',
        evidenceLinks: ['https://example.com/gstr3b-ack.pdf'],
      }),
    });
    expect(ackRes.status).toBe(200);
    const ackJson = await ackRes.json() as { ok: boolean; task: { status: string; acknowledgementNumber: string } };
    expect(ackJson.ok).toBe(true);
    expect(ackJson.task.status).toBe('Filed');
    expect(ackJson.task.acknowledgementNumber).toBe('AA270226999999Z');

    await fetch(`${baseUrl}/api/org/${orgId}/remittanceRecords`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: [{
          id: 'rem-1',
          direction: 'Inward',
          date: '2026-03-01',
          amount: 5000,
          currency: 'USD',
          purpose: 'Export',
          fircStatus: 'Pending',
          createdAt: '2026-03-01T00:00:00.000Z',
        }],
      }),
    });

    await fetch(`${baseUrl}/api/fema/odi-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        uin: 'UIN998877',
        nextAprDueDate: '2025-12-31',
      }),
    });

    const trackRes = await fetch(`${baseUrl}/api/fema/tracking?orgId=${orgId}`);
    expect(trackRes.status).toBe(200);
    const trackJson = await trackRes.json() as {
      ok: boolean;
      firc: { summary: { pendingFirc: number; inwardTotal: number } };
      odi: { aprStatus: string; uinConfigured: boolean };
    };
    expect(trackJson.ok).toBe(true);
    expect(trackJson.firc.summary.inwardTotal).toBe(1);
    expect(trackJson.firc.summary.pendingFirc).toBe(1);
    expect(trackJson.odi.uinConfigured).toBe(true);
    expect(trackJson.odi.aprStatus).toBe('overdue');
  });

  it('computes vendor TDS and ESI via rules API (REQ-012 / REQ-062)', async () => {
    const baseUrl = await startServer();

    const sectionsRes = await fetch(`${baseUrl}/api/tds/sections`);
    expect(sectionsRes.status).toBe(200);
    const sectionsJson = await sectionsRes.json() as { sections: Array<{ section: string }> };
    expect(sectionsJson.sections.some((s) => s.section === '194C')).toBe(true);

    const tdsRes = await fetch(`${baseUrl}/api/tds/compute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 100000,
        section: '194C',
        payeeType: 'individual',
        payeeName: 'Contractor',
      }),
    });
    expect(tdsRes.status).toBe(200);
    const tds = await tdsRes.json() as { ok: boolean; tdsAmount: number; rate: number; netPayable: number };
    expect(tds.ok).toBe(true);
    expect(tds.rate).toBe(1);
    expect(tds.tdsAmount).toBe(1000);
    expect(tds.netPayable).toBe(99000);

    const esiRes = await fetch(`${baseUrl}/api/esi/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyGross: 20000, esiEnabled: true }),
    });
    expect(esiRes.status).toBe(200);
    const esi = await esiRes.json() as {
      ok: boolean;
      eligible: boolean;
      employeeContribution: number;
      employerContribution: number;
    };
    expect(esi.ok).toBe(true);
    expect(esi.eligible).toBe(true);
    expect(esi.employeeContribution).toBe(150);
    expect(esi.employerContribution).toBe(650);
  });

  it('auto-applies vendor TDS on transaction POST when tdsApplicable', async () => {
    const baseUrl = await startServer();
    const orgId = `tds-tx-org-${Date.now()}`;
    const tx = {
      id: `tx-tds-${Date.now()}`,
      date: '2026-07-01',
      description: 'Contractor payment',
      amount: 50000,
      currency: 'INR',
      source: 'Manual',
      category: 'Professional Fees',
      status: 'Completed',
      type: 'Expense',
      tdsApplicable: true,
      tdsSection: '194J',
    };

    const postRes = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, transaction: tx, payeeType: 'company' }),
    });
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json() as {
      ok: boolean;
      transaction: { tdsRate?: number; tdsAmount?: number };
    };
    expect(postJson.ok).toBe(true);
    expect(postJson.transaction.tdsRate).toBe(10);
    expect(postJson.transaction.tdsAmount).toBe(5000);
  });
});

describe('backup helpers', () => {
  it('createBackup + verifyBackup round-trip against live DB', () => {
    const backupDir = mkdtempSync(path.join(tmpdir(), 'suez-backup-unit-'));
    const created = createBackup(undefined, backupDir);
    expect(created.ok).toBe(true);
    expect(created.backup.sizeBytes).toBeGreaterThan(0);

    const status = getBackupStatus(undefined, backupDir);
    expect(status.rpoCompliant).toBe(true);
    expect(status.backupCount).toBe(1);

    const verified = verifyBackup(created.backup.path, backupDir);
    expect(verified.ok).toBe(true);
    expect(verified.checks.opens).toBe(true);

    rmSync(backupDir, { recursive: true, force: true });
  });

  it('records SLO samples and serves /api/slo/metrics (REQ-066 / T-036)', async () => {
    const baseUrl = await startServer();
    await fetch(`${baseUrl}/api/health`);
    await fetch(`${baseUrl}/api/transactions?orgId=default`);
    await new Promise((r) => setTimeout(r, 25));
    const res = await fetch(`${baseUrl}/api/slo/metrics`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      summaries: Array<{ operation: string; count: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.summaries.some((s) => s.count > 0)).toBe(true);
  });

  it('dry-runs filing reminder notifications (REQ-051 / T-039)', async () => {
    const baseUrl = await startServer();
    const orgId = `org-remind-${Date.now()}`;
    await fetch(`${baseUrl}/api/org/${orgId}/filingTasks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: [{
          id: 'filing-overdue',
          type: 'GSTR-1',
          period: '2026-01',
          dueDate: '2026-01-11',
          status: 'Pending',
          createdAt: '',
          updatedAt: '',
        }],
      }),
    });
    const res = await fetch(`${baseUrl}/api/notifications/filing-reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        dryRun: true,
        asOfDate: '2026-07-28',
        orgName: 'Demo Org',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      dryRun: boolean;
      candidates: Array<{ urgency: string }>;
      email: { subject: string };
    };
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.email.subject).toMatch(/overdue|reminder/i);
  });
});

describe('magic link / OTP auth API', () => {
  it('requests and verifies a sign-in code without SMTP (dev code)', async () => {
    process.env.NODE_ENV = 'test';
    const orgId = `magic-api-${Date.now()}`;
    setOrgData(orgId, 'suez_smtp_settings', {
      host: 'smtp.example.com',
      port: 587,
      username: 'ops@acme.test',
      password: 'x',
      fromEmail: 'ops@acme.test',
      fromName: 'Ops',
      enabled: true,
    });
    upsertEmployee(orgId, {
      id: 'E-1',
      name: 'Sam',
      email: 'sam@acme.test',
      status: 'Active',
    });

    const baseUrl = await startServer();
    const reqRes = await fetch(`${baseUrl}/api/auth/magic/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        email: 'sam@acme.test',
        role: 'employee',
        appBaseUrl: 'http://localhost:9000',
      }),
    });
    expect(reqRes.status).toBe(200);
    const reqBody = await reqRes.json() as { ok: boolean; devCode?: string; emailSent?: boolean };
    expect(reqBody.ok).toBe(true);
    expect(reqBody.devCode).toMatch(/^\d{6}$/);

    const verifyRes = await fetch(`${baseUrl}/api/auth/magic/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        email: 'sam@acme.test',
        code: reqBody.devCode,
      }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json() as {
      ok: boolean;
      session: { role: string; employeeId?: string };
    };
    expect(verifyBody.ok).toBe(true);
    expect(verifyBody.session.role).toBe('employee');
    expect(verifyBody.session.employeeId).toBe('E-1');
  });

  it('allows employee role header to call public magic routes', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENFORCE_ROLE_AUTH = '1';
    const orgId = `magic-pub-${Date.now()}`;
    setOrgData(orgId, 'suez_smtp_settings', {
      host: 'smtp.example.com',
      port: 587,
      username: 'ops@acme.test',
      password: 'x',
      fromEmail: 'ops@acme.test',
      fromName: 'Ops',
      enabled: true,
    });
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/api/auth/magic/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'employee',
      },
      body: JSON.stringify({ orgId, email: 'ops@acme.test', role: 'admin' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; role?: string };
    expect(body.ok).toBe(true);
    expect(body.role).toBe('admin');
  });

  it('allows employee self-service profile update for own record only', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENFORCE_ROLE_AUTH = '1';
    const orgId = `self-upd-${Date.now()}`;
    upsertEmployee(orgId, {
      id: 'E-SELF',
      name: 'Self User',
      designation: 'Analyst',
      ctc: 800000,
      doj: '2023-06-01',
      status: 'Active',
      email: 'self@acme.test',
      documents: { pan: false, aadhaar: false, contract: true },
      phone: '1111111111',
    });
    upsertEmployee(orgId, {
      id: 'E-OTHER',
      name: 'Other User',
      designation: 'Analyst',
      ctc: 800000,
      doj: '2023-06-01',
      status: 'Active',
      email: 'other@acme.test',
      documents: { pan: false, aadhaar: false, contract: true },
    });
    const baseUrl = await startServer();

    const denied = await fetch(`${baseUrl}/api/employees/self`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'employee',
        'X-SUEZ-EMPLOYEE-ID': 'E-SELF',
      },
      body: JSON.stringify({
        orgId,
        employeeId: 'E-OTHER',
        patch: { phone: '999' },
      }),
    });
    expect(denied.status).toBe(403);

    const blockedAdminPath = await fetch(`${baseUrl}/api/employees/E-SELF`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'employee',
        'X-SUEZ-EMPLOYEE-ID': 'E-SELF',
      },
      body: JSON.stringify({
        orgId,
        employee: { phone: '2222222222', ctc: 1 },
      }),
    });
    expect(blockedAdminPath.status).toBe(403);

    const ok = await fetch(`${baseUrl}/api/employees/self`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'employee',
        'X-SUEZ-EMPLOYEE-ID': 'E-SELF',
      },
      body: JSON.stringify({
        orgId,
        employeeId: 'E-SELF',
        patch: {
          phone: '9999999999',
          bankIFSC: 'HDFC0001111',
          ctc: 1,
          status: 'Exited',
        },
      }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json() as {
      ok: boolean;
      employee: { phone?: string; bankIFSC?: string; ctc: number; status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.employee.phone).toBe('9999999999');
    expect(body.employee.bankIFSC).toBe('HDFC0001111');
    expect(body.employee.ctc).toBe(800000);
    expect(body.employee.status).toBe('Active');
  });
});

describe('lightweight DAST / RBAC probes (RW-010 / RW-P-003)', () => {
  it('denies employee write to admin employee upsert', async () => {
    process.env.ENFORCE_ROLE_AUTH = '1';
    const orgId = `dast-emp-${Date.now()}`;
    upsertEmployee(orgId, {
      id: 'E-DAST',
      name: 'Dast User',
      designation: 'Analyst',
      ctc: 500000,
      doj: '2024-01-01',
      status: 'Active',
      email: 'dast@acme.test',
      documents: { pan: false, aadhaar: false, contract: true },
    });
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/api/employees`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'employee',
        'X-SUEZ-EMPLOYEE-ID': 'E-DAST',
      },
      body: JSON.stringify({
        orgId,
        employee: {
          id: 'E-HACK',
          name: 'Hacker',
          designation: 'X',
          ctc: 1,
          doj: '2024-01-01',
          status: 'Active',
          email: 'h@x.test',
          documents: { pan: false, aadhaar: false, contract: false },
        },
      }),
    });
    expect(res.status).toBe(403);
  });

  it('denies accountant write to org_data', async () => {
    process.env.ENFORCE_ROLE_AUTH = '1';
    const orgId = `dast-ca-${Date.now()}`;
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/api/org/${encodeURIComponent(orgId)}/suez_company_profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'accountant',
      },
      body: JSON.stringify({ value: { projectName: 'tamper' } }),
    });
    expect(res.status).toBe(403);
  });

  it('allows employee leave create for self and rejects other employeeId', async () => {
    process.env.ENFORCE_ROLE_AUTH = '1';
    const orgId = `dast-leave-${Date.now()}`;
    const baseUrl = await startServer();

    const denied = await fetch(`${baseUrl}/api/leave-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'employee',
        'X-SUEZ-EMPLOYEE-ID': 'E-1',
      },
      body: JSON.stringify({
        orgId,
        request: {
          id: 'LR-bad',
          employeeId: 'E-2',
          type: 'CL',
          fromDate: '2026-08-01',
          toDate: '2026-08-02',
          days: 2,
          reason: 'x',
          status: 'Pending',
          appliedAt: new Date().toISOString(),
        },
      }),
    });
    expect(denied.status).toBe(403);

    const ok = await fetch(`${baseUrl}/api/leave-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SUEZ-ROLE': 'employee',
        'X-SUEZ-EMPLOYEE-ID': 'E-1',
      },
      body: JSON.stringify({
        orgId,
        request: {
          id: 'LR-ok',
          employeeId: 'E-1',
          type: 'CL',
          fromDate: '2026-08-01',
          toDate: '2026-08-01',
          days: 1,
          reason: 'Personal',
          status: 'Approved',
          appliedAt: new Date().toISOString(),
        },
      }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json() as { ok: boolean; request: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.request.status).toBe('Pending');
  });

  it('emits baseline security headers on health', async () => {
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy') || '').toContain("default-src 'none'");
  });

  it('rejects oversized JSON bodies (DoS probe)', async () => {
    process.env.MAX_BODY_BYTES = '256';
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/api/storage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SUEZ-ROLE': 'owner' },
      body: JSON.stringify({ key: 'x', value: 'y'.repeat(400) }),
    });
    expect([413, 400]).toContain(res.status);
  });

  it('blocks path-traversal style org keys from leaking across tenants', async () => {
    process.env.ENFORCE_ROLE_AUTH = '1';
    const victim = `dast-victim-${Date.now()}`;
    const attacker = `dast-attacker-${Date.now()}`;
    setOrgData(victim, 'suez_secret', { secret: 'victim-only' });
    const baseUrl = await startServer();
    const probe = await fetch(
      `${baseUrl}/api/org/${encodeURIComponent('../' + victim)}/suez_secret`,
      { headers: { 'X-SUEZ-ROLE': 'employee', 'X-SUEZ-EMPLOYEE-ID': 'E-x' } },
    );
    // Must not return the victim secret; 404/403/400 are all acceptable.
    expect(probe.status).not.toBe(200);
    const direct = await fetch(`${baseUrl}/api/org/${encodeURIComponent(attacker)}/suez_secret`, {
      headers: { 'X-SUEZ-ROLE': 'employee', 'X-SUEZ-EMPLOYEE-ID': 'E-x' },
    });
    if (direct.status === 200) {
      const body = await direct.json();
      expect(JSON.stringify(body)).not.toContain('victim-only');
    }
  });

  it('requires API key for admin backup when configured', async () => {
    process.env.SUEZ_API_KEY = 'dast-backup-key';
    const baseUrl = await startServer();
    const denied = await fetch(`${baseUrl}/api/admin/backup/status`);
    expect(denied.status).toBe(401);
    const ok = await fetch(`${baseUrl}/api/admin/backup/status`, {
      headers: { 'X-API-Key': 'dast-backup-key' },
    });
    expect(ok.status).toBe(200);
  });
});
