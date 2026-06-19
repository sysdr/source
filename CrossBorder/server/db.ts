/**
 * SQLite persistence layer for CrossBorder ERP.
 *
 * Architecture:
 *   kv_store         — legacy blob KV (kept for backward compat + UI state)
 *   transactions     — indexed domain table (fast filter/pagination)
 *   employees        — per-org employee records
 *   payroll_runs     — payroll run history
 *   invoices         — O2C invoices
 *   org_data         — org config blobs (profile, stripe, mercury, etc.)
 *   reports          — snapshots (reconciliation, exports, custom)
 *   inputs           — raw user/API inputs before processing
 *   processed_data   — pipeline outputs linked optionally to an input
 *
 * On first start, migrateFromKV() populates domain tables from kv_store blobs.
 * DB file: ./data/suez.db (override via DB_PATH env var)
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'suez.db');
mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  -- Legacy KV store (kept for UI state, misc config, backward compat)
  CREATE TABLE IF NOT EXISTS kv_store (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Transactions: key fields as columns for fast filtering + full JSON for completeness
  CREATE TABLE IF NOT EXISTS transactions (
    id              TEXT NOT NULL,
    org_id          TEXT NOT NULL,
    date            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK(type IN ('Income','Expense','Purchase')),
    amount          REAL NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'INR',
    source          TEXT NOT NULL DEFAULT 'Manual',
    status          TEXT DEFAULT 'Completed',
    category        TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    entity          TEXT DEFAULT 'parent',
    stripe_charge_id TEXT,
    stripe_account_id TEXT,
    original_amount  REAL,
    original_currency TEXT,
    fx_rate          REAL,
    deleted          INTEGER NOT NULL DEFAULT 0,
    data            TEXT NOT NULL,  -- full JSON blob for all remaining fields
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, org_id)
  );
  CREATE INDEX IF NOT EXISTS idx_txn_org_date    ON transactions(org_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_txn_org_type    ON transactions(org_id, type);
  CREATE INDEX IF NOT EXISTS idx_txn_org_source  ON transactions(org_id, source);
  CREATE INDEX IF NOT EXISTS idx_txn_org_status  ON transactions(org_id, status);
  CREATE INDEX IF NOT EXISTS idx_txn_stripe      ON transactions(stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;

  -- Employees
  CREATE TABLE IF NOT EXISTS employees (
    id       TEXT NOT NULL,
    org_id   TEXT NOT NULL,
    name     TEXT NOT NULL,
    status   TEXT NOT NULL DEFAULT 'Active',
    data     TEXT NOT NULL,  -- full JSON blob
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, org_id)
  );
  CREATE INDEX IF NOT EXISTS idx_emp_org ON employees(org_id);

  -- Payroll runs
  CREATE TABLE IF NOT EXISTS payroll_runs (
    id       TEXT NOT NULL,
    org_id   TEXT NOT NULL,
    period   TEXT NOT NULL,   -- "YYYY-MM"
    run_at   TEXT NOT NULL,
    status   TEXT NOT NULL DEFAULT 'Completed',
    data     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, org_id)
  );
  CREATE INDEX IF NOT EXISTS idx_pay_org_period ON payroll_runs(org_id, period DESC);

  -- Invoices (O2C)
  CREATE TABLE IF NOT EXISTS invoices (
    id            TEXT NOT NULL,
    org_id        TEXT NOT NULL,
    number        TEXT NOT NULL,
    date          TEXT NOT NULL,
    due_date      TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'Draft',
    currency      TEXT NOT NULL DEFAULT 'INR',
    total         REAL NOT NULL DEFAULT 0,
    data          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, org_id)
  );
  CREATE INDEX IF NOT EXISTS idx_inv_org_date   ON invoices(org_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_inv_org_status ON invoices(org_id, status);

  -- Org config (one JSON row per key per org — replaces kv_store for org-scoped blobs)
  CREATE TABLE IF NOT EXISTS org_data (
    org_id     TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (org_id, key)
  );
  CREATE INDEX IF NOT EXISTS idx_org_data_org ON org_data(org_id);

  -- Agent session messages (persistent Claude conversation history)
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    org_id     TEXT NOT NULL DEFAULT 'default',
    role       TEXT NOT NULL,   -- 'user' | 'assistant'
    content    TEXT NOT NULL,   -- JSON (Claude MessageParam content)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_session_org ON agent_sessions(session_id, org_id);

  -- Report snapshots (reconciliation runs, generated exports, etc.)
  CREATE TABLE IF NOT EXISTS reports (
    id           TEXT PRIMARY KEY NOT NULL,
    org_id       TEXT NOT NULL,
    report_type  TEXT NOT NULL DEFAULT 'reconciliation',
    label        TEXT,
    payload      TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reports_org_created ON reports(org_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_org_type     ON reports(org_id, report_type);

  -- Raw inputs (uploads, form payloads, sync batches) before transformation
  CREATE TABLE IF NOT EXISTS inputs (
    id          TEXT PRIMARY KEY NOT NULL,
    org_id      TEXT NOT NULL,
    input_type  TEXT NOT NULL,
    source      TEXT,
    label       TEXT,
    payload     TEXT NOT NULL,
    metadata    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_inputs_org_created ON inputs(org_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inputs_org_type    ON inputs(org_id, input_type);

  -- Processed / derived data (ETL outputs, AI extractions, reconciled views)
  CREATE TABLE IF NOT EXISTS processed_data (
    id          TEXT PRIMARY KEY NOT NULL,
    org_id      TEXT NOT NULL,
    pipeline    TEXT NOT NULL,
    input_id    TEXT,
    label       TEXT,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_processed_org_created ON processed_data(org_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_processed_pipeline     ON processed_data(org_id, pipeline);
  CREATE INDEX IF NOT EXISTS idx_processed_input        ON processed_data(input_id) WHERE input_id IS NOT NULL;

  -- Migration tracker
  CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ─── KV store (legacy) ────────────────────────────────────────────────────────

const stmtKVGetAll  = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM kv_store');
const stmtKVSet     = db.prepare<[string, string]>(`
  INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const stmtKVDelete  = db.prepare<[string]>('DELETE FROM kv_store WHERE key = ?');
const stmtKVClear   = db.prepare('DELETE FROM kv_store');

export function getAllKV(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const row of stmtKVGetAll.all()) {
    try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
  }
  return result;
}
export function setKV(key: string, value: unknown): void { stmtKVSet.run(key, JSON.stringify(value)); }
export function deleteKV(key: string): void              { stmtKVDelete.run(key); }
export function clearKV(): void                          { stmtKVClear.run(); }

// ─── Transactions ─────────────────────────────────────────────────────────────

export interface TxnRow {
  id: string; org_id: string; date: string; type: string; amount: number;
  currency: string; source: string; status: string; category: string;
  description: string; entity: string; stripe_charge_id: string | null;
  stripe_account_id: string | null; original_amount: number | null;
  original_currency: string | null; fx_rate: number | null;
  deleted: number; data: string;
}

export interface TxnFilters {
  orgId: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  type?: string;
  source?: string;
  status?: string;
  includeDeleted?: boolean;
  search?: string;
}

export function getTransactionCount(orgId: string, includeDeleted = false): number {
  const stmt = db.prepare<[string, number]>(
    'SELECT COUNT(*) as cnt FROM transactions WHERE org_id = ? AND deleted = ?'
  );
  const row = stmt.get(orgId, includeDeleted ? 1 : 0) as { cnt: number };
  return row?.cnt ?? 0;
}

export function queryTransactions(f: TxnFilters): unknown[] {
  const conditions: string[] = ['org_id = ?'];
  const params: unknown[] = [f.orgId];

  if (!f.includeDeleted) { conditions.push('deleted = 0'); }
  if (f.startDate)       { conditions.push('date >= ?'); params.push(f.startDate); }
  if (f.endDate)         { conditions.push('date <= ?'); params.push(f.endDate); }
  if (f.type)            { conditions.push('type = ?'); params.push(f.type); }
  if (f.source)          { conditions.push('source = ?'); params.push(f.source); }
  if (f.status)          { conditions.push('status = ?'); params.push(f.status); }
  if (f.search) {
    conditions.push("(description LIKE ? OR category LIKE ?)");
    params.push(`%${f.search}%`, `%${f.search}%`);
  }

  const where = conditions.join(' AND ');
  const limit  = Math.min(f.limit  ?? 500, 2000);
  const offset = f.offset ?? 0;

  const rows = db.prepare(
    `SELECT data FROM transactions WHERE ${where} ORDER BY date DESC, rowid DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as { data: string }[];

  return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
}

export function upsertTransaction(orgId: string, tx: Record<string, unknown>): void {
  const id = tx.id as string;
  db.prepare(`
    INSERT INTO transactions
      (id, org_id, date, type, amount, currency, source, status, category,
       description, entity, stripe_charge_id, stripe_account_id,
       original_amount, original_currency, fx_rate, deleted, data, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id, org_id) DO UPDATE SET
      date=excluded.date, type=excluded.type, amount=excluded.amount,
      currency=excluded.currency, source=excluded.source, status=excluded.status,
      category=excluded.category, description=excluded.description, entity=excluded.entity,
      stripe_charge_id=excluded.stripe_charge_id, stripe_account_id=excluded.stripe_account_id,
      original_amount=excluded.original_amount, original_currency=excluded.original_currency,
      fx_rate=excluded.fx_rate, deleted=excluded.deleted,
      data=excluded.data, updated_at=datetime('now')
  `).run(
    id, orgId,
    tx.date ?? '', tx.type ?? 'Income',
    Number(tx.amount) || 0, tx.currency ?? 'INR',
    tx.source ?? 'Manual', tx.status ?? 'Completed',
    tx.category ?? '', tx.description ?? '', tx.entity ?? 'parent',
    tx.stripeChargeId ?? null, tx.stripeAccountId ?? null,
    tx.originalAmount ?? null, tx.originalCurrency ?? null,
    tx.fxRate ?? null,
    tx.deleted ? 1 : 0,
    JSON.stringify(tx)
  );
}

export function bulkUpsertTransactions(orgId: string, txns: Record<string, unknown>[]): void {
  const run = db.transaction(() => { for (const tx of txns) upsertTransaction(orgId, tx); });
  run();
}

export function deleteTransaction(orgId: string, txId: string): void {
  db.prepare('DELETE FROM transactions WHERE id = ? AND org_id = ?').run(txId, orgId);
}

/** Remove all ledger rows for an org (e.g. full reset before server-side Stripe re-import). */
export function deleteAllTransactionsForOrg(orgId: string): number {
  const info = db.prepare('DELETE FROM transactions WHERE org_id = ?').run(orgId);
  return info.changes;
}

