#!/usr/bin/env tsx
/**
 * Create a SQLite backup (REQ-032).
 * Run: npm run backup:db
 * Env: DB_PATH, BACKUP_DIR
 */
import { createBackup, getBackupStatus } from '../server/backup.ts';

const result = createBackup();
const status = getBackupStatus();
console.log(`Backup created: ${result.backup.fileName}`);
console.log(`  path: ${result.backup.path}`);
console.log(`  size: ${result.backup.sizeBytes} bytes`);
console.log(`  RPO compliant: ${status.rpoCompliant}`);
console.log(`  pre-deploy fresh: ${status.predeployFresh}`);
console.log(`  total backups: ${status.backupCount}`);
