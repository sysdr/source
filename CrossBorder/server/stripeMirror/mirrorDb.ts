import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMirrorSchema } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The mirror holds real customer PII, so it lives in its own git-ignored file rather than
 * in the tracked workspace snapshot data/suez.db. Override with MIRROR_DB_PATH.
 */
export function mirrorDbPath(): string {
  return process.env.MIRROR_DB_PATH || path.join(__dirname, '..', '..', 'data', 'stripe-mirror.db');
}

let instance: Database.Database | null = null;

/** Opened lazily so importing the server never creates the file unless the mirror is used. */
export function getMirrorDatabase(): Database.Database {
  if (!instance) {
    const file = mirrorDbPath();
    mkdirSync(path.dirname(file), { recursive: true });
    instance = new Database(file);
    instance.pragma('journal_mode = WAL');
    ensureMirrorSchema(instance);
  }
  return instance;
}
