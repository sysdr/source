/**
 * SQLite backup / restore-verification helpers (REQ-032, REQ-067).
 * RPO target: 24h. RTO target: restore within 4h using last successful backup.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { checkpointDatabase } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** RPO: max acceptable age of newest backup (ms) — 24 hours */
export const RPO_MS = 24 * 60 * 60 * 1000;
/** Pre-deploy freshness window (ms) — 4 hours */
export const PREDEPLOY_BACKUP_MAX_AGE_MS = 4 * 60 * 60 * 1000;

function resolveDbPath(): string {
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'suez.db');
}

function resolveBackupDir(): string {
  return process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
}

export interface BackupInfo {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  ageMs: number;
}

export interface BackupStatus {
  ok: boolean;
  dbPath: string;
  backupDir: string;
  latest: BackupInfo | null;
  backupCount: number;
  rpoMs: number;
  rpoCompliant: boolean;
  predeployFresh: boolean;
  message: string;
}

export interface CreateBackupResult {
  ok: boolean;
  backup: BackupInfo;
}

export interface VerifyBackupResult {
  ok: boolean;
  backup: BackupInfo;
  checks: {
    fileExists: boolean;
    opens: boolean;
    hasKvStore: boolean;
    hasTransactions: boolean;
    hasEmployees: boolean;
  };
  error?: string;
}

function ensureBackupDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function listBackupFiles(backupDir: string): string[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => f.startsWith('suez-') && f.endsWith('.db'))
    .sort()
    .reverse();
}

function toBackupInfo(filePath: string): BackupInfo {
  const st = statSync(filePath);
  const createdAt = st.mtime.toISOString();
  return {
    fileName: path.basename(filePath),
    path: filePath,
    sizeBytes: st.size,
    createdAt,
    ageMs: Date.now() - st.mtimeMs,
  };
}

export function getBackupStatus(
  dbPath = resolveDbPath(),
  backupDir = resolveBackupDir(),
): BackupStatus {
  ensureBackupDir(backupDir);
  const files = listBackupFiles(backupDir);
  const latest = files.length ? toBackupInfo(path.join(backupDir, files[0])) : null;
  const rpoCompliant = latest ? latest.ageMs <= RPO_MS : false;
  const predeployFresh = latest ? latest.ageMs <= PREDEPLOY_BACKUP_MAX_AGE_MS : false;
  let message = 'No backups found';
  if (latest) {
    if (rpoCompliant && predeployFresh) message = 'Latest backup is within RPO and pre-deploy freshness window';
    else if (rpoCompliant) message = 'Latest backup is within RPO (24h) but older than 4h pre-deploy window';
    else message = 'Latest backup exceeds RPO (24h) — create a new backup';
  }
  return {
    ok: true,
    dbPath,
    backupDir,
    latest,
    backupCount: files.length,
    rpoMs: RPO_MS,
    rpoCompliant,
    predeployFresh,
    message,
  };
}

export function createBackup(
  dbPath = resolveDbPath(),
  backupDir = resolveBackupDir(),
): CreateBackupResult {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  ensureBackupDir(backupDir);
  checkpointDatabase();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `suez-${stamp}.db`;
  const dest = path.join(backupDir, fileName);
  copyFileSync(dbPath, dest);
  return { ok: true, backup: toBackupInfo(dest) };
}

export function verifyBackup(
  backupPath?: string,
  backupDir = resolveBackupDir(),
): VerifyBackupResult {
  const status = getBackupStatus(resolveDbPath(), backupDir);
  const target = backupPath
    || (status.latest?.path ?? '');
  if (!target) {
    return {
      ok: false,
      backup: {
        fileName: '',
        path: '',
        sizeBytes: 0,
        createdAt: '',
        ageMs: 0,
      },
      checks: {
        fileExists: false,
        opens: false,
        hasKvStore: false,
        hasTransactions: false,
        hasEmployees: false,
      },
      error: 'No backup available to verify',
    };
  }

  const info = toBackupInfo(target);
  const checks = {
    fileExists: existsSync(target),
    opens: false,
    hasKvStore: false,
    hasTransactions: false,
    hasEmployees: false,
  };

  if (!checks.fileExists) {
    return { ok: false, backup: info, checks, error: `Backup file missing: ${target}` };
  }

  const tempPath = path.join(backupDir, `.verify-${Date.now()}.db`);
  try {
    copyFileSync(target, tempPath);
    const verifyDb = new Database(tempPath, { readonly: true, fileMustExist: true });
    checks.opens = true;
    const tables = verifyDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));
    checks.hasKvStore = names.has('kv_store');
    checks.hasTransactions = names.has('transactions');
    checks.hasEmployees = names.has('employees');
    verifyDb.close();
  } catch (err) {
    return {
      ok: false,
      backup: info,
      checks,
      error: (err as Error).message,
    };
  } finally {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch { /* ignore cleanup errors */ }
  }

  const ok = checks.fileExists && checks.opens && checks.hasKvStore
    && checks.hasTransactions && checks.hasEmployees;
  return {
    ok,
    backup: info,
    checks,
    error: ok ? undefined : 'Backup opened but required tables are missing',
  };
}

export function listBackups(backupDir = resolveBackupDir()): BackupInfo[] {
  ensureBackupDir(backupDir);
  return listBackupFiles(backupDir).map((f) => toBackupInfo(path.join(backupDir, f)));
}
