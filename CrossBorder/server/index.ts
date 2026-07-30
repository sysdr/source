/**
 * Minimal backend API for Project Suez.
 * - POST /api/orchestrator: run agentic workflow (body: { userMessage, sessionId?, recentTurns? }).
 *   Auth: X-API-Key or Authorization: Bearer must match process.env.SUEZ_API_KEY.
 * - GET /api/health: no auth.
 * Env: SUEZ_API_KEY (required for /api/orchestrator), API_KEY (Gemini).
 * Node: localStorage is polyfilled so storage calls don't throw (empty state when run standalone).
 */

const noop = () => {};
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
    length: 0,
    clear: noop,
    key: () => null,
  };
}
if (typeof globalThis.sessionStorage === 'undefined') {
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
    length: 0,
    clear: noop,
    key: () => null,
  };
}

import './loadEnv.js';
import http from 'node:http';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  getAllKV, setKV, deleteKV, clearKV,
  queryTransactions, getTransactionCount, upsertTransaction, bulkUpsertTransactions, deleteTransaction,
  getEmployees, upsertEmployee, bulkUpsertEmployees, deleteEmployee,
  getPayrollRuns, upsertPayrollRun, deletePayrollRun,
  getInvoicesDB, upsertInvoice, deleteInvoice,
  getOrgData, setOrgData, getAllOrgData,
  insertReport, listReports, getReport, deleteReport,
  insertInput, listInputs, getInput, deleteInput,
  insertProcessed, listProcessed, getProcessed, deleteProcessed,
  upsertInvite, getInviteByToken, listInvites, updateInviteStatus, deleteInvite,
  insertStripeEventIfNew, listStripeEvents,
  getAllOrgIds,
  checkpointDatabase,
} from './db.js';
import {
  TransactionSchema, TransactionUpdateSchema,
  EmployeeSchema, EmployeeUpdateSchema,
  PayrollRunSchema, InvoiceSchema,
  validate, validateArray,
} from './schemas.js';
import { reconcileOrg } from './reconciliation.js';
import { buildThreeWayReconciliation, type Gstr2bClaim } from '../services/threeWayReconciliation.js';
import { syncStripeToSqlite, type StripeOrgConfigInput } from './stripeSqliteSync.js';
import { buildInviteEmail, normalizeSmtpConfig, sendMail, verifySmtp } from './mail.js';
import {
  buildMagicLoginEmail,
  createMagicChallenge,
  resolveMagicIdentityAcrossOrgs,
  verifyMagicCode,
  verifyMagicToken,
  type MagicRole,
} from './magicAuth.js';
import { rebuildKvFromDomain } from './rebuildKv.js';
import { resolvePublicAppBaseUrl } from './appBaseUrl.js';
import {
  decryptString,
  decryptEmployeePII,
  decryptOrgProfilePII,
  encryptString,
  encryptEmployeePII,
  encryptOrgProfilePII,
  maskEmployeePII,
  countPlaintextEmployeePiiFields,
  countPlaintextProfilePiiFields,
  encryptionEnabled,
} from './pii.js';
import {
  createBackup,
  getBackupStatus,
  listBackups,
  verifyBackup,
} from './backup.js';
import { normalizeStripeObject } from './normalizeTransaction.js';
import { runPayrollBatch, validatePayrollEmployees } from './payrollBatch.js';
import {
  VENDOR_TDS_SECTIONS,
  applyVendorTdsToTransaction,
  computeVendorTds,
  evaluateEsi,
  type PayeeType,
} from '../services/tdsRules.js';
import {
  closeAccountingPeriod,
  createAndOptionallyPostJournal,
  listJournals,
  listPeriodCloses,
  periodStatus,
  postJournal,
  runYearEndCloseForOrg,
  trialBalanceForOrg,
} from './periodClose.js';
import {
  exportTallyCsv,
  importBankStatementCsv,
  listFixedAssets,
  runDepreciationPosting,
  upsertFixedAsset,
} from './accountingExtras.js';
import { getComplianceStatusForOrg } from './complianceStatus.js';
import {
  acknowledgeFilingForOrg,
  applyFircMatchForOrg,
  getFemaTrackingForOrg,
  getOdiProfile,
  setOdiProfile,
} from './femaTracking.js';
import {
  claimWriter,
  createAccountantInviteForOrg,
  getWriterStatus,
  heartbeatWriter,
  listAccountantInvitesForOrg,
  openAccountantInvite,
  releaseWriter,
  resolveAccountantTokenRole,
  revokeAccountantInviteForOrg,
} from './accessControl.js';
import { classifyHttpPath, recordSloSample, summarizeSlo } from '../services/sloMetrics.js';
import { buildFilingReminderEmail, selectFilingReminders } from '../services/filingReminders.js';
import type { CompanyProfile, Employee, FilingTask, OdiProfile, PayrollConfig } from '../types.js';

const SMTP_ORG_KEY = 'suez_smtp_settings';

type StripeWebhookEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

