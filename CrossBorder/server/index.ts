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

import http from 'node:http';
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
  checkpointDatabase,
} from './db.js';
import {
  TransactionSchema, TransactionUpdateSchema,
  EmployeeSchema, EmployeeUpdateSchema,
  PayrollRunSchema, InvoiceSchema,
  validate, validateArray,
} from './schemas.js';
import { reconcileOrg } from './reconciliation.js';
import { syncStripeToSqlite, type StripeOrgConfigInput } from './stripeSqliteSync.js';
import { buildInviteEmail, normalizeSmtpConfig, sendMail, verifySmtp } from './mail.js';
import { rebuildKvFromDomain } from './rebuildKv.js';

const PORT = Number(process.env.PORT) || 3001;
const getSuezApiKey = () => process.env.SUEZ_API_KEY || '';
const getMaxBodyBytes = () => Number(process.env.MAX_BODY_BYTES) || 10_000_000; // 10 MB — large org/revenue payloads can exceed 2 MB
const getRateLimitWindowMs = () => Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const getRateLimitMax = () => Number(process.env.RATE_LIMIT_MAX) || 60;
const getCorsOrigins = () => (process.env.CORS_ORIGINS || 'http://localhost:9000,http://127.0.0.1:9000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const rateWindowByIp = new Map<string, number[]>();

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

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // same-origin/non-browser clients
  return getCorsOrigins().includes(origin);
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    });
    res.end();
    return;
  }

  const url = req.url?.split('?')[0] ?? '';

  if (url === '/api/health') {
    respond(req, res, 200, { ok: true, ts: new Date().toISOString() });
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
      respond(req, res, 200, { ok: true });
    } catch (err) {
      respond(req, res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/storage' && req.method === 'DELETE') {
    clearKV();
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
      if (Array.isArray(body.transactions)) {
        const validationErrors = validateArray(TransactionSchema, body.transactions);
        if (validationErrors.length) {
          respond(req, res, 422, { error: 'Validation failed for some transactions', validationErrors });
          return;
        }
        bulkUpsertTransactions(orgId, body.transactions as Record<string, unknown>[]);
        respond(req, res, 200, { ok: true, count: body.transactions.length });
      } else if (body.transaction) {
        const err = validate(TransactionSchema, body.transaction);
        if (err) { respond(req, res, 422, { error: err }); return; }
        upsertTransaction(orgId, body.transaction as Record<string, unknown>);
        respond(req, res, 200, { ok: true });
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
        respond(req, res, 200, { ok: true });
      } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
      return;
    }
    if (req.method === 'DELETE') {
      const orgId = qs.orgId;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      deleteTransaction(orgId, txId);
      respond(req, res, 200, { ok: true });
      return;
    }
  }

  // ── Employees ─────────────────────────────────────────────────────────────
  if (url === '/api/employees' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, { employees: getEmployees(orgId) });
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
        bulkUpsertEmployees(orgId, body.employees as Record<string, unknown>[]);
        respond(req, res, 200, { ok: true, count: body.employees.length });
      } else if (body.employee) {
        const err = validate(EmployeeSchema, body.employee);
        if (err) { respond(req, res, 422, { error: err }); return; }
        upsertEmployee(orgId, body.employee as Record<string, unknown>);
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
        const err = validate(EmployeeUpdateSchema, body.employee);
        if (err) { respond(req, res, 422, { error: err }); return; }
        upsertEmployee(orgId, body.employee as Record<string, unknown>);
        respond(req, res, 200, { ok: true });
      } catch (err) { respond(req, res, 400, { error: (err as Error).message }); }
      return;
    }
    if (req.method === 'DELETE') {
      const orgId = qs.orgId;
      if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
      deleteEmployee(orgId, empId);
      respond(req, res, 200, { ok: true });
      return;
    }
  }

  // ── Payroll runs ──────────────────────────────────────────────────────────
  if (url === '/api/payroll' && req.method === 'GET') {
    const orgId = qs.orgId;
    if (!orgId) { respond(req, res, 400, { error: 'orgId required' }); return; }
    respond(req, res, 200, { runs: getPayrollRuns(orgId) });
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
    respond(req, res, 200, { ok: true });
    return;
  }

  // ── Reconciliation ────────────────────────────────────────────────────────
  // GET /api/reconciliation?orgId=&persist=true   → run checks; optional SQLite snapshot
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
        const val = getOrgData(orgId, key);
        if (val === null) { respond(req, res, 404, { error: 'Not found' }); return; }
        respond(req, res, 200, { key, value: val });
      } else {
        respond(req, res, 200, getAllOrgData(orgId));
      }
      return;
    }

    if (req.method === 'PUT' && key) {
      try {
        const body = await parseBody(req);
        setOrgData(orgId, key, body.value);
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

  // ── SMTP settings ────────────────────────────────────────────────────────────
  // GET  /api/smtp?orgId=          → settings without password
  // PUT  /api/smtp                 → { orgId, settings }
  // POST /api/smtp/test            → { orgId, to? } send test email
  const SMTP_ORG_KEY = 'suez_smtp_settings';

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
      setOrgData(orgId, SMTP_ORG_KEY, merged);
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
      const raw = getOrgData(orgId, SMTP_ORG_KEY);
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

      const appBase =
        typeof body.appBaseUrl === 'string' && body.appBaseUrl.trim()
          ? body.appBaseUrl.trim().replace(/\/$/, '')
          : (process.env.APP_BASE_URL || 'http://localhost:9000');
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

        upsertEmployee(row.org_id, employee as Record<string, unknown>);
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
  return http.createServer(handleRequest);
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
  server.listen(PORT, () => {
    const keyIsSet = getSuezApiKey() ? 'set' : 'not set';
    console.log(`Suez API listening on http://localhost:${PORT} (SUEZ_API_KEY ${keyIsSet})`);
  });
}
