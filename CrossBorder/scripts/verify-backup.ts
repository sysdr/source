#!/usr/bin/env tsx
/**
 * Verify the latest (or named) SQLite backup can open and has required tables (REQ-067).
 * Run: npm run backup:verify [-- path/to/backup.db]
 * Exit 0 on success, 1 on failure.
 */
import { getBackupStatus, verifyBackup } from '../server/backup.ts';

const namedPath = process.argv[2];
const status = getBackupStatus();
console.log(`Backup status: ${status.message}`);
if (status.latest) {
  console.log(`  latest: ${status.latest.fileName} (age ${Math.round(status.latest.ageMs / 1000)}s)`);
}
console.log(`  RPO compliant (≤24h): ${status.rpoCompliant}`);
console.log(`  pre-deploy fresh (≤4h): ${status.predeployFresh}`);

const result = verifyBackup(namedPath);
console.log(`Verify: ${result.ok ? 'PASS' : 'FAIL'}`);
console.log(`  file: ${result.backup.fileName || '(none)'}`);
console.log(`  checks: ${JSON.stringify(result.checks)}`);
if (result.error) console.error(`  error: ${result.error}`);

if (!result.ok) process.exit(1);
if (!status.rpoCompliant) {
  console.error('RPO check failed: no backup within 24 hours');
  process.exit(1);
}
