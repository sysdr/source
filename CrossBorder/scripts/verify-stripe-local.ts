#!/usr/bin/env tsx
/**
 * Verify each Stripe charge against local SQLite ledger details.
 *
 * Usage:
 *   npx tsx scripts/verify-stripe-local.ts --org=org-1769926725440
 *   npx tsx scripts/verify-stripe-local.ts --org=org-1769926725440 --days=30
 *   npx tsx scripts/verify-stripe-local.ts --org=org-1769926725440 --entire --account=acct_xxx
 *   npx tsx scripts/verify-stripe-local.ts --org=... --json > report.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runStripeLocalVerification } from '../server/stripeLocalVerifyRun.ts';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const orgId = arg('org') || process.env.STRIPE_VERIFY_ORG_ID || 'org-1769926725440';
  const days = Number(arg('days') || 90);
  const entire = hasFlag('entire');
  const accountId = arg('account');
  const asJson = hasFlag('json');
  const maxPages = arg('max-pages') ? Number(arg('max-pages')) : undefined;
  const startDate = arg('start');
  const endDate = arg('end');

  const windowLabel = entire
    ? 'entire'
    : startDate || endDate
      ? `${startDate || '…'}→${endDate || '…'}`
      : `${days}d`;
  console.error(`Verifying Stripe ↔ local for org=${orgId} window=${windowLabel}…`);

  const report = await runStripeLocalVerification({
    orgId,
    days,
    entireHistory: entire,
    startDate,
    endDate,
    accountId,
    maxPagesPerAccount: maxPages,
  });

  const summary = {
    orgId: report.orgId,
    comparedAt: report.comparedAt,
    window: report.window,
    accountsFetched: report.accountsFetched,
    stripeChargeCount: report.stripeChargeCount,
    localStripeCount: report.localStripeCount,
    matched: report.matched,
    mismatched: report.mismatched,
    missingLocal: report.missingLocal,
    missingStripe: report.missingStripe,
    fetchErrors: report.errors,
  };

  const mismatches = report.rows.filter((r) => r.outcome === 'mismatch').slice(0, 50);
  const missingLocal = report.rows.filter((r) => r.outcome === 'missing_local').slice(0, 50);
  const missingStripe = report.rows.filter((r) => r.outcome === 'missing_stripe').slice(0, 50);

  const outDir = path.join('context', 'reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `stripe_local_verify_${orgId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  writeFileSync(outPath, JSON.stringify({ summary, mismatches, missingLocal, missingStripe, allRows: report.rows }, null, 2));

  if (asJson) {
    console.log(JSON.stringify({ summary, mismatches, missingLocal, missingStripe }, null, 2));
  } else {
    console.log('\n=== Stripe ↔ local verification ===');
    console.log(JSON.stringify(summary, null, 2));
    if (mismatches.length) {
      console.log(`\nField mismatches (showing ${mismatches.length}):`);
      for (const row of mismatches) {
        console.log(`  ${row.chargeId}: ${row.mismatches.map((m) => `${m.field} stripe=${m.stripe} local=${m.local}`).join('; ')}`);
      }
    }
    if (missingLocal.length) {
      console.log(`\nOn Stripe, missing locally (showing ${missingLocal.length}):`);
      for (const row of missingLocal) {
        console.log(`  ${row.chargeId} ${row.stripe?.date} ${row.stripe?.originalCurrency} ${row.stripe?.originalAmount} ${row.stripe?.status}`);
      }
    }
    if (missingStripe.length) {
      console.log(`\nLocal only, not in Stripe window (showing ${missingStripe.length}):`);
      for (const row of missingStripe) {
        console.log(`  ${row.chargeId} local=${row.local?.date} ${row.local?.originalCurrency || row.local?.currency} ${row.local?.originalAmount ?? row.local?.amount} ${row.local?.status}`);
      }
    }
    console.log(`\nFull report: ${outPath}`);
  }

  const failed = report.mismatched + report.missingLocal + report.errors.length;
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