const PORT = Number(process.env.PORT) || 3001;
/** Bind all interfaces so LAN Wi‑Fi clients can reach the API. Override with HOST=127.0.0.1 to lock local-only. */
const HOST = process.env.HOST || '0.0.0.0';
const getSuezApiKey = () => process.env.SUEZ_API_KEY || '';
const getMaxBodyBytes = () => Number(process.env.MAX_BODY_BYTES) || 10_000_000; // 10 MB — large org/revenue payloads can exceed 2 MB
const getRateLimitWindowMs = () => Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const getRateLimitMax = () => Number(process.env.RATE_LIMIT_MAX) || 60;
const getCorsOrigins = () => (process.env.CORS_ORIGINS || 'http://localhost:9000,http://127.0.0.1:9000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
/** Allow browser origins from private LAN IPs (default on). Set CORS_ALLOW_LAN=false to disable. */
const corsAllowLan = () => process.env.CORS_ALLOW_LAN !== 'false';
const rateWindowByIp = new Map<string, number[]>();
type RequestRole = 'owner' | 'accountant' | 'employee';

const getRoleAuthEnabled = () => process.env.ENFORCE_ROLE_AUTH === 'true';

function getRequestRole(req: http.IncomingMessage): RequestRole {
  const tokenHeader = req.headers['x-suez-accountant-token'];
  const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : '';
  if (token && resolveAccountantTokenRole(token)) return 'accountant';

  const raw = req.headers['x-suez-role'];
  const role = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (role === 'accountant' || role === 'employee') return role;
  return 'owner';
}

function isWriteMethod(method: string | undefined): boolean {
  return method === 'POST' || method === 'PUT' || method === 'DELETE';
}

function isPublicWriteRoute(url: string): boolean {
  return (
    /^\/api\/invites\/token\/[^/]+\/complete$/.test(url)
    || url === '/api/accountant-invites/open'
    || url === '/api/session/writer/claim'
    || url === '/api/session/writer/heartbeat'
    || url === '/api/session/writer/release'
    || url === '/api/auth/magic/request'
    || url === '/api/auth/magic/verify'
  );
}

function canWrite(req: http.IncomingMessage, url: string): boolean {
  if (!isWriteMethod(req.method)) return true;
  if (isPublicWriteRoute(url)) return true;
  // Employee self-service profile updates (allowlisted fields only — enforced in handler)
  if (url === '/api/employees/self' && getRequestRole(req) === 'employee') return true;
  // Leave requests: employees may create/update their own (enforced in handler)
  if ((url === '/api/leave-requests' || /^\/api\/leave-requests\//.test(url))
    && getRequestRole(req) === 'employee') return true;
  const role = getRequestRole(req);
  // Accountant / employee are always read-only (REQ-072 / REQ-073)
  if (role === 'accountant' || role === 'employee') return false;
  if (!getRoleAuthEnabled()) return true;
  return role === 'owner';
}

function shouldRevealSensitive(req: http.IncomingMessage): boolean {
  const flag = req.headers['x-show-sensitive'];
  const requested = typeof flag === 'string' && flag.toLowerCase() === 'true';
  return requested && getRequestRole(req) === 'owner';
}

function resolveOrgId(url: string, reqUrl: string, body?: Record<string, unknown>): string {
  const qs = Object.fromEntries(new URL(reqUrl || '/', 'http://localhost').searchParams);
  if (typeof body?.orgId === 'string' && body.orgId) return body.orgId;
  if (typeof qs.orgId === 'string' && qs.orgId) return qs.orgId;
  const orgMatch = url.match(/^\/api\/org\/([^/]+)/);
  if (orgMatch) return decodeURIComponent(orgMatch[1]);
  return 'default';
}

function writeAuditEvent(opts: {
  req: http.IncomingMessage;
  url: string;
  method: string;
  orgId: string;
  action: string;
  result: 'success' | 'denied' | 'error';
  details?: Record<string, unknown>;
}) {
  try {
    insertProcessed(opts.orgId, {
      pipeline: 'audit_events',
      label: `${opts.method} ${opts.url}`,
      payload: {
        at: new Date().toISOString(),
        role: getRequestRole(opts.req),
        method: opts.method,
        path: opts.url,
        action: opts.action,
        result: opts.result,
        ip: getClientIp(opts.req),
        details: opts.details ?? {},
      },
    });
  } catch (err) {
    console.warn('[audit] failed to write audit event:', (err as Error).message);
  }
}

function maybeEncryptOrgData(key: string, value: unknown): unknown {
  if (key === 'suez_company_profile') return encryptOrgProfilePII(value);
  if (key === 'suez_smtp_settings' && value && typeof value === 'object') {
    const payload = value as Record<string, unknown>;
    if (typeof payload.password === 'string') {
      return { ...payload, password: encryptString(payload.password) };
    }
  }
  return value;
}

function maybeDecryptOrgData(key: string, value: unknown): unknown {
  if (key === 'suez_company_profile') return decryptOrgProfilePII(value);
  if (key === 'suez_smtp_settings' && value && typeof value === 'object') {
    const payload = value as Record<string, unknown>;
    if (typeof payload.password === 'string') {
      return { ...payload, password: decryptString(payload.password) };
    }
  }
  return value;
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    let rejected = false;
    req.on('data', (ch: Buffer | string) => {
      if (rejected) return;
      body += ch.toString();
      if (Buffer.byteLength(body, 'utf8') > getMaxBodyBytes()) {
        rejected = true;
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) as Record<string, unknown> : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getAuth(req: http.IncomingMessage): string | null {
  const key = req.headers['x-api-key'];
  if (typeof key === 'string') return key;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

function getRequestOrigin(req: http.IncomingMessage): string | null {
  const origin = req.headers.origin;
  return typeof origin === 'string' ? origin : null;
}

function isPrivateNetworkHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // same-origin/non-browser clients
  if (getCorsOrigins().includes(origin)) return true;
  if (!corsAllowLan()) return false;
  try {
    return isPrivateNetworkHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function corsHeaders(req: http.IncomingMessage): Record<string, string> {
  const origin = getRequestOrigin(req);
  if (!origin) return {};
  if (!isOriginAllowed(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function isRateLimited(req: http.IncomingMessage): boolean {
  const now = Date.now();
  const ip = getClientIp(req);
  const existing = rateWindowByIp.get(ip) || [];
  const recent = existing.filter((ts) => now - ts < getRateLimitWindowMs());
  if (recent.length >= getRateLimitMax()) {
    rateWindowByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  rateWindowByIp.set(ip, recent);
  return false;
}

function respond(req: http.IncomingMessage, res: http.ServerResponse, status: number, data: unknown) {
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(req),
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!isOriginAllowed(getRequestOrigin(req))) {
    respond(req, res, 403, { error: 'Origin not allowed' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-API-Key, X-SUEZ-ROLE, X-SUEZ-ACCOUNTANT-TOKEN, X-SUEZ-EMPLOYEE-ID',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const url = req.url?.split('?')[0] ?? '';
  if (!canWrite(req, url)) {
    writeAuditEvent({
      req,
      url,
      method: req.method || 'UNKNOWN',
      orgId: resolveOrgId(url, req.url ?? '/'),
      action: 'write_access_control',
      result: 'denied',
      details: { reason: 'non-owner role attempted write' },
    });
    respond(req, res, 403, { error: 'Write access denied for role' });
    return;
  }

  if (url === '/api/health') {
    respond(req, res, 200, { ok: true, ts: new Date().toISOString() });
    return;
  }

  // Proxy Frankfurter FX so the browser never hits third-party CORS (console noise + failure).
  if (req.method === 'GET' && (url === '/api/fx/latest' || /^\/api\/fx\/\d{4}-\d{2}-\d{2}$/.test(url))) {
    const fxQs = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams);
    const from = typeof fxQs.from === 'string' && fxQs.from ? fxQs.from.toUpperCase() : 'USD';
    const to = typeof fxQs.to === 'string' && fxQs.to ? fxQs.to.toUpperCase() : 'INR';
    const datePart = url === '/api/fx/latest' ? 'latest' : url.slice('/api/fx/'.length);
    try {
      const upstream = await fetch(
        `https://api.frankfurter.app/${datePart}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!upstream.ok) {
        respond(req, res, upstream.status, { error: 'FX upstream failed' });
        return;
      }
      const data = await upstream.json();
      respond(req, res, 200, data);
    } catch (err) {
      respond(req, res, 502, { error: 'FX proxy unreachable', detail: (err as Error).message });
    }
    return;
  }

  // ── SLO metrics (REQ-031 / REQ-066 / T-036) ─────────────────────────────────
  if (url === '/api/slo/metrics' && req.method === 'GET') {
    const sloQs = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams);
    const op = typeof sloQs.operation === 'string' ? sloQs.operation : undefined;
    const summaries = summarizeSlo(
      op === 'ledger_query'
        || op === 'payroll_batch'
        || op === 'compliance_export'
        || op === 'stripe_sync'
        || op === 'ai_assistant'
        || op === 'http_request'
        ? op
        : undefined,
    );
    respond(req, res, 200, {
      ok: true,
      ts: new Date().toISOString(),
      summaries,
    });
    return;
  }

  if (url === '/api/admin/pii-migration-status' && req.method === 'GET') {
    const suzeApiKey = getSuezApiKey();
    if (!suzeApiKey || getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }

    const orgIds = getAllOrgIds();
    let employeeRowsScanned = 0;
    let employeeRowsWithPlaintext = 0;
    let employeePlaintextFields = 0;
    let profileRowsScanned = 0;
    let profileRowsWithPlaintext = 0;
    let profilePlaintextFields = 0;
    const orgsWithPlaintext: string[] = [];

    for (const orgId of orgIds) {
      let orgHasPlaintext = false;
      const employees = getEmployees(orgId) as Record<string, unknown>[];
      for (const employee of employees) {
        employeeRowsScanned += 1;
        const fieldCount = countPlaintextEmployeePiiFields(employee);
        if (fieldCount > 0) {
          employeeRowsWithPlaintext += 1;
          employeePlaintextFields += fieldCount;
          orgHasPlaintext = true;
        }
      }

      const profile = getOrgData(orgId, 'suez_company_profile');
      if (profile) {
        profileRowsScanned += 1;
        const fieldCount = countPlaintextProfilePiiFields(profile);
        if (fieldCount > 0) {
          profileRowsWithPlaintext += 1;
          profilePlaintextFields += fieldCount;
          orgHasPlaintext = true;
        }
      }

      if (orgHasPlaintext) orgsWithPlaintext.push(orgId);
    }

    const remainingPlaintextRows = employeeRowsWithPlaintext + profileRowsWithPlaintext;
    respond(req, res, 200, {
      ok: true,
      encryptionEnabled: encryptionEnabled(),
      orgCount: orgIds.length,
      employeeRowsScanned,
      employeeRowsWithPlaintext,
      employeePlaintextFields,
      profileRowsScanned,
      profileRowsWithPlaintext,
      profilePlaintextFields,
      remainingPlaintextRows,
      migrationComplete: remainingPlaintextRows === 0,
      orgsWithPlaintext,
    });
    return;
  }

  if (url === '/api/admin/pii-migrate' && req.method === 'POST') {
    const suzeApiKey = getSuezApiKey();
    if (!suzeApiKey || getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    const orgIds = getAllOrgIds();
    let employeeRowsUpdated = 0;
    let profileRowsUpdated = 0;

    for (const orgId of orgIds) {
      const employees = getEmployees(orgId) as Record<string, unknown>[];
      for (const employee of employees) {
        const encrypted = encryptEmployeePII(employee);
        if (JSON.stringify(encrypted) !== JSON.stringify(employee)) {
          upsertEmployee(orgId, encrypted);
          employeeRowsUpdated += 1;
        }
      }

      const profile = getOrgData(orgId, 'suez_company_profile');
      if (profile) {
        const encryptedProfile = encryptOrgProfilePII(profile);
        if (JSON.stringify(encryptedProfile) !== JSON.stringify(profile)) {
          setOrgData(orgId, 'suez_company_profile', encryptedProfile);
          profileRowsUpdated += 1;
        }
      }
    }

    writeAuditEvent({
      req,
      url,
      method: req.method,
      orgId: 'system',
      action: 'pii_migration',
      result: 'success',
      details: {
        orgCount: orgIds.length,
        employeeRowsUpdated,
        profileRowsUpdated,
      },
    });

    respond(req, res, 200, {
      ok: true,
      orgCount: orgIds.length,
      employeeRowsUpdated,
      profileRowsUpdated,
    });
    return;
  }

  // ── Backup / restore (REQ-032, REQ-067) ─────────────────────────────────
  if (url === '/api/admin/backup/status' && req.method === 'GET') {
    const suzeApiKey = getSuezApiKey();
    if (!suzeApiKey || getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    respond(req, res, 200, getBackupStatus());
    return;
  }

  if (url === '/api/admin/backup' && req.method === 'GET') {
    const suzeApiKey = getSuezApiKey();
    if (!suzeApiKey || getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    respond(req, res, 200, { ok: true, backups: listBackups() });
    return;
  }

  if (url === '/api/admin/backup' && req.method === 'POST') {
    const suzeApiKey = getSuezApiKey();
    if (!suzeApiKey || getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const result = createBackup();
      writeAuditEvent({
        req,
        url,
        method: req.method,
        orgId: 'system',
        action: 'backup_create',
        result: 'success',
        details: { fileName: result.backup.fileName, sizeBytes: result.backup.sizeBytes },
      });
      respond(req, res, 200, result);
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/admin/backup/verify' && req.method === 'POST') {
    const suzeApiKey = getSuezApiKey();
    if (!suzeApiKey || getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const body = await parseBody(req);
      const backupPath = typeof body.backupPath === 'string' ? body.backupPath : undefined;
      const result = verifyBackup(backupPath);
      writeAuditEvent({
        req,
        url,
        method: req.method,
        orgId: 'system',
        action: 'backup_verify',
        result: result.ok ? 'success' : 'failure',
        details: { fileName: result.backup.fileName, checks: result.checks, error: result.error },
      });
      respond(req, res, result.ok ? 200 : 422, result);
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ── Storage API ─────────────────────────────────────────────────────────
  // GET  /api/storage          → return all key-value pairs
  // POST /api/storage          → upsert { key, value }
  // DELETE /api/storage/:key   → remove a key
  // DELETE /api/storage        → clear all keys (full reset)

  if (url === '/api/storage' && req.method === 'GET') {
    try {
      rebuildKvFromDomain();
    } catch (err) {
      console.warn('[api] rebuildKvFromDomain:', (err as Error).message);
    }
    respond(req, res, 200, getAllKV());
    return;
  }

  if (url === '/api/bootstrap' && req.method === 'GET') {
    try {
      const summary = rebuildKvFromDomain();
      respond(req, res, 200, { ok: true, ...summary, storage: getAllKV() });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/storage' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const key = typeof body.key === 'string' ? body.key : null;
      if (!key) {
        respond(req, res, 400, { error: 'key (string) required' });
        return;
      }
      setKV(key, body.value);
      writeAuditEvent({
        req, url, method: req.method, orgId: resolveOrgId(url, req.url ?? '/', body),
        action: 'storage_upsert', result: 'success', details: { key },
      });
      respond(req, res, 200, { ok: true });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/storage' && req.method === 'DELETE') {
    clearKV();
    writeAuditEvent({
      req, url, method: req.method, orgId: resolveOrgId(url, req.url ?? '/'),
      action: 'storage_clear', result: 'success',
    });
    respond(req, res, 200, { ok: true });
    return;
  }

  if (url.startsWith('/api/storage/') && req.method === 'DELETE') {
    const key = decodeURIComponent(url.slice('/api/storage/'.length));
    if (!key) {
      respond(req, res, 400, { error: 'key required in path' });
      return;
    }
    deleteKV(key);
    writeAuditEvent({
      req, url, method: req.method, orgId: resolveOrgId(url, req.url ?? '/'),
      action: 'storage_delete', result: 'success', details: { key },
    });
    respond(req, res, 200, { ok: true });
    return;
  }
  // ────────────────────────────────────────────────────────────────────────

  // ── Domain API ───────────────────────────────────────────────────────────
  // All domain endpoints require ?orgId= query param.
  // GET    /api/transactions?orgId=&limit=&offset=&startDate=&endDate=&type=&source=&status=&search=
  // POST   /api/transactions        { orgId, transactions: [...] }   (bulk upsert)
  // PUT    /api/transactions/:id    { orgId, transaction: {...} }
  // DELETE /api/transactions/:id    { orgId }
  //
  // GET    /api/employees?orgId=
  // POST   /api/employees           { orgId, employees: [...] }
  // PUT    /api/employees/:id       { orgId, employee: {...} }
  // DELETE /api/employees/:id?orgId=
  //
  // GET    /api/payroll?orgId=
  // POST   /api/payroll             { orgId, run: {...} }
  // DELETE /api/payroll/:id?orgId=
  //
  // GET    /api/invoices?orgId=&status=
  // POST   /api/invoices            { orgId, invoice: {...} }
  // DELETE /api/invoices/:id?orgId=
  //
  // GET    /api/org/:orgId          → all org_data keys
  // GET    /api/org/:orgId/:key     → single key
  // PUT    /api/org/:orgId/:key     { value: ... }

  const qs = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams);

  // ── Transactions ──────────────────────────────────────────────────────────
  if (url === '/api/transactions' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const txns = queryTransactions({
      orgId,
      limit:         qs.limit  ? Number(qs.limit)  : 500,
      offset:        qs.offset ? Number(qs.offset) : 0,
      startDate:     qs.startDate,
      endDate:       qs.endDate,
      type:          qs.type,
      source:        qs.source,
      status:        qs.status,
      search:        qs.search,
      includeDeleted: qs.includeDeleted === 'true',
    });
    const total = getTransactionCount(orgId, qs.includeDeleted === 'true');
    respond(req, res, 200, { transactions: txns, total, limit: Number(qs.limit ?? 500), offset: Number(qs.offset ?? 0) });
    return;
  }

  if (url === '/api/transactions' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      const payeeType = (typeof body.payeeType === 'string' ? body.payeeType : 'other') as PayeeType;
      if (Array.isArray(body.transactions)) {
        const enriched = body.transactions.map((tx) =>
          applyVendorTdsToTransaction(tx as Record<string, unknown>, payeeType),
        );
        const validationErrors = validateArray(TransactionSchema, enriched);
        if (validationErrors.length) {
          respond(req, res, 422, { error: 'Validation failed for some transactions', validationErrors });
          return;
        }
        bulkUpsertTransactions(orgId, enriched as Record<string, unknown>[]);
        writeAuditEvent({
          req, url, method: req.method, orgId,
          action: 'transactions_bulk_upsert', result: 'success', details: { count: enriched.length },
        });
        respond(req, res, 200, { ok: true, count: enriched.length });
      } else if (body.transaction) {
        const enriched = applyVendorTdsToTransaction(
          body.transaction as Record<string, unknown>,
          payeeType,
        );
        const err = validate(TransactionSchema, enriched);
        if (err) { respond(req, res, 422, { error: err }); return; }
        upsertTransaction(orgId, enriched);
        writeAuditEvent({ req, url, method: req.method, orgId, action: 'transaction_upsert', result: 'success' });
        respond(req, res, 200, { ok: true, transaction: enriched });
      } else {
        respond(req, res, 400, { error: 'transactions[] or transaction{} required' });
      }
    } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
    return;
  }

  const txnMatch = url.match(/^\/api\/transactions\/(.+)$/);
  if (txnMatch) {
    const txId = decodeURIComponent(txnMatch[1]);
    if (req.method === 'PUT') {
      try {
        const body = await parseBody(req);
        const orgId = typeof body.orgId === 'string' ? body.orgId : null;
        if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
        const err = validate(TransactionUpdateSchema, body.transaction);
        if (err) { respond(req, res, 422, { error: err }); return; }
        upsertTransaction(orgId, body.transaction as Record<string, unknown>);
        writeAuditEvent({
          req, url, method: req.method, orgId,
          action: 'transaction_update', result: 'success', details: { id: txId },
        });
        respond(req, res, 200, { ok: true });
      } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
      return;
    }
    if (req.method === 'DELETE') {
      const orgId = qs.orgId;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      deleteTransaction(orgId, txId);
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'transaction_delete', result: 'success', details: { id: txId },
      });
      respond(req, res, 200, { ok: true });
      return;
    }
  }

  // ── Employees ─────────────────────────────────────────────────────────────
  // ── Employee self-service profile (allowlisted fields) ───────────────────
  if (url === '/api/employees/self' && req.method === 'GET') {
    try {
      const orgId = qs.orgId || null;
      const employeeId = qs.employeeId || null;
      if (!orgId || !employeeId) {
        respond(req, res, 400, { error: 'orgId and employeeId are required' });
        return;
      }
      if (getRequestRole(req) !== 'employee') {
        respond(req, res, 403, { error: 'Employee role required' });
        return;
      }
      const sessionEmpHeader = req.headers['x-suez-employee-id'];
      const sessionEmployeeId = typeof sessionEmpHeader === 'string' ? sessionEmpHeader.trim() : '';
      if (!sessionEmployeeId || sessionEmployeeId !== employeeId) {
        respond(req, res, 403, { error: 'Employees may only read their own profile' });
        return;
      }
      const existingRaw = (getEmployees(orgId) as Record<string, unknown>[])
        .find((e) => e.id === employeeId);
      if (!existingRaw) {
        respond(req, res, 404, { error: 'Employee not found' });
        return;
      }
      const employee = decryptEmployeePII(existingRaw);
      respond(req, res, 200, { employee });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/employees/self' && req.method === 'PUT') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const employeeId = typeof body.employeeId === 'string' ? body.employeeId : null;
      const patchRaw = body.patch && typeof body.patch === 'object'
        ? (body.patch as Record<string, unknown>)
        : (body.employee && typeof body.employee === 'object'
          ? (body.employee as Record<string, unknown>)
          : null);
      if (!orgId || !employeeId || !patchRaw) {
        respond(req, res, 400, { error: 'orgId, employeeId, and patch{} are required' });
        return;
      }
      const sessionEmpHeader = req.headers['x-suez-employee-id'];
      const sessionEmployeeId = typeof sessionEmpHeader === 'string' ? sessionEmpHeader.trim() : '';
      if (!sessionEmployeeId || sessionEmployeeId !== employeeId) {
        respond(req, res, 403, { error: 'Employees may only update their own profile' });
        return;
      }

      const SELF_KEYS = new Set([
        'name', 'phone', 'address', 'dateOfBirth', 'gender', 'fatherOrSpouseName',
        'panNumber', 'aadhaarNumber', 'uan', 'esiNumber',
        'bankAccountNumber', 'bankIFSC', 'bankName',
        'taxRegime', 'section80C', 'section80D', 'hraExemptionRent',
      ]);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patchRaw)) {
        if (SELF_KEYS.has(k) && v !== undefined) patch[k] = v;
      }
      if (Object.keys(patch).length === 0) {
        respond(req, res, 400, { error: 'No editable profile fields in patch' });
        return;
      }

      const existingRaw = (getEmployees(orgId) as Record<string, unknown>[])
        .find((e) => e.id === employeeId);
      if (!existingRaw) {
        respond(req, res, 404, { error: 'Employee not found' });
        return;
      }
      const existing = decryptEmployeePII(existingRaw) as Record<string, unknown>;
      const docs = {
        ...((existing.documents as Record<string, unknown> | undefined) || {}),
      };
      if (typeof patch.panNumber === 'string' && patch.panNumber.trim()) docs.pan = true;
      if (typeof patch.aadhaarNumber === 'string' && patch.aadhaarNumber.trim()) docs.aadhaar = true;

      const merged = {
        ...existing,
        ...patch,
        id: employeeId,
        // Lock HR-owned fields
        email: existing.email,
        ctc: existing.ctc,
        status: existing.status,
        designation: existing.designation,
        department: existing.department,
        doj: existing.doj,
        employeeType: existing.employeeType,
        documents: docs,
      };
      const fullErr = validate(EmployeeSchema, merged);
      if (fullErr) { respond(req, res, 422, { error: fullErr }); return; }

      upsertEmployee(orgId, encryptEmployeePII(merged));
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'employee_self_update', result: 'success', details: { id: employeeId, keys: Object.keys(patch) },
      });
      respond(req, res, 200, {
        ok: true,
        // Self-service returns the caller's own record unmasked
        employee: merged,
      });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/employees' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const employees = getEmployees(orgId).map((e) => decryptEmployeePII(e));
    respond(req, res, 200, {
      employees: shouldRevealSensitive(req) ? employees : employees.map((e) => maskEmployeePII(e)),
    });
    return;
  }

  if (url === '/api/employees' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      if (Array.isArray(body.employees)) {
        const validationErrors = validateArray(EmployeeSchema, body.employees);
        if (validationErrors.length) {
          respond(req, res, 422, { error: 'Validation failed for some employees', validationErrors });
          return;
        }
        const encryptedEmployees = (body.employees as Record<string, unknown>[]).map((e) => encryptEmployeePII(e));
        bulkUpsertEmployees(orgId, encryptedEmployees);
        writeAuditEvent({
          req, url, method: req.method, orgId,
          action: 'employees_bulk_upsert', result: 'success', details: { count: body.employees.length },
        });
        respond(req, res, 200, { ok: true, count: body.employees.length });
      } else if (body.employee) {
        const err = validate(EmployeeSchema, body.employee);
        if (err) { respond(req, res, 422, { error: err }); return; }
        upsertEmployee(orgId, encryptEmployeePII(body.employee as Record<string, unknown>));
        writeAuditEvent({ req, url, method: req.method, orgId, action: 'employee_upsert', result: 'success' });
        respond(req, res, 200, { ok: true });
      } else {
        respond(req, res, 400, { error: 'employees[] or employee{} required' });
      }
    } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
    return;
  }

  const empMatch = url.match(/^\/api\/employees\/(.+)$/);
  if (empMatch) {
    const empId = decodeURIComponent(empMatch[1]);
    if (req.method === 'PUT') {
      try {
        const body = await parseBody(req);
        const orgId = typeof body.orgId === 'string' ? body.orgId : null;
        if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
        if (!body.employee || typeof body.employee !== 'object') {
          respond(req, res, 400, { error: 'employee{} required' });
          return;
        }
        const err = validate(EmployeeUpdateSchema, body.employee);
        if (err) { respond(req, res, 422, { error: err }); return; }

        const existingRaw = (getEmployees(orgId) as Record<string, unknown>[])
          .find((e) => e.id === empId);
        if (!existingRaw) {
          respond(req, res, 404, { error: 'Employee not found' });
          return;
        }
        const existing = decryptEmployeePII(existingRaw) as Record<string, unknown>;
        const patch = body.employee as Record<string, unknown>;
        const merged = {
          ...existing,
          ...patch,
          id: empId,
          documents: {
            ...((existing.documents as Record<string, unknown> | undefined) || {}),
            ...((patch.documents as Record<string, unknown> | undefined) || {}),
          },
        };
        const fullErr = validate(EmployeeSchema, merged);
        if (fullErr) { respond(req, res, 422, { error: fullErr }); return; }

        upsertEmployee(orgId, encryptEmployeePII(merged));
        writeAuditEvent({
          req, url, method: req.method, orgId,
          action: 'employee_update', result: 'success', details: { id: empId },
        });
        respond(req, res, 200, { ok: true, employee: merged });
      } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
      return;
    }
    if (req.method === 'DELETE') {
      const orgId = qs.orgId;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      deleteEmployee(orgId, empId);
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'employee_delete', result: 'success', details: { id: empId },
      });
      respond(req, res, 200, { ok: true });
      return;
    }
  }

  // ── TDS / ESI rules (REQ-012, REQ-062 / T-019) ─────────────────────────────
  if (url === '/api/tds/sections' && req.method === 'GET') {
    respond(req, res, 200, { sections: VENDOR_TDS_SECTIONS });
    return;
  }

  if (url === '/api/tds/compute' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const amount = Number(body.amount);
      const section = typeof body.section === 'string' ? body.section : '';
      if (!(amount > 0) || !section) {
        respond(req, res, 400, { error: 'amount (>0) and section required' });
        return;
      }
      const payeeType = (typeof body.payeeType === 'string' ? body.payeeType : 'other') as PayeeType;
      const result = computeVendorTds({
        amount,
        section,
        payeeType,
        payeeName: typeof body.payeeName === 'string' ? body.payeeName : undefined,
      });
      respond(req, res, 200, { ok: true, ...result });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/esi/evaluate' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const monthlyGross = Number(body.monthlyGross);
      const esiEnabled = body.esiEnabled === true;
      if (!(monthlyGross >= 0) || Number.isNaN(monthlyGross)) {
        respond(req, res, 400, { error: 'monthlyGross required' });
        return;
      }
      respond(req, res, 200, { ok: true, ...evaluateEsi({ monthlyGross, esiEnabled }) });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  // ── Payroll runs ──────────────────────────────────────────────────────────
  if (url === '/api/payroll' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, { runs: getPayrollRuns(orgId) });
    return;
  }

  // POST /api/payroll/validate — pre-run row-level validation (REQ-059 / T-017)
  if (url === '/api/payroll/validate' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }

      let employees: Employee[];
      if (Array.isArray(body.employees) && body.employees.length > 0) {
        employees = body.employees as Employee[];
      } else {
        employees = getEmployees(orgId).map((e) => decryptEmployeePII(e) as Employee);
      }

      const report = validatePayrollEmployees(employees);
      respond(req, res, 200, { ok: report.ok, orgId, ...report });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  // POST /api/payroll/run — validate + execute batch with outputs bundle (REQ-011 / T-018)
  if (url === '/api/payroll/run' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const month = typeof body.month === 'string' ? body.month : null;
      const year = typeof body.year === 'number' ? body.year : Number(body.year);
      if (!orgId || !month || !Number.isFinite(year)) {
        respond(req, res, 400, { error: 'orgId, month, and year required' });
        return;
      }

      let employees: Employee[];
      if (Array.isArray(body.employees) && body.employees.length > 0) {
        employees = body.employees as Employee[];
      } else {
        employees = getEmployees(orgId).map((e) => decryptEmployeePII(e) as Employee);
      }

      const profile = getOrgData(orgId, 'suez_company_profile') as CompanyProfile | null;
      const payrollConfig = (body.payrollConfig as PayrollConfig | undefined)
        || profile?.payroll
        || null;

      const existing = getPayrollRuns(orgId) as Array<{ month?: string; year?: number }>;
      const monthName = /^\d{4}-\d{2}$/.test(month)
        ? ['January','February','March','April','May','June','July','August','September','October','November','December'][Number(month.slice(5, 7)) - 1]
        : month;
      if (existing.some((r) => r.month === monthName && r.year === year)) {
        respond(req, res, 409, { error: `Payroll for ${monthName} ${year} already exists` });
        return;
      }

      const result = runPayrollBatch({
        orgId,
        month,
        year,
        employees,
        payrollConfig,
        lopByEmployeeId: (body.lopByEmployeeId as Record<string, number> | undefined) || undefined,
        failClosed: body.failClosed === true,
      });

      if (!result.ok || !result.run) {
        respond(req, res, 422, {
          ok: false,
          validation: result.validation,
          error: result.error || 'Payroll batch failed',
        });
        return;
      }

      upsertPayrollRun(orgId, result.run as unknown as Record<string, unknown>);
      writeAuditEvent({
        req,
        url,
        method: req.method,
        orgId,
        action: 'payroll_batch_run',
        result: 'success',
        details: {
          runId: result.run.id,
          processed: result.run.employeeCount,
          skipped: result.validation.failedCount,
        },
      });
      respond(req, res, 200, {
        ok: true,
        run: result.run,
        validation: result.validation,
        outputs: result.outputs,
      });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/payroll' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId || !body.run) { respond(req, res, 400, { error: 'orgId and run required' }); return; }
      const err = validate(PayrollRunSchema, body.run);
      if (err) { respond(req, res, 422, { error: err }); return; }
      upsertPayrollRun(orgId, body.run as Record<string, unknown>);
      writeAuditEvent({ req, url, method: req.method, orgId, action: 'payroll_upsert', result: 'success' });
      respond(req, res, 200, { ok: true });
    } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
    return;
  }

  const payMatch = url.match(/^\/api\/payroll\/(.+)$/);
  if (payMatch && req.method === 'DELETE') {
    const runId = decodeURIComponent(payMatch[1]);
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    deletePayrollRun(orgId, runId);
    writeAuditEvent({
      req, url, method: req.method, orgId,
      action: 'payroll_delete', result: 'success', details: { id: runId },
    });
    respond(req, res, 200, { ok: true });
    return;
  }

  // ── Invoices ──────────────────────────────────────────────────────────────
  if (url === '/api/invoices' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, { invoices: getInvoicesDB(orgId, qs.status) });
    return;
  }

  if (url === '/api/invoices' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId || !body.invoice) { respond(req, res, 400, { error: 'orgId and invoice required' }); return; }
      const err = validate(InvoiceSchema, body.invoice);
      if (err) { respond(req, res, 422, { error: err }); return; }
      upsertInvoice(orgId, body.invoice as Record<string, unknown>);
      writeAuditEvent({ req, url, method: req.method, orgId, action: 'invoice_upsert', result: 'success' });
      respond(req, res, 200, { ok: true });
    } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
    return;
  }

  const invMatch = url.match(/^\/api\/invoices\/(.+)$/);
  if (invMatch && req.method === 'DELETE') {
    const invId = decodeURIComponent(invMatch[1]);
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    deleteInvoice(orgId, invId);
    writeAuditEvent({
      req, url, method: req.method, orgId,
      action: 'invoice_delete', result: 'success', details: { id: invId },
    });
    respond(req, res, 200, { ok: true });
    return;
  }

  // ── Period close + journals (REQ-060 / T-022) ─────────────────────────────
  if (url === '/api/period-closes' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const period = qs.period;
    const closes = listPeriodCloses(orgId);
    if (period) {
      respond(req, res, 200, { period, status: periodStatus(orgId, period), closes });
      return;
    }
    respond(req, res, 200, { closes });
    return;
  }

  if (url === '/api/period-closes' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      const closedBy = typeof body.closedBy === 'string' ? body.closedBy : undefined;

      if (body.yearEnd === true) {
        const yearEndYear = Number(body.yearEndYear ?? body.year);
        if (!Number.isFinite(yearEndYear)) {
          respond(req, res, 400, { error: 'yearEndYear required for year-end close' });
          return;
        }
        const result = runYearEndCloseForOrg(orgId, {
          yearEndYear,
          yearEndMonth: body.yearEndMonth != null ? Number(body.yearEndMonth) : 12,
          closedBy,
          currency: body.currency === 'USD' ? 'USD' : 'INR',
        });
        writeAuditEvent({
          req, url, method: req.method, orgId,
          action: 'year_end_close', result: 'success',
          details: { yearEndYear, retainedEarnings: result.retainedEarningsAmount },
        });
        respond(req, res, 200, { ok: true, ...result });
        return;
      }

      const period = typeof body.period === 'string' ? body.period : '';
      if (!/^\d{4}-\d{2}$/.test(period)) {
        respond(req, res, 400, { error: 'period (YYYY-MM) required' });
        return;
      }
      const pc = closeAccountingPeriod(orgId, period, closedBy);
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'period_close', result: 'success', details: { period },
      });
      respond(req, res, 200, { ok: true, periodClose: pc });
    } catch (err) {
      const msg = (err as Error).message;
      const status = /already closed|locked/i.test(msg) ? 409 : 400;
      respond(req, res, status, { error: msg });
    }
    return;
  }

  if (url === '/api/journals' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, {
      journals: listJournals(orgId),
      trialBalance: trialBalanceForOrg(orgId, qs.period),
    });
    return;
  }

  if (url === '/api/journals' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      const entry = body.entry || body;
      const je = createAndOptionallyPostJournal(orgId, {
        date: String(entry.date),
        description: String(entry.description || 'Manual entry'),
        lines: Array.isArray(entry.lines) ? entry.lines : [],
        post: entry.post !== false && body.post !== false,
        createdBy: typeof body.createdBy === 'string' ? body.createdBy : undefined,
      });
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'journal_create', result: 'success', details: { id: je.id, period: je.period },
      });
      respond(req, res, 200, { ok: true, journal: je });
    } catch (err) {
      const msg = (err as Error).message;
      const status = /locked/i.test(msg) ? 422 : 400;
      respond(req, res, status, { error: msg });
    }
    return;
  }

  const journalPostMatch = url.match(/^\/api\/journals\/([^/]+)\/post$/);
  if (journalPostMatch && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      const je = postJournal(orgId, decodeURIComponent(journalPostMatch[1]));
      respond(req, res, 200, { ok: true, journal: je });
    } catch (err) {
      const msg = (err as Error).message;
      const status = /locked/i.test(msg) ? 422 : 400;
      respond(req, res, status, { error: msg });
    }
    return;
  }

  // ── Bank CSV import (REQ-079 / T-026) ──────────────────────────────────────
  if (url === '/api/bank-statements/import' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const csv = typeof body.csv === 'string' ? body.csv : '';
      if (!orgId || !csv.trim()) {
        respond(req, res, 400, { error: 'orgId and csv required' });
        return;
      }
      const report = importBankStatementCsv(orgId, csv, {
        dateWindowDays: body.dateWindowDays != null ? Number(body.dateWindowDays) : 3,
        persistUnmatched: body.persistUnmatched !== false,
      });
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'bank_statement_import', result: 'success',
        details: {
          matched: report.matchedCount,
          unmatched: report.unmatchedCount,
          ambiguous: report.ambiguousCount,
        },
      });
      respond(req, res, 200, { ok: true, ...report });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  // ── Fixed assets (REQ-063 / T-025) ─────────────────────────────────────────
  if (url === '/api/fixed-assets' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, { assets: listFixedAssets(orgId) });
    return;
  }

  if (url === '/api/fixed-assets' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId || !body.asset) {
        respond(req, res, 400, { error: 'orgId and asset required' });
        return;
      }
      const asset = upsertFixedAsset(orgId, body.asset);
      respond(req, res, 200, { ok: true, asset });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/fixed-assets/depreciate' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const period = typeof body.period === 'string' ? body.period : '';
      if (!orgId || !period) {
        respond(req, res, 400, { error: 'orgId and period required' });
        return;
      }
      const result = runDepreciationPosting(orgId, {
        period,
        date: typeof body.date === 'string' ? body.date : undefined,
        periodFraction: body.periodFraction != null ? Number(body.periodFraction) : undefined,
      });
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'fixed_asset_depreciate', result: 'success',
        details: { period, assetCount: result.computations.length },
      });
      respond(req, res, 200, { ok: true, ...result });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  // ── Tally export (REQ-081 / T-027) ─────────────────────────────────────────
  if (url === '/api/exports/tally' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const exportResult = exportTallyCsv(orgId, qs.period);
    respond(req, res, 200, { ok: true, ...exportResult });
    return;
  }

  // ── Single-writer session (REQ-070 / T-032) ────────────────────────────────
  if (url === '/api/session/writer' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, { ok: true, ...getWriterStatus(orgId) });
    return;
  }

  if (url === '/api/session/writer/claim' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
      if (!orgId || !sessionId) {
        respond(req, res, 400, { error: 'orgId and sessionId required' });
        return;
      }
      const result = claimWriter(orgId, sessionId, typeof body.label === 'string' ? body.label : undefined);
      if (result.status === 'conflict') {
        writeAuditEvent({
          req, url, method: req.method, orgId,
          action: 'writer_session_conflict', result: 'denied',
          details: { sessionId, warning: result.warning },
        });
        respond(req, res, 409, { ok: false, ...result });
        return;
      }
      respond(req, res, 200, { ok: true, ...result });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/session/writer/heartbeat' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
      if (!orgId || !sessionId) {
        respond(req, res, 400, { error: 'orgId and sessionId required' });
        return;
      }
      const result = heartbeatWriter(orgId, sessionId);
      respond(req, res, 200, { ok: true, ...result });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/session/writer/release' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
      if (!orgId || !sessionId) {
        respond(req, res, 400, { error: 'orgId and sessionId required' });
        return;
      }
      const result = releaseWriter(orgId, sessionId);
      respond(req, res, 200, { ok: true, ...result });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ── Accountant 72h read-only invite (REQ-073 / T-033) ──────────────────────
  if (url === '/api/accountant-invites' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, { ok: true, invites: listAccountantInvitesForOrg(orgId) });
    return;
  }

  if (url === '/api/accountant-invites' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!orgId || !email) {
        respond(req, res, 400, { error: 'orgId and email required' });
        return;
      }
      const host = req.headers.host || 'localhost:5173';
      const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
      const appBase = resolvePublicAppBaseUrl(
        typeof body.appBase === 'string' && body.appBase
          ? body.appBase
          : `${proto}://${host}`,
      );
      const orgName = typeof body.orgName === 'string' ? body.orgName : undefined;
      const created = createAccountantInviteForOrg({ orgId, email, orgName, appBase });
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'accountant_invite_create', result: 'success',
        details: { email, expiresAt: created.invite.expiresAt },
      });
      respond(req, res, 200, { ok: true, ...created });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/accountant-invites/open' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const token = typeof body.token === 'string' ? body.token : '';
      if (!token) { respond(req, res, 400, { error: 'token required' }); return; }
      const result = openAccountantInvite(token);
      if (result.ok === false) {
        respond(req, res, 410, { ok: false, error: result.error });
        return;
      }
      respond(req, res, 200, {
        ok: true,
        role: result.role,
        invite: {
          orgId: result.invite.orgId,
          orgName: result.invite.orgName,
          email: result.invite.email,
          expiresAt: result.invite.expiresAt,
          status: result.invite.status,
        },
        token,
      });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  const accountantRevokeMatch = url.match(/^\/api\/accountant-invites\/([^/]+)\/revoke$/);
  if (accountantRevokeMatch && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : qs.orgId;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      const inviteId = decodeURIComponent(accountantRevokeMatch[1]);
      const result = revokeAccountantInviteForOrg(orgId, inviteId);
      if (result.ok === false) {
        respond(req, res, 404, { ok: false, error: result.error });
        return;
      }
      respond(req, res, 200, { ok: true, invite: result.invite });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ── Compliance status engine (REQ-002 / T-029) ─────────────────────────────
  if (url === '/api/compliance/status' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    try {
      const report = getComplianceStatusForOrg(orgId);
      respond(req, res, 200, { ok: true, ...report });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ── Filing acknowledgement (REQ-080 / T-030) ───────────────────────────────
  if (url === '/api/filings/acknowledge' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const taskId = typeof body.taskId === 'string' ? body.taskId : null;
      if (!orgId || !taskId) {
        respond(req, res, 400, { error: 'orgId and taskId required' });
        return;
      }
      const evidenceLinks = Array.isArray(body.evidenceLinks)
        ? body.evidenceLinks.filter((x: unknown): x is string => typeof x === 'string')
        : undefined;
      const documentIds = Array.isArray(body.documentIds)
        ? body.documentIds.filter((x: unknown): x is string => typeof x === 'string')
        : undefined;
      const result = acknowledgeFilingForOrg(orgId, taskId, {
        acknowledgementNumber: typeof body.acknowledgementNumber === 'string' ? body.acknowledgementNumber : undefined,
        filedDate: typeof body.filedDate === 'string' ? body.filedDate : undefined,
        evidenceLinks,
        documentIds,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
      });
      if (result.ok === false) {
        respond(req, res, 400, { ok: false, errors: result.errors, warnings: result.warnings });
        return;
      }
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'filing_acknowledge', result: 'success',
        details: { taskId, acknowledgementNumber: result.task.acknowledgementNumber },
      });
      respond(req, res, 200, { ok: true, task: result.task, warnings: result.warnings });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ── FEMA FIRC / ODI tracking (REQ-018 / REQ-019 / T-031) ───────────────────
  if (url === '/api/fema/tracking' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    try {
      const report = getFemaTrackingForOrg(orgId);
      respond(req, res, 200, { ok: true, ...report });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/fema/odi-profile' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, { ok: true, profile: getOdiProfile(orgId) });
    return;
  }

  if (url === '/api/fema/odi-profile' && req.method === 'PUT') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      const profile: OdiProfile = {
        uin: typeof body.uin === 'string' ? body.uin : undefined,
        investeeName: typeof body.investeeName === 'string' ? body.investeeName : undefined,
        investmentAmountInr: typeof body.investmentAmountInr === 'number' ? body.investmentAmountInr : undefined,
        lastAprFiledDate: typeof body.lastAprFiledDate === 'string' ? body.lastAprFiledDate : undefined,
        nextAprDueDate: typeof body.nextAprDueDate === 'string' ? body.nextAprDueDate : undefined,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        updatedAt: new Date().toISOString(),
      };
      const saved = setOdiProfile(orgId, profile);
      respond(req, res, 200, { ok: true, profile: saved });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/fema/firc-match' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const remittanceId = typeof body.remittanceId === 'string' ? body.remittanceId : null;
      const transactionId = typeof body.transactionId === 'string' ? body.transactionId : null;
      if (!orgId || !remittanceId || !transactionId) {
        respond(req, res, 400, { error: 'orgId, remittanceId, and transactionId required' });
        return;
      }
      const result = applyFircMatchForOrg(orgId, remittanceId, transactionId);
      if (result.ok === false) {
        respond(req, res, 400, { ok: false, error: result.error });
        return;
      }
      respond(req, res, 200, { ok: true, remittance: result.remittance });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ── Reconciliation ────────────────────────────────────────────────────────
  // GET /api/reconciliation?orgId=&persist=true   → compliance guards
  // GET /api/reconciliation/workbench?orgId=       → three-way panes (REQ-058)
  if (url === '/api/reconciliation/workbench' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    try {
      const transactions = queryTransactions({ orgId, limit: 10_000, offset: 0 }) as import('../types.js').Transaction[];
      const claimsRaw = getOrgData(orgId, 'gstr2bClaims');
      const gstr2bClaims = Array.isArray(claimsRaw) ? (claimsRaw as Gstr2bClaim[]) : [];
      const threeWay = buildThreeWayReconciliation({ transactions, gstr2bClaims });
      const compliance = reconcileOrg(orgId);
      respond(req, res, 200, { ok: true, orgId, threeWay, compliance });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/reconciliation' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    try {
      const report = reconcileOrg(orgId);
      if (qs.persist === 'true' || qs.persist === '1') {
        const reportId = insertReport(orgId, {
          reportType: 'reconciliation',
          label: `Reconciliation ${report.generatedAt}`,
          payload: report,
        });
        respond(req, res, 200, { ...report, _persistedId: reportId });
      } else {
        respond(req, res, 200, report);
      }
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // POST /api/stripe/sqlite-sync — server-side Stripe → SQLite (no browser mapping).
  // Auth: X-API-Key when SUEZ_API_KEY is set.
  // Body: { orgId, baseCurrency, stripeOrgConfig, entireHistory?, startDate?, endDate?, purge? }
  if (url === '/api/stripe/webhook' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : 'default';
      const event = body.event as StripeWebhookEvent | undefined;
      const eventId = typeof event?.id === 'string' ? event.id : '';
      const eventType = typeof event?.type === 'string' ? event.type : '';
      if (!eventId || !eventType) {
        respond(req, res, 400, { error: 'event.id and event.type required' });
        return;
      }

      const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null;
      const inserted = insertStripeEventIfNew({
        eventId,
        orgId,
        eventType,
        idempotencyKey,
        payload: event,
      });
      if (!inserted.inserted) {
        respond(req, res, 200, { ok: true, duplicate: true, eventId });
        return;
      }

      // Canonicalize charge / payment_intent / refund events into ledger rows (REQ-078, T-016).
      const obj = (event.data?.object || {}) as Record<string, unknown>;
      const ingestable = eventType === 'charge.succeeded'
        || eventType === 'payment_intent.succeeded'
        || eventType === 'charge.refunded';
      let normalizedId: string | undefined;
      if (ingestable) {
        const normalized = normalizeStripeObject(obj, {
          webhookEventId: eventId,
          eventType,
          baseCurrency: body.baseCurrency === 'USD' ? 'USD' : 'INR',
        });
        if (!normalized.ok) {
          respond(req, res, 422, { error: normalized.error, eventId, eventType });
          return;
        }
        upsertTransaction(orgId, normalized.transaction);
        normalizedId = String(normalized.transaction.id);
      }

      writeAuditEvent({
        req,
        url,
        method: req.method,
        orgId,
        action: 'stripe_webhook_ingest',
        result: 'success',
        details: { eventId, eventType, duplicate: false, transactionId: normalizedId },
      });
      respond(req, res, 200, {
        ok: true,
        duplicate: false,
        eventId,
        ingested: ingestable,
        transactionId: normalizedId,
      });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/stripe/events' && req.method === 'GET') {
    const suzeApiKey = getSuezApiKey();
    if (suzeApiKey && getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    const orgId = qs.orgId || 'default';
    const limit = Number(qs.limit || 100);
    const events = listStripeEvents(orgId, limit).map((row) => ({
      eventId: row.event_id,
      orgId: row.org_id,
      eventType: row.event_type,
      idempotencyKey: row.idempotency_key,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
    }));
    respond(req, res, 200, { ok: true, events });
    return;
  }

  if (url === '/api/stripe/sqlite-sync' && req.method === 'POST') {
    const suzeApiKey = getSuezApiKey();
    if (suzeApiKey && getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const stripeOrgConfig = body.stripeOrgConfig as Record<string, unknown> | undefined;
      const baseCurrency = body.baseCurrency === 'USD' ? 'USD' : 'INR';
      if (!orgId || !stripeOrgConfig || typeof stripeOrgConfig.apiKey !== 'string') {
        respond(req, res, 400, { error: 'orgId and stripeOrgConfig.apiKey required' });
        return;
      }
      const now = new Date();
      const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const defaultStart = `${fyStart}-04-01`;
      const today = now.toISOString().split('T')[0];
      const startDate = typeof body.startDate === 'string' ? body.startDate : defaultStart;
      const endDate = typeof body.endDate === 'string' ? body.endDate : today;
      const entireHistory = body.entireHistory === true;
      const purgeRaw = body.purge;
      const purge = purgeRaw === 'all' || purgeRaw === 'stripe' || purgeRaw === 'none' ? purgeRaw : 'stripe';

      const result = await syncStripeToSqlite({
        orgId,
        baseCurrency,
        stripe: stripeOrgConfig as StripeOrgConfigInput,
        entireHistory,
        startDate,
        endDate,
        purge,
      });
      respond(req, res, result.ok ? 200 : 500, result);
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ── Reports / inputs / processed (SQLite audit trail) ─────────────────────
  // GET    /api/reports?orgId=&limit=&offset=&reportType=
  // POST   /api/reports { orgId, reportType?, label?, payload }
  // GET    /api/reports/:id?orgId=
  // DELETE /api/reports/:id?orgId=
  if (url === '/api/reports' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const rows = listReports(orgId, {
      limit:  qs.limit  ? Number(qs.limit)  : 100,
      offset: qs.offset ? Number(qs.offset) : 0,
      reportType: qs.reportType,
    });
    const reports = rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      reportType: r.report_type,
      label: r.label,
      createdAt: r.created_at,
      payload: (() => { try { return JSON.parse(r.payload); } catch { return null; } })(),
    }));
    respond(req, res, 200, { reports });
    return;
  }

  if (url === '/api/reports' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId || body.payload === undefined) {
        respond(req, res, 400, { error: 'orgId and payload required' });
        return;
      }
      const id = insertReport(orgId, {
        reportType: typeof body.reportType === 'string' ? body.reportType : 'custom',
        label: typeof body.label === 'string' ? body.label : undefined,
        payload: body.payload,
      });
      respond(req, res, 200, { ok: true, id });
    } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
    return;
  }

  const reportMatch = url.match(/^\/api\/reports\/(.+)$/);
  if (reportMatch) {
    const reportId = decodeURIComponent(reportMatch[1]);
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    if (req.method === 'GET') {
      const row = getReport(orgId, reportId);
      if (!row) { respond(req, res, 404, { error: 'Not found' }); return; }
      let payload: unknown;
      try { payload = JSON.parse(row.payload); } catch { payload = row.payload; }
      respond(req, res, 200, {
        id: row.id,
        orgId: row.org_id,
        reportType: row.report_type,
        label: row.label,
        createdAt: row.created_at,
        payload,
      });
      return;
    }
    if (req.method === 'DELETE') {
      const ok = deleteReport(orgId, reportId);
      respond(req, res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
      return;
    }
  }

  // GET    /api/inputs?orgId=&limit=&offset=&inputType=
  // POST   /api/inputs { orgId, inputType, source?, label?, payload, metadata? }
  // GET    /api/inputs/:id?orgId=
  // DELETE /api/inputs/:id?orgId=
  if (url === '/api/inputs' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const rows = listInputs(orgId, {
      limit:  qs.limit  ? Number(qs.limit)  : 100,
      offset: qs.offset ? Number(qs.offset) : 0,
      inputType: qs.inputType,
    });
    const inputs = rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      inputType: r.input_type,
      source: r.source,
      label: r.label,
      createdAt: r.created_at,
      payload: (() => { try { return JSON.parse(r.payload); } catch { return null; } })(),
      metadata: r.metadata
        ? (() => { try { return JSON.parse(r.metadata!); } catch { return r.metadata; } })()
        : null,
    }));
    respond(req, res, 200, { inputs });
    return;
  }

  if (url === '/api/inputs' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const inputType = typeof body.inputType === 'string' ? body.inputType : null;
      if (!orgId || !inputType || body.payload === undefined) {
        respond(req, res, 400, { error: 'orgId, inputType, and payload required' });
        return;
      }
      const id = insertInput(orgId, {
        inputType,
        source: typeof body.source === 'string' ? body.source : undefined,
        label: typeof body.label === 'string' ? body.label : undefined,
        payload: body.payload,
        metadata: body.metadata,
      });
      respond(req, res, 200, { ok: true, id });
    } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
    return;
  }

  const inputMatch = url.match(/^\/api\/inputs\/(.+)$/);
  if (inputMatch) {
    const inputId = decodeURIComponent(inputMatch[1]);
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    if (req.method === 'GET') {
      const row = getInput(orgId, inputId);
      if (!row) { respond(req, res, 404, { error: 'Not found' }); return; }
      let payload: unknown;
      try { payload = JSON.parse(row.payload); } catch { payload = row.payload; }
      let metadata: unknown = null;
      if (row.metadata) {
        try { metadata = JSON.parse(row.metadata); } catch { metadata = row.metadata; }
      }
      respond(req, res, 200, {
        id: row.id,
        orgId: row.org_id,
        inputType: row.input_type,
        source: row.source,
        label: row.label,
        createdAt: row.created_at,
        payload,
        metadata,
      });
      return;
    }
    if (req.method === 'DELETE') {
      const ok = deleteInput(orgId, inputId);
      respond(req, res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
      return;
    }
  }

  // GET    /api/processed?orgId=&limit=&offset=&pipeline=&inputId=
  // POST   /api/processed { orgId, pipeline, inputId?, label?, payload }
  // GET    /api/processed/:id?orgId=
  // DELETE /api/processed/:id?orgId=
  if (url === '/api/processed' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const rows = listProcessed(orgId, {
      limit:  qs.limit  ? Number(qs.limit)  : 100,
      offset: qs.offset ? Number(qs.offset) : 0,
      pipeline: qs.pipeline,
      inputId: qs.inputId,
    });
    const items = rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      pipeline: r.pipeline,
      inputId: r.input_id,
      label: r.label,
      createdAt: r.created_at,
      payload: (() => { try { return JSON.parse(r.payload); } catch { return null; } })(),
    }));
    respond(req, res, 200, { processed: items });
    return;
  }

  if (url === '/api/audit' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const rows = listProcessed(orgId, {
      limit: qs.limit ? Number(qs.limit) : 200,
      offset: qs.offset ? Number(qs.offset) : 0,
      pipeline: 'audit_events',
    });
    const events = rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      at: r.created_at,
      label: r.label,
      payload: (() => { try { return JSON.parse(r.payload); } catch { return r.payload; } })(),
    }));
    respond(req, res, 200, { events });
    return;
  }

  if (url === '/api/processed' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const pipeline = typeof body.pipeline === 'string' ? body.pipeline : null;
      if (!orgId || !pipeline || body.payload === undefined) {
        respond(req, res, 400, { error: 'orgId, pipeline, and payload required' });
        return;
      }
      const id = insertProcessed(orgId, {
        pipeline,
        inputId: typeof body.inputId === 'string' ? body.inputId : null,
        label: typeof body.label === 'string' ? body.label : undefined,
        payload: body.payload,
      });
      respond(req, res, 200, { ok: true, id });
    } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
    return;
  }

  const processedMatch = url.match(/^\/api\/processed\/(.+)$/);
  if (processedMatch) {
    const rowId = decodeURIComponent(processedMatch[1]);
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    if (req.method === 'GET') {
      const row = getProcessed(orgId, rowId);
      if (!row) { respond(req, res, 404, { error: 'Not found' }); return; }
      let payload: unknown;
      try { payload = JSON.parse(row.payload); } catch { payload = row.payload; }
      respond(req, res, 200, {
        id: row.id,
        orgId: row.org_id,
        pipeline: row.pipeline,
        inputId: row.input_id,
        label: row.label,
        createdAt: row.created_at,
        payload,
      });
      return;
    }
    if (req.method === 'DELETE') {
      const ok = deleteProcessed(orgId, rowId);
      respond(req, res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Org data ──────────────────────────────────────────────────────────────
  const orgMatch = url.match(/^\/api\/org\/([^/]+)(?:\/(.+))?$/);
  if (orgMatch) {
    const orgId = decodeURIComponent(orgMatch[1]);
    const key   = orgMatch[2] ? decodeURIComponent(orgMatch[2]) : null;

    if (req.method === 'GET') {
      if (key) {
        const val = maybeDecryptOrgData(key, getOrgData(orgId, key));
        if (val === null) { respond(req, res, 404, { error: 'Not found' }); return; }
        respond(req, res, 200, { key, value: val });
      } else {
        const orgData = getAllOrgData(orgId);
        for (const dataKey of Object.keys(orgData)) {
          orgData[dataKey] = maybeDecryptOrgData(dataKey, orgData[dataKey]);
        }
        respond(req, res, 200, orgData);
      }
      return;
    }

    if (req.method === 'PUT' && key) {
      try {
        const body = await parseBody(req);
        setOrgData(orgId, key, maybeEncryptOrgData(key, body.value));
        writeAuditEvent({
          req, url, method: req.method, orgId,
          action: 'org_data_put', result: 'success', details: { key },
        });
        respond(req, res, 200, { ok: true });
      } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Orchestrator (non-streaming) ─────────────────────────────────────────────
  if (url === '/api/orchestrator' && req.method === 'POST') {
    if (isRateLimited(req)) {
      respond(req, res, 429, { error: 'Too many requests' });
      return;
    }
    const suzeApiKey = getSuezApiKey();
    if (suzeApiKey && getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const body = await parseBody(req);
      const userMessage = typeof body.userMessage === 'string' ? body.userMessage : '';
      if (!userMessage) { respond(req, res, 400, { error: 'userMessage required' }); return; }
      const sessionId  = typeof body.sessionId === 'string' ? body.sessionId : undefined;
      const orgId      = typeof body.orgId     === 'string' ? body.orgId     : 'default';
      const recentTurns = Array.isArray(body.recentTurns)
        ? body.recentTurns as { role: 'user' | 'assistant'; content: string }[]
        : undefined;
      const { runOrchestrator } = await import('../agents/orchestrator.js');
      const result = await runOrchestrator({ userMessage, sessionId, recentTurns, orgId } as Parameters<typeof runOrchestrator>[0]);
      respond(req, res, 200, result);
    } catch (err) {
      const message = (err as Error).message;
      respond(req, res, message === 'Payload too large' ? 413 : 500, { error: message });
    }
    return;
  }

  // ── Orchestrator (SSE streaming) ──────────────────────────────────────────────
  // POST /api/orchestrator/stream
  // Body: { userMessage, sessionId?, orgId?, recentTurns? }
  // Response: text/event-stream — events: data:{type:'delta',text:'...'} and data:{type:'done',result:{...}}
  if (url === '/api/orchestrator/stream' && req.method === 'POST') {
    if (isRateLimited(req)) {
      respond(req, res, 429, { error: 'Too many requests' });
      return;
    }
    const suzeApiKey = getSuezApiKey();
    if (suzeApiKey && getAuth(req) !== suzeApiKey) {
      respond(req, res, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const body = await parseBody(req);
      const userMessage = typeof body.userMessage === 'string' ? body.userMessage : '';
      if (!userMessage) { respond(req, res, 400, { error: 'userMessage required' }); return; }
      const sessionId  = typeof body.sessionId === 'string' ? body.sessionId : undefined;
      const orgId      = typeof body.orgId     === 'string' ? body.orgId     : 'default';
      const recentTurns = Array.isArray(body.recentTurns)
        ? body.recentTurns as { role: 'user' | 'assistant'; content: string }[]
        : undefined;

      const origin = getRequestOrigin(req);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...(origin && isOriginAllowed(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      });

      const { getOrgContextLine } = await import('../agents/memory/index.js');
      const { streamClaudeOrchestrator } = await import('../services/claudeService.js');

      const stream = streamClaudeOrchestrator({
        userMessage,
        orgContextLine: getOrgContextLine(),
        sessionId,
        orgId,
        recentTurns,
      });

      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      const message = (err as Error).message;
      try { res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`); res.end(); } catch { /* already ended */ }
    }
    return;
  }

  // ── Magic link / OTP login (public) ──────────────────────────────────────────
  // POST /api/auth/magic/request  { orgId, email, role?, appBaseUrl? }
  // POST /api/auth/magic/verify   { orgId, email?, code? } | { orgId, token }

  if (url === '/api/auth/magic/request' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const email = typeof body.email === 'string' ? body.email : '';
      const roleRaw = typeof body.role === 'string' ? body.role : 'auto';
      const preferredRole =
        roleRaw === 'admin' || roleRaw === 'employee' || roleRaw === 'auto'
          ? (roleRaw as MagicRole | 'auto')
          : 'auto';
      if (!orgId) {
        respond(req, res, 400, { error: 'orgId is required' });
        return;
      }
      const identity = resolveMagicIdentityAcrossOrgs(orgId, email, preferredRole);
      if ('error' in identity) {
        respond(req, res, 400, { error: identity.error });
        return;
      }
      const resolvedOrgId = identity.orgId;
      const { challenge, code, token } = createMagicChallenge({ orgId: resolvedOrgId, identity });
      const orgName =
        ((getOrgData(resolvedOrgId, 'suez_company_profile') as { projectName?: string } | null)?.projectName)
        || resolvedOrgId;
      const appBase = resolvePublicAppBaseUrl(
        typeof body.appBaseUrl === 'string' && body.appBaseUrl.trim()
          ? body.appBaseUrl.trim().replace(/\/$/, '')
          : process.env.APP_BASE_URL,
      );
      const magicUrl = `${appBase}/?magic_token=${encodeURIComponent(token)}&orgId=${encodeURIComponent(resolvedOrgId)}`;

      const raw = maybeDecryptOrgData(SMTP_ORG_KEY, getOrgData(resolvedOrgId, SMTP_ORG_KEY));
      const cfg = normalizeSmtpConfig(raw);
      let emailSent = false;
      let sendError: string | undefined;
      const skipSend =
        process.env.MAGIC_AUTH_DEV === '1'
        || process.env.NODE_ENV === 'test';

      if (skipSend) {
        sendError = 'Magic auth dev mode — email not sent.';
      } else if (cfg) {
        try {
          const mail = buildMagicLoginEmail({
            orgName,
            displayName: identity.displayName,
            code,
            magicUrl,
            role: identity.role,
            expiresAt: challenge.expiresAt,
          });
          await sendMail(cfg, { to: identity.email, ...mail });
          emailSent = true;
        } catch (err) {
          sendError = (err as Error).message;
        }
      } else {
        sendError = 'SMTP not configured. Save SMTP settings in Admin Panel first.';
      }

      // Always surface a code when mail fails outside production so login isn't blocked.
      const allowDevCode =
        process.env.MAGIC_AUTH_DEV === '1'
        || process.env.NODE_ENV === 'test'
        || !emailSent;

      if (!emailSent && process.env.NODE_ENV === 'production' && process.env.MAGIC_AUTH_DEV !== '1') {
        respond(req, res, 503, { error: sendError || 'Failed to send sign-in email.' });
        return;
      }

      respond(req, res, 200, {
        ok: true,
        emailSent,
        orgId: resolvedOrgId,
        role: identity.role,
        email: identity.email,
        expiresAt: challenge.expiresAt,
        ...(sendError ? { warning: sendError } : {}),
        ...(allowDevCode && !emailSent ? { devCode: code, magicUrl } : {}),
      });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // Allow verify without a client orgId (magic links / lost pending state)
  if (url === '/api/auth/magic/verify' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' && body.orgId.trim()
        ? body.orgId.trim()
        : 'default';
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      const email = typeof body.email === 'string' ? body.email : '';

      if (!token && (!email || !code)) {
        respond(req, res, 400, { error: 'Provide a magic link token, or email + code.' });
        return;
      }

      const result = token
        ? verifyMagicToken(orgId, token)
        : verifyMagicCode(orgId, email, code);

      if ('error' in result) {
        respond(req, res, 400, { error: result.error });
        return;
      }
      respond(req, res, 200, {
        ok: true,
        session: {
          role: result.role,
          email: result.email,
          orgId: result.orgId,
          displayName: result.displayName,
          employeeId: result.employeeId,
        },
      });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ── SMTP settings ────────────────────────────────────────────────────────────
  // GET  /api/smtp?orgId=          → settings without password
  // PUT  /api/smtp                 → { orgId, settings }
  // POST /api/smtp/test            → { orgId, to? } send test email

  if (url === '/api/smtp' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const raw = getOrgData(orgId, SMTP_ORG_KEY) as Record<string, unknown> | null;
    if (!raw) { respond(req, res, 200, { settings: null }); return; }
    const { password: _pw, ...safe } = raw;
    respond(req, res, 200, {
      settings: {
        ...safe,
        hasPassword: typeof _pw === 'string' && _pw.length > 0,
      },
    });
    return;
  }

  if (url === '/api/smtp' && req.method === 'PUT') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const settings = body.settings;
      if (!orgId || !settings || typeof settings !== 'object') {
        respond(req, res, 400, { error: 'orgId and settings required' });
        return;
      }
      const incoming = settings as Record<string, unknown>;
      const existing = (getOrgData(orgId, SMTP_ORG_KEY) as Record<string, unknown> | null) || {};
      const password =
        typeof incoming.password === 'string' && incoming.password.length > 0
          ? incoming.password
          : (typeof existing.password === 'string' ? existing.password : '');
      const merged = {
        host: String(incoming.host ?? existing.host ?? ''),
        port: Number(incoming.port ?? existing.port ?? 587) || 587,
        secure: Boolean(incoming.secure ?? existing.secure ?? false),
        username: String(incoming.username ?? existing.username ?? ''),
        password,
        fromEmail: String(incoming.fromEmail ?? existing.fromEmail ?? ''),
        fromName: String(incoming.fromName ?? existing.fromName ?? ''),
        replyTo: typeof incoming.replyTo === 'string' ? incoming.replyTo : (existing.replyTo as string | undefined),
        enabled: Boolean(incoming.enabled ?? existing.enabled ?? true),
        updatedAt: new Date().toISOString(),
      };
      setOrgData(orgId, SMTP_ORG_KEY, maybeEncryptOrgData(SMTP_ORG_KEY, merged));
      const { password: _p, ...safe } = merged;
      respond(req, res, 200, { ok: true, settings: { ...safe, hasPassword: !!merged.password } });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/smtp/test' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      const raw = maybeDecryptOrgData(SMTP_ORG_KEY, getOrgData(orgId, SMTP_ORG_KEY));
      const cfg = normalizeSmtpConfig(raw);
      if (!cfg) {
        respond(req, res, 400, { error: 'SMTP is not configured. Save host, username, password, and from email first.' });
        return;
      }
      await verifySmtp(cfg);
      const to = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : cfg.fromEmail;
      const result = await sendMail(cfg, {
        to,
        subject: 'Project Suez — SMTP test',
        text: `This is a test email from Project Suez for organisation ${orgId}.\nSent at ${new Date().toISOString()}.`,
        html: `<p>This is a <strong>test email</strong> from Project Suez for organisation <code>${orgId}</code>.</p><p>Sent at ${new Date().toISOString()}.</p>`,
      });
      respond(req, res, 200, { ok: true, messageId: result.messageId, to });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message || 'Failed to send test email' });
    }
    return;
  }

  // ── Filing reminder notifications (REQ-051 / T-039) ────────────────────────
  if (url === '/api/notifications/filing-reminders' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }

      const tasksRaw = getOrgData(orgId, 'filingTasks');
      const tasks = Array.isArray(tasksRaw) ? (tasksRaw as FilingTask[]) : [];
      const asOfDate = typeof body.asOfDate === 'string' ? body.asOfDate : undefined;
      const dueSoonDays = typeof body.dueSoonDays === 'number' ? body.dueSoonDays : 7;
      const candidates = selectFilingReminders(tasks, asOfDate, dueSoonDays);

      const profile = getOrgData(orgId, 'suez_company_profile') as { projectName?: string } | null;
      const orgName =
        (typeof body.orgName === 'string' && body.orgName.trim())
          ? body.orgName.trim()
          : (profile?.projectName || orgId);

      const mail = buildFilingReminderEmail({
        orgName,
        toName: typeof body.toName === 'string' ? body.toName : undefined,
        candidates,
      });

      if (!mail) {
        respond(req, res, 200, {
          ok: true,
          sent: false,
          reason: 'no_reminders',
          candidates: [],
        });
        return;
      }

      if (body.dryRun === true) {
        respond(req, res, 200, {
          ok: true,
          sent: false,
          dryRun: true,
          candidates,
          email: mail,
        });
        return;
      }

      const to = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : null;
      if (!to) {
        respond(req, res, 400, { error: 'to email required (or pass dryRun: true)', candidates, email: mail });
        return;
      }

      const raw = maybeDecryptOrgData(SMTP_ORG_KEY, getOrgData(orgId, SMTP_ORG_KEY));
      const cfg = normalizeSmtpConfig(raw);
      if (!cfg) {
        respond(req, res, 400, {
          error: 'SMTP is not configured. Save host, username, password, and from email first.',
          candidates,
          email: mail,
        });
        return;
      }

      const result = await sendMail(cfg, {
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'filing_reminder_send',
        result: 'success',
        details: { to, candidateCount: candidates.length },
      });
      respond(req, res, 200, {
        ok: true,
        sent: true,
        messageId: result.messageId,
        to,
        candidates,
      });
    } catch (err) {
      respond(req, res, 500, { error: (err as Error).message || 'Failed to send filing reminders' });
    }
    return;
  }

  // ── Leave requests (durable org_data; employee self-service) ───────────────
  // GET  /api/leave-requests?orgId=
  // POST /api/leave-requests { orgId, request }
  // PUT  /api/leave-requests/:id { orgId, updates }
  const LEAVE_KEY = 'suez_leave_requests';

  if (url === '/api/leave-requests' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const raw = getOrgData(orgId, LEAVE_KEY);
    const list = Array.isArray(raw) ? raw : [];
    const role = getRequestRole(req);
    if (role === 'employee') {
      const sessionEmpHeader = req.headers['x-suez-employee-id'];
      const sessionEmployeeId = typeof sessionEmpHeader === 'string' ? sessionEmpHeader.trim() : '';
      respond(req, res, 200, {
        leaveRequests: list.filter((r) =>
          r && typeof r === 'object' && (r as { employeeId?: string }).employeeId === sessionEmployeeId
        ),
      });
      return;
    }
    respond(req, res, 200, { leaveRequests: list });
    return;
  }

  if (url === '/api/leave-requests' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const request = body.request && typeof body.request === 'object'
        ? (body.request as Record<string, unknown>)
        : null;
      if (!orgId || !request || typeof request.id !== 'string' || typeof request.employeeId !== 'string') {
        respond(req, res, 400, { error: 'orgId and request{id,employeeId,...} required' });
        return;
      }
      const role = getRequestRole(req);
      if (role === 'employee') {
        const sessionEmpHeader = req.headers['x-suez-employee-id'];
        const sessionEmployeeId = typeof sessionEmpHeader === 'string' ? sessionEmpHeader.trim() : '';
        if (!sessionEmployeeId || sessionEmployeeId !== request.employeeId) {
          respond(req, res, 403, { error: 'Employees may only create their own leave requests' });
          return;
        }
        request.status = 'Pending';
      }
      const existing = getOrgData(orgId, LEAVE_KEY);
      const list = Array.isArray(existing) ? [...existing as Record<string, unknown>[]] : [];
      const idx = list.findIndex((r) => r && (r as { id?: string }).id === request.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...request };
      else list.unshift(request);
      setOrgData(orgId, LEAVE_KEY, list);
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'leave_request_upsert', result: 'success', details: { id: request.id },
      });
      respond(req, res, 200, { ok: true, request });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  const leaveMatch = url.match(/^\/api\/leave-requests\/([^/]+)$/);
  if (leaveMatch && req.method === 'PUT') {
    try {
      const leaveId = decodeURIComponent(leaveMatch[1]);
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const updates = body.updates && typeof body.updates === 'object'
        ? (body.updates as Record<string, unknown>)
        : null;
      if (!orgId || !updates) {
        respond(req, res, 400, { error: 'orgId and updates{} required' });
        return;
      }
      const existing = getOrgData(orgId, LEAVE_KEY);
      const list = Array.isArray(existing) ? [...existing as Record<string, unknown>[]] : [];
      const idx = list.findIndex((r) => r && (r as { id?: string }).id === leaveId);
      if (idx < 0) {
        respond(req, res, 404, { error: 'Leave request not found' });
        return;
      }
      const current = list[idx] as Record<string, unknown>;
      const role = getRequestRole(req);
      if (role === 'employee') {
        const sessionEmpHeader = req.headers['x-suez-employee-id'];
        const sessionEmployeeId = typeof sessionEmpHeader === 'string' ? sessionEmpHeader.trim() : '';
        if (!sessionEmployeeId || current.employeeId !== sessionEmployeeId) {
          respond(req, res, 403, { error: 'Employees may only update their own leave requests' });
          return;
        }
        // Employees may only cancel pending requests
        const nextStatus = updates.status;
        if (nextStatus !== undefined && nextStatus !== 'Cancelled') {
          respond(req, res, 403, { error: 'Employees may only cancel leave requests' });
          return;
        }
        if (current.status !== 'Pending' && nextStatus === 'Cancelled') {
          respond(req, res, 422, { error: 'Only pending leave can be cancelled' });
          return;
        }
        list[idx] = { ...current, status: 'Cancelled' };
      } else {
        list[idx] = { ...current, ...updates, id: leaveId, employeeId: current.employeeId };
      }
      setOrgData(orgId, LEAVE_KEY, list);
      writeAuditEvent({
        req, url, method: req.method, orgId,
        action: 'leave_request_update', result: 'success', details: { id: leaveId },
      });
      respond(req, res, 200, { ok: true, request: list[idx] });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  // ── Employee invites ─────────────────────────────────────────────────────────
  // GET    /api/invites?orgId=
  // POST   /api/invites  { orgId, email, name?, designation?, ... }
  // DELETE /api/invites/:id?orgId=
  // GET    /api/invites/token/:token   (public — invitee)
  // POST   /api/invites/token/:token/complete  (public — submit profile)

  if (url === '/api/invites' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const rows = listInvites(orgId);
    const invites = rows.map((r) => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(r.data) as Record<string, unknown>; } catch { /* */ }
      return {
        id: r.id,
        token: r.token,
        orgId: r.org_id,
        email: r.email,
        status: r.status,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        ...data,
      };
    });
    respond(req, res, 200, { invites });
    return;
  }

  if (url === '/api/invites' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const orgId = typeof body.orgId === 'string' ? body.orgId : null;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!orgId || !email || !email.includes('@')) {
        respond(req, res, 400, { error: 'orgId and a valid email are required' });
        return;
      }
      const orgName =
        typeof body.orgName === 'string' && body.orgName.trim()
          ? body.orgName.trim()
          : ((getOrgData(orgId, 'suez_company_profile') as { projectName?: string } | null)?.projectName
            || orgId);
      const id = randomUUID();
      const token = randomBytes(24).toString('hex');
      const expiresDays = typeof body.expiresDays === 'number' && body.expiresDays > 0 ? body.expiresDays : 14;
      const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
      const inviteData: Record<string, unknown> = {
        orgName,
        name: typeof body.name === 'string' ? body.name.trim() : undefined,
        designation: typeof body.designation === 'string' ? body.designation.trim() : undefined,
        department: typeof body.department === 'string' ? body.department.trim() : undefined,
        ctc: typeof body.ctc === 'number' ? body.ctc : undefined,
        doj: typeof body.doj === 'string' ? body.doj : undefined,
        employeeType: typeof body.employeeType === 'string' ? body.employeeType : 'Full-time',
      };
      upsertInvite({
        id,
        token,
        orgId,
        email,
        status: 'pending',
        expiresAt,
        data: inviteData,
      });

      const appBase = resolvePublicAppBaseUrl(
        typeof body.appBaseUrl === 'string' && body.appBaseUrl.trim()
          ? body.appBaseUrl.trim().replace(/\/$/, '')
          : process.env.APP_BASE_URL,
      );
      const inviteUrl = `${appBase}/#/join?token=${token}`;

      let sent = false;
      let sendError: string | undefined;
      const smtpRaw = getOrgData(orgId, SMTP_ORG_KEY);
      const cfg = normalizeSmtpConfig(smtpRaw);
      if (cfg) {
        try {
          const mail = buildInviteEmail({
            orgName,
            inviteeName: inviteData.name as string | undefined,
            inviteUrl,
            expiresAt,
            designation: inviteData.designation as string | undefined,
          });
          await sendMail(cfg, { to: email, ...mail });
          sent = true;
          updateInviteStatus(token, 'sent', { sentAt: new Date().toISOString() });
        } catch (err) {
          sendError = (err as Error).message;
          updateInviteStatus(token, 'pending', { lastError: sendError });
        }
      } else {
        sendError = 'SMTP not configured — invite created but email was not sent.';
      }

      respond(req, res, 200, {
        ok: true,
        invite: {
          id,
          token,
          orgId,
          email,
          status: sent ? 'sent' : 'pending',
          expiresAt,
          inviteUrl,
          ...inviteData,
          lastError: sendError,
        },
        emailSent: sent,
        error: sendError,
      });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  const inviteIdMatch = url.match(/^\/api\/invites\/([^/]+)$/);
  if (inviteIdMatch && inviteIdMatch[1] !== 'token' && req.method === 'DELETE') {
    const inviteId = decodeURIComponent(inviteIdMatch[1]);
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    const ok = deleteInvite(orgId, inviteId);
    respond(req, res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
    return;
  }

  const inviteTokenMatch = url.match(/^\/api\/invites\/token\/([^/]+)(?:\/(complete))?$/);
  if (inviteTokenMatch) {
    const token = decodeURIComponent(inviteTokenMatch[1]);
    const action = inviteTokenMatch[2];

    if (req.method === 'GET' && !action) {
      const row = getInviteByToken(token);
      if (!row) { respond(req, res, 404, { error: 'Invite not found' }); return; }
      if (row.status === 'revoked') { respond(req, res, 410, { error: 'Invite was revoked' }); return; }
      if (row.status === 'accepted') { respond(req, res, 410, { error: 'Invite already accepted' }); return; }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        updateInviteStatus(token, 'expired');
        respond(req, res, 410, { error: 'Invite has expired' });
        return;
      }
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(row.data) as Record<string, unknown>; } catch { /* */ }
      respond(req, res, 200, {
        invite: {
          email: row.email,
          orgId: row.org_id,
          orgName: data.orgName || row.org_id,
          name: data.name,
          designation: data.designation,
          department: data.department,
          ctc: data.ctc,
          doj: data.doj,
          employeeType: data.employeeType,
          expiresAt: row.expires_at,
          status: row.status,
        },
      });
      return;
    }

    if (req.method === 'POST' && action === 'complete') {
      try {
        const row = getInviteByToken(token);
        if (!row) { respond(req, res, 404, { error: 'Invite not found' }); return; }
        if (row.status === 'accepted') { respond(req, res, 410, { error: 'Invite already accepted' }); return; }
        if (row.status === 'revoked') { respond(req, res, 410, { error: 'Invite was revoked' }); return; }
        if (new Date(row.expires_at).getTime() < Date.now()) {
          updateInviteStatus(token, 'expired');
          respond(req, res, 410, { error: 'Invite has expired' });
          return;
        }
        const body = await parseBody(req);
        const profile = (body.profile && typeof body.profile === 'object')
          ? body.profile as Record<string, unknown>
          : body;
        const name = typeof profile.name === 'string' ? profile.name.trim() : '';
        if (!name) { respond(req, res, 400, { error: 'Full name is required' }); return; }

        let inviteMeta: Record<string, unknown> = {};
        try { inviteMeta = JSON.parse(row.data) as Record<string, unknown>; } catch { /* */ }

        const employeeId = randomUUID();
        const docs = Array.isArray(profile.uploadedDocuments) ? profile.uploadedDocuments as { kind?: string }[] : [];
        const documents = {
          pan: Boolean(typeof profile.panNumber === 'string' && profile.panNumber.trim()),
          aadhaar: Boolean(typeof profile.aadhaarNumber === 'string' && profile.aadhaarNumber.trim()),
          contract: docs.some((d) => d?.kind === 'contract'),
        };
        const designation =
          (typeof profile.designation === 'string' && profile.designation.trim())
            ? profile.designation.trim()
            : (typeof inviteMeta.designation === 'string' && inviteMeta.designation
              ? String(inviteMeta.designation)
              : 'Team Member');
        const rawCtc = typeof profile.ctc === 'number'
          ? profile.ctc
          : (typeof inviteMeta.ctc === 'number' ? inviteMeta.ctc : 0);
        const ctc = rawCtc > 0 ? rawCtc : 1;
        const employee = {
          id: employeeId,
          name,
          email: row.email,
          designation,
          ctc,
          doj: typeof profile.doj === 'string' && profile.doj
            ? profile.doj
            : (typeof inviteMeta.doj === 'string' ? inviteMeta.doj : new Date().toISOString().slice(0, 10)),
          status: 'Onboarding',
          documents,
          panNumber: typeof profile.panNumber === 'string' ? profile.panNumber : undefined,
          aadhaarNumber: typeof profile.aadhaarNumber === 'string' ? profile.aadhaarNumber : undefined,
          uan: typeof profile.uan === 'string' ? profile.uan : undefined,
          esiNumber: typeof profile.esiNumber === 'string' ? profile.esiNumber : undefined,
          bankAccountNumber: typeof profile.bankAccountNumber === 'string' ? profile.bankAccountNumber : undefined,
          bankIFSC: typeof profile.bankIFSC === 'string' ? profile.bankIFSC : undefined,
          bankName: typeof profile.bankName === 'string' ? profile.bankName : undefined,
          dateOfBirth: typeof profile.dateOfBirth === 'string' ? profile.dateOfBirth : undefined,
          gender: typeof profile.gender === 'string' ? profile.gender : undefined,
          phone: typeof profile.phone === 'string' ? profile.phone : undefined,
          address: typeof profile.address === 'string' ? profile.address : undefined,
          fatherOrSpouseName: typeof profile.fatherOrSpouseName === 'string' ? profile.fatherOrSpouseName : undefined,
          employeeType: typeof profile.employeeType === 'string'
            ? profile.employeeType
            : (inviteMeta.employeeType || 'Full-time'),
          department: typeof profile.department === 'string'
            ? profile.department
            : (typeof inviteMeta.department === 'string' ? inviteMeta.department : undefined),
          taxRegime: typeof profile.taxRegime === 'string' ? profile.taxRegime : 'new',
          inviteId: row.id,
          onboardedViaInviteAt: new Date().toISOString(),
          uploadedDocuments: docs,
        };

        upsertEmployee(row.org_id, encryptEmployeePII(employee as Record<string, unknown>));
        updateInviteStatus(token, 'accepted', {
          acceptedAt: new Date().toISOString(),
          employeeId,
        });

        respond(req, res, 200, { ok: true, employeeId, status: 'Onboarding' });
      } catch (err) {
        respond(req, res, 400, { error: (err as Error).message });
      }
      return;
    }
  }

  respond(req, res, 404, { error: 'Not found' });
}

export function createServer() {
  rateWindowByIp.clear();
  return http.createServer((req, res) => {
    const started = Date.now();
    const pathOnly = req.url?.split('?')[0] ?? '';
    void handleRequest(req, res).finally(() => {
      if (pathOnly === '/api/slo/metrics') return;
      recordSloSample({
        operation: classifyHttpPath(pathOnly),
        durationMs: Date.now() - started,
        ok: (res.statusCode ?? 500) < 500,
        label: `${req.method ?? 'GET'} ${pathOnly}`,
      });
    });
  });
}

if (!process.env.VITEST) {
  try {
    const summary = rebuildKvFromDomain();
    checkpointDatabase();
    console.log(`[db] Snapshot ready org=${summary.orgId} employees=${summary.employees} transactions=${summary.transactions}`);
  } catch (err) {
    console.warn('[db] snapshot rebuild failed:', (err as Error).message);
  }
  const server = createServer();
  server.listen(PORT, HOST, () => {
    const keyIsSet = getSuezApiKey() ? 'set' : 'not set';
    const geminiSet = (process.env.API_KEY || process.env.GEMINI_API_KEY) ? 'set' : 'not set';
    console.log(`Suez API listening on http://localhost:${PORT} (bind ${HOST}, SUEZ_API_KEY ${keyIsSet}, GEMINI_API_KEY ${geminiSet})`);
    for (const name of Object.keys(os.networkInterfaces())) {
      for (const net of os.networkInterfaces()[name] ?? []) {
        if (net.family !== 'IPv4' || net.internal) continue;
        console.log(`  LAN: http://${net.address}:${PORT}`);
      }
    }
  });
}