/** Remove rows by source column (e.g. Stripe-only purge before direct SQLite sync). */
export function deleteTransactionsByOrgAndSource(orgId: string, source: string): number {
  const info = db.prepare('DELETE FROM transactions WHERE org_id = ? AND source = ?').run(orgId, source);
  return info.changes;
}

// ─── Employees ────────────────────────────────────────────────────────────────

export function getEmployees(orgId: string): unknown[] {
  const rows = db.prepare(
    'SELECT data FROM employees WHERE org_id = ? ORDER BY name'
  ).all(orgId) as { data: string }[];
  return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
}

export function upsertEmployee(orgId: string, emp: Record<string, unknown>): void {
  db.prepare(`
    INSERT INTO employees (id, org_id, name, status, data, updated_at)
    VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(id, org_id) DO UPDATE SET
      name=excluded.name, status=excluded.status,
      data=excluded.data, updated_at=datetime('now')
  `).run(emp.id, orgId, emp.name ?? '', emp.status ?? 'Active', JSON.stringify(emp));
}

export function bulkUpsertEmployees(orgId: string, emps: Record<string, unknown>[]): void {
  const run = db.transaction(() => { for (const e of emps) upsertEmployee(orgId, e); });
  run();
}

export function deleteEmployee(orgId: string, empId: string): void {
  db.prepare('DELETE FROM employees WHERE id = ? AND org_id = ?').run(empId, orgId);
}

