import type Database from 'better-sqlite3';

/**
 * One generic table holds the verbatim Stripe JSON (`raw`) so the mirror never loses a field.
 * `customer_id`, `status`, `created`, `amount`, `currency` are denormalised for indexed queries only.
 * Rows Stripe no longer returns get `deleted_at` (tombstone) — never hard-deleted.
 */
export function ensureMirrorSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_mirror_objects (
      org_id      TEXT NOT NULL,
      account_id  TEXT NOT NULL,
      resource    TEXT NOT NULL,
      stripe_id   TEXT NOT NULL,
      customer_id TEXT,
      status      TEXT,
      created     INTEGER,
      amount      INTEGER,
      currency    TEXT,
      raw         TEXT NOT NULL,
      synced_at   TEXT NOT NULL,
      deleted_at  TEXT,
      PRIMARY KEY (org_id, account_id, resource, stripe_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mirror_customer
      ON stripe_mirror_objects(org_id, account_id, resource, customer_id);
    CREATE INDEX IF NOT EXISTS idx_mirror_created
      ON stripe_mirror_objects(org_id, resource, created DESC);

    CREATE TABLE IF NOT EXISTS stripe_mirror_accounts (
      org_id      TEXT NOT NULL,
      account_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      parent_id   TEXT,
      discovered_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_status TEXT NOT NULL DEFAULT 'never',
      last_error  TEXT,
      PRIMARY KEY (org_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS stripe_mirror_runs (
      run_id      TEXT PRIMARY KEY NOT NULL,
      org_id      TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      status      TEXT NOT NULL,
      account_ids TEXT NOT NULL,
      results     TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_mirror_runs_org ON stripe_mirror_runs(org_id, started_at DESC);
  `);
}
