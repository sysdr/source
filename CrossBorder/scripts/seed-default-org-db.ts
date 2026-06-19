#!/usr/bin/env tsx
/**
 * Seed bundled default organisation into SQLite (data/suez.db).
 * Run: npm run seed:db
 */

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDefaultOrganisationPayload } from '../services/defaultOrganisation.ts';
import { setKV, getAllKV } from '../server/db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const payload = buildDefaultOrganisationPayload();
const data = payload.data as Record<string, unknown>;

let count = 0;
for (const [key, value] of Object.entries(data)) {
  if (value !== undefined && value !== null) {
    setKV(key, value);
    count++;
  }
}

const docsDir = path.join(root, 'data', 'documents');
mkdirSync(docsDir, { recursive: true });
const pdfSources = [
  { src: '/Users/sumedhshende/Downloads/Systemdr-PAN.pdf', dest: 'Systemdr-PAN.pdf' },
  { src: '/Users/sumedhshende/Downloads/FiLLiP_Approval Letter_M30135791.pdf', dest: 'FiLLiP_Approval_Letter_M30135791.pdf' },
  { src: '/Users/sumedhshende/Downloads/SystemDRInc - Approved Certificate of Incorporation (Articles of Incorporation).pdf', dest: 'SystemDRInc_Delaware_SOS_Certificate.pdf' },
  { src: '/Users/sumedhshende/Downloads/SystemDR_ Inc. Certificate of Incorporation.pdf', dest: 'SystemDRInc_Articles_of_Incorporation.pdf' },
  { src: '/Users/sumedhshende/Downloads/SystemDRInc - 147c Letter_Approved SS-4 (1).pdf', dest: 'SystemDRInc_IRS_EIN_147c_Letter.pdf' },
];
for (const { src, dest } of pdfSources) {
  if (existsSync(src)) {
    copyFileSync(src, path.join(docsDir, dest));
    console.log(`  archived: data/documents/${dest}`);
  }
}

const orgs = data.suez_organisations as { activeOrgId: string; organisations: Record<string, { profile: { parent: { name: string; llpin: string; pan: string; tan: string } } }> };
const activeOrg = orgs.organisations[orgs.activeOrgId];

console.log(`Seeded ${count} storage keys into SQLite (${Object.keys(getAllKV()).length} total keys in kv_store).`);
console.log(`Active org: ${orgs.activeOrgId}`);
console.log(`Entity: ${activeOrg?.profile?.parent?.name}`);
console.log(`  LLPIN: ${activeOrg?.profile?.parent?.llpin}`);
console.log(`  PAN:   ${activeOrg?.profile?.parent?.pan}`);
console.log(`  TAN:   ${activeOrg?.profile?.parent?.tan}`);
console.log(`  GSTIN: ${activeOrg?.profile?.parent?.name && (activeOrg.profile.parent as { taxId?: string }).taxId}`);