// ─── Payroll runs ─────────────────────────────────────────────────────────────

export function getPayrollRuns(orgId: string): unknown[] {
  const rows = db.prepare(
    'SELECT data FROM payroll_runs WHERE org_id = ? ORDER BY period DESC'
  ).all(orgId) as { data: string }[];
  return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
}

export function upsertPayrollRun(orgId: string, run: Record<string, unknown>): void {
  const period = `${run.year ?? ''}-${String(run.month ?? '').padStart(2, '0')}`;
  db.prepare(`
    INSERT INTO payroll_runs (id, org_id, period, run_at, status, data)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(id, org_id) DO UPDATE SET
      period=excluded.period, run_at=excluded.run_at,
      status=excluded.status, data=excluded.data
  `).run(run.id, orgId, period, run.runAt ?? '', run.status ?? 'Completed', JSON.stringify(run));
}

export function deletePayrollRun(orgId: string, runId: string): void {
  db.prepare('DELETE FROM payroll_runs WHERE id = ? AND org_id = ?').run(runId, orgId);
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export function getInvoicesDB(orgId: string, status?: string): unknown[] {
  const rows = status
    ? db.prepare('SELECT data FROM invoices WHERE org_id = ? AND status = ? ORDER BY date DESC').all(orgId, status) as { data: string }[]
    : db.prepare('SELECT data FROM invoices WHERE org_id = ? ORDER BY date DESC').all(orgId) as { data: string }[];
  return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
}

export function upsertInvoice(orgId: string, inv: Record<string, unknown>): void {
  db.prepare(`
    INSERT INTO invoices (id, org_id, number, date, due_date, customer_name, status, currency, total, data, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id, org_id) DO UPDATE SET
      number=excluded.number, date=excluded.date, due_date=excluded.due_date,
      customer_name=excluded.customer_name, status=excluded.status,
      currency=excluded.currency, total=excluded.total,
      data=excluded.data, updated_at=datetime('now')
  `).run(
    inv.id, orgId, inv.number ?? '', inv.date ?? '', inv.dueDate ?? '',
    inv.customerName ?? '', inv.status ?? 'Draft', inv.currency ?? 'INR',
    Number(inv.total) || 0, JSON.stringify(inv)
  );
}

export function deleteInvoice(orgId: string, invId: string): void {
  db.prepare('DELETE FROM invoices WHERE id = ? AND org_id = ?').run(invId, orgId);
}

// ─── Org data (config blobs) ──────────────────────────────────────────────────

export function getOrgData(orgId: string, key: string): unknown | null {
  const row = db.prepare('SELECT value FROM org_data WHERE org_id = ? AND key = ?').get(orgId, key) as { value: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setOrgData(orgId: string, key: string, value: unknown): void {
  db.prepare(`
    INSERT INTO org_data (org_id, key, value, updated_at) VALUES (?,?,?,datetime('now'))
    ON CONFLICT(org_id, key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(orgId, key, JSON.stringify(value));
}

export function getAllOrgData(orgId: string): Record<string, unknown> {
  const rows = db.prepare('SELECT key, value FROM org_data WHERE org_id = ?').all(orgId) as { key: string; value: string }[];
  const result: Record<string, unknown> = {};
  for (const r of rows) { try { result[r.key] = JSON.parse(r.value); } catch { result[r.key] = r.value; } }
  return result;
}

// ─── One-time migration from kv_store blobs → domain tables ──────────────────

function safeJSON<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function migrateFromKV(): void {
  const already = (db.prepare("SELECT value FROM _meta WHERE key = 'migrated_v1'").get() as { value: string } | undefined)?.value;
  if (already === 'true') return;

  console.log('[db] Running one-time migration from kv_store → domain tables…');

  const activeOrgRow = db.prepare("SELECT value FROM kv_store WHERE key = 'suez_active_org_id'").get() as { value: string } | undefined;
  const activeOrgId: string = safeJSON<string>(activeOrgRow?.value ?? null) ?? 'default';

  // ── transactions ──────────────────────────────────────────────────────────
  const txnRow = db.prepare("SELECT value FROM kv_store WHERE key = 'suez_transactions'").get() as { value: string } | undefined;
  const txns: Record<string, unknown>[] = safeJSON(txnRow?.value ?? null) ?? [];
  if (txns.length > 0) {
    console.log(`[db] Migrating ${txns.length} transactions…`);
    bulkUpsertTransactions(activeOrgId, txns);
  }

  // ── employees ─────────────────────────────────────────────────────────────
  const empRow = db.prepare("SELECT value FROM kv_store WHERE key = 'suez_employees'").get() as { value: string } | undefined;
  const emps: Record<string, unknown>[] = safeJSON(empRow?.value ?? null) ?? [];
  if (emps.length > 0) {
    console.log(`[db] Migrating ${emps.length} employees…`);
    bulkUpsertEmployees(activeOrgId, emps);
  }

  // ── payroll runs ──────────────────────────────────────────────────────────
  const prRow = db.prepare("SELECT value FROM kv_store WHERE key = 'suez_payroll_runs'").get() as { value: string } | undefined;
  const runs: Record<string, unknown>[] = safeJSON(prRow?.value ?? null) ?? [];
  if (runs.length > 0) {
    const runTx = db.transaction(() => { for (const r of runs) upsertPayrollRun(activeOrgId, r); });
    runTx();
    console.log(`[db] Migrated ${runs.length} payroll runs.`);
  }

  // ── org config blobs ──────────────────────────────────────────────────────
  const orgKeys = [
    'suez_company_profile', 'suez_transfer_pricing', 'suez_tax_engine',
    'suez_platform_rules', 'suez_stripe_org_config', 'suez_stripe_sync_schedule',
    'suez_stripe_sync_cursors', 'suez_revenue_data', 'suez_organisations',
    'invoice_company_profiles', 'invoice_client_profiles',
  ];
  for (const key of orgKeys) {
    const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (row?.value) {
      const parsed = safeJSON(row.value);
      if (parsed !== null) setOrgData(activeOrgId, key, parsed);
    }
  }
  console.log(`[db] Migrated ${orgKeys.length} org config keys.`);

  db.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('migrated_v1', 'true')").run();
  console.log('[db] Migration complete.');
}

// ─── Agent sessions ───────────────────────────────────────────────────────────

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: unknown; // Claude MessageParam content (string | ContentBlock[])
}

export function getSessionMessages(sessionId: string, orgId = 'default', limit = 40): SessionMessage[] {
  const rows = db.prepare(`
    SELECT role, content FROM agent_sessions
    WHERE session_id = ? AND org_id = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(sessionId, orgId, limit) as { role: string; content: string }[];
  return rows.map(r => ({
    role: r.role as 'user' | 'assistant',
    content: (() => { try { return JSON.parse(r.content); } catch { return r.content; } })(),
  }));
}

export function appendSessionMessage(sessionId: string, orgId = 'default', role: 'user' | 'assistant', content: unknown): void {
  db.prepare(
    'INSERT INTO agent_sessions (session_id, org_id, role, content) VALUES (?, ?, ?, ?)'
  ).run(sessionId, orgId, role, JSON.stringify(content));
}

export function clearSession(sessionId: string, orgId = 'default'): void {
  db.prepare('DELETE FROM agent_sessions WHERE session_id = ? AND org_id = ?').run(sessionId, orgId);
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface ReportRow {
  id: string;
  org_id: string;
  report_type: string;
  label: string | null;
  payload: string;
  created_at: string;
}

export function insertReport(
  orgId: string,
  opts: { reportType?: string; label?: string; payload: unknown },
): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO reports (id, org_id, report_type, label, payload)
    VALUES (?,?,?,?,?)
  `).run(
    id,
    orgId,
    opts.reportType ?? 'custom',
    opts.label ?? null,
    JSON.stringify(opts.payload),
  );
  return id;
}

export function listReports(
  orgId: string,
  opts?: { limit?: number; offset?: number; reportType?: string },
): ReportRow[] {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const offset = opts?.offset ?? 0;
  const type = opts?.reportType;
  if (type) {
    return db.prepare(`
      SELECT id, org_id, report_type, label, payload, created_at
      FROM reports WHERE org_id = ? AND report_type = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(orgId, type, limit, offset) as ReportRow[];
  }
  return db.prepare(`
    SELECT id, org_id, report_type, label, payload, created_at
    FROM reports WHERE org_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(orgId, limit, offset) as ReportRow[];
}

export function getReport(orgId: string, reportId: string): ReportRow | null {
  const row = db.prepare(
    'SELECT id, org_id, report_type, label, payload, created_at FROM reports WHERE id = ? AND org_id = ?'
  ).get(reportId, orgId) as ReportRow | undefined;
  return row ?? null;
}

export function deleteReport(orgId: string, reportId: string): boolean {
  const info = db.prepare('DELETE FROM reports WHERE id = ? AND org_id = ?').run(reportId, orgId);
  return info.changes > 0;
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface InputRow {
  id: string;
  org_id: string;
  input_type: string;
  source: string | null;
  label: string | null;
  payload: string;
  metadata: string | null;
  created_at: string;
}

export function insertInput(
  orgId: string,
  opts: {
    inputType: string;
    source?: string;
    label?: string;
    payload: unknown;
    metadata?: unknown;
  },
): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO inputs (id, org_id, input_type, source, label, payload, metadata)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    id,
    orgId,
    opts.inputType,
    opts.source ?? null,
    opts.label ?? null,
    JSON.stringify(opts.payload),
    opts.metadata != null ? JSON.stringify(opts.metadata) : null,
  );
  return id;
}

export function listInputs(
  orgId: string,
  opts?: { limit?: number; offset?: number; inputType?: string },
): InputRow[] {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const offset = opts?.offset ?? 0;
  const type = opts?.inputType;
  if (type) {
    return db.prepare(`
      SELECT id, org_id, input_type, source, label, payload, metadata, created_at
      FROM inputs WHERE org_id = ? AND input_type = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(orgId, type, limit, offset) as InputRow[];
  }
  return db.prepare(`
    SELECT id, org_id, input_type, source, label, payload, metadata, created_at
    FROM inputs WHERE org_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(orgId, limit, offset) as InputRow[];
}

export function getInput(orgId: string, inputId: string): InputRow | null {
  const row = db.prepare(
    'SELECT id, org_id, input_type, source, label, payload, metadata, created_at FROM inputs WHERE id = ? AND org_id = ?'
  ).get(inputId, orgId) as InputRow | undefined;
  return row ?? null;
}

export function deleteInput(orgId: string, inputId: string): boolean {
  const info = db.prepare('DELETE FROM inputs WHERE id = ? AND org_id = ?').run(inputId, orgId);
  return info.changes > 0;
}

// ─── Processed data ──────────────────────────────────────────────────────────

export interface ProcessedRow {
  id: string;
  org_id: string;
  pipeline: string;
  input_id: string | null;
  label: string | null;
  payload: string;
  created_at: string;
}

export function insertProcessed(
  orgId: string,
  opts: {
    pipeline: string;
    inputId?: string | null;
    label?: string;
    payload: unknown;
  },
): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO processed_data (id, org_id, pipeline, input_id, label, payload)
    VALUES (?,?,?,?,?,?)
  `).run(
    id,
    orgId,
    opts.pipeline,
    opts.inputId ?? null,
    opts.label ?? null,
    JSON.stringify(opts.payload),
  );
  return id;
}

export function listProcessed(
  orgId: string,
  opts?: { limit?: number; offset?: number; pipeline?: string; inputId?: string },
): ProcessedRow[] {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const offset = opts?.offset ?? 0;
  if (opts?.inputId) {
    return db.prepare(`
      SELECT id, org_id, pipeline, input_id, label, payload, created_at
      FROM processed_data WHERE org_id = ? AND input_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(orgId, opts.inputId, limit, offset) as ProcessedRow[];
  }
  if (opts?.pipeline) {
    return db.prepare(`
      SELECT id, org_id, pipeline, input_id, label, payload, created_at
      FROM processed_data WHERE org_id = ? AND pipeline = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(orgId, opts.pipeline, limit, offset) as ProcessedRow[];
  }
  return db.prepare(`
    SELECT id, org_id, pipeline, input_id, label, payload, created_at
    FROM processed_data WHERE org_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(orgId, limit, offset) as ProcessedRow[];
}

export function getProcessed(orgId: string, rowId: string): ProcessedRow | null {
  const row = db.prepare(
    'SELECT id, org_id, pipeline, input_id, label, payload, created_at FROM processed_data WHERE id = ? AND org_id = ?'
  ).get(rowId, orgId) as ProcessedRow | undefined;
  return row ?? null;
}

export function deleteProcessed(orgId: string, rowId: string): boolean {
  const info = db.prepare('DELETE FROM processed_data WHERE id = ? AND org_id = ?').run(rowId, orgId);
  return info.changes > 0;
}

// Run migration on module load
migrateFromKV();
