#!/usr/bin/env tsx
/**
 * Rebuild kv_store from domain tables and checkpoint SQLite so
 * `data/suez.db` in git contains the full workspace for clones.
 *
 * Run: npm run snapshot:data
 */
import { rebuildKvFromDomain } from '../server/rebuildKv.ts';
import { checkpointDatabase, getAllKV } from '../server/db.ts';

const summary = rebuildKvFromDomain();
checkpointDatabase();
const kv = getAllKV();
console.log(`Snapshot written for org ${summary.orgId}`);
console.log(`  employees:    ${summary.employees}`);
console.log(`  transactions: ${summary.transactions}`);
console.log(`  kv keys:      ${Object.keys(kv).length}`);
console.log(`  smtp:         ${kv.suez_smtp_settings ? 'yes' : 'no'}`);
console.log('Commit data/suez.db (ignore *-wal / *-shm) to share this state.');
