#!/usr/bin/env tsx
/**
 * Sync a month of Stripe transactions and create a DRAFT intercompany export
 * invoice (SYSTEMDR LLP -> SystemDR, Inc.) for 90% of that month's net Stripe
 * revenue (net = post Stripe-fee, post-refund, per Transaction.netAmount).
 *
 * The invoice is written with status 'Draft' only. Per repo policy (money
 * movement / financial documents are never fully autonomous), a human must
 * review it — amounts, billing period, party details — and mark it Sent from
 * the Invoices / Transfer Pricing UI before it is a final commercial invoice.
 *
 *   npx tsx scripts/generate-monthly-tp-invoice.ts --org=org-1769926725440
 *   npx tsx scripts/generate-monthly-tp-invoice.ts --org=... --month=2026-07 --sync
 */
import {
  getAllTransactionsForOrg,
  getInvoicesDB,
  upsertInvoice,
  getOrgData,
} from '../server/db.ts';
import { syncStripeToSqlite } from '../server/stripeSqliteSync.ts';
import {
  COMMERCIAL_INVOICE_PARTY_DEFAULTS,
  EXPORT_SAC_CODE,
  EXPORT_PURPOSE_CODE,
} from '../services/exportInvoiceService.ts';
import { currentIndianFinancialYear, getCurrentLutArn } from '../services/entityRegistryService.ts';

const NET_REVENUE_SHARE = 0.9;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** month = 'YYYY-MM' -> [start, end) as ISO dates, plus a human label. */
function monthBounds(month: string): { start: string; end: string; label: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`--month must be YYYY-MM, got "${month}"`);
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIdx, 1));
  const end = new Date(Date.UTC(year, monthIdx + 1, 1));
  const label = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label };
}

function previousMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Prefix uses the Indian financial-year start year (Apr-Mar), matching CGST Rule 46(b)'s "unique per financial year" requirement — not calendar year. */
function nextExportInvoiceNumber(orgId: string, invoiceDate: Date): string {
  const existing = getInvoicesDB(orgId) as { number?: string }[];
  const fyStart = currentIndianFinancialYear(invoiceDate).split('-')[0];
  const prefix = `EXP-${fyStart}-`;
  const seq =
    existing
      .map((i) => i.number || '')
      .filter((n) => n.startsWith(prefix))
      .map((n) => Number(n.slice(prefix.length)))
      .filter((n) => Number.isFinite(n))
      .reduce((max, n) => Math.max(max, n), 0) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

async function main(): Promise<void> {
  const orgId = arg('org');
  if (!orgId) throw new Error('--org=<orgId> is required');
  const month = arg('month') || previousMonth();
  const { start, end, label } = monthBounds(month);

  if (hasFlag('sync')) {
    const config = getOrgData(orgId, 'suez_stripe_org_config') as {
      apiKey?: string;
      accounts?: { id: string; name?: string; scope?: string }[];
      baseCurrency?: 'INR' | 'USD';
    } | null;
    if (!config?.apiKey?.startsWith('sk_')) {
      throw new Error(`No Stripe API key configured for ${orgId}; omit --sync or configure Stripe first`);
    }
    console.error(`Syncing Stripe transactions for ${orgId} (${start}..${end})…`);
    await syncStripeToSqlite({
      orgId,
      baseCurrency: config.baseCurrency || 'USD',
      stripe: config,
      entireHistory: false,
      startDate: start,
      endDate: end,
      purge: 'none',
    });
  }

  const monthTxns = (getAllTransactionsForOrg(orgId) as Record<string, unknown>[]).filter(
    (t) =>
      t.source === 'Stripe' &&
      t.type === 'Income' &&
      t.status !== 'Failed' &&
      !t.archived &&
      typeof t.date === 'string' &&
      (t.date as string) >= start &&
      (t.date as string) < end,
  );

  if (monthTxns.length === 0) {
    console.error(`No Stripe income transactions for ${orgId} in ${label} (${start}..${end}). Nothing to invoice.`);
    return;
  }

  const netRevenue = monthTxns.reduce((sum, t) => sum + (Number(t.netAmount) || 0), 0);
  const invoiceAmount = Math.round(netRevenue * NET_REVENUE_SHARE * 100) / 100;

  if (invoiceAmount <= 0) {
    console.error(`Computed invoice amount is ${invoiceAmount} for ${label} — skipping (net revenue was ${netRevenue}).`);
    return;
  }

  const existingForPeriod = (getInvoicesDB(orgId) as { date?: string; incomeType?: string; number?: string }[]).find(
    (i) => i.incomeType === 'export_of_services' && i.date === end,
  );
  if (existingForPeriod && !hasFlag('force')) {
    console.error(
      `An export invoice already exists for ${label} (${existingForPeriod.number}, date ${existingForPeriod.date}). ` +
        `Skipping to avoid a duplicate draft. Pass --force to create another one anyway.`,
    );
    return;
  }

  const invoiceDate = new Date(end);
  const number = nextExportInvoiceNumber(orgId, invoiceDate);
  const lutNumber = getCurrentLutArn(invoiceDate);
  const nowIso = new Date().toISOString();
  const { provider, recipient, placeOfSupply, serviceDescription } = COMMERCIAL_INVOICE_PARTY_DEFAULTS;
  const dueDate = new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const invoice = {
    id: `exp-${Date.now()}`,
    number,
    date: end,
    dueDate,
    customerName: recipient.name,
    customerEmail: recipient.email,
    customerAddress: `${recipient.address}, ${recipient.city}, ${recipient.state} ${recipient.zip}, ${recipient.country}`,
    customerCountry: recipient.country,
    placeOfSupply,
    status: 'Draft',
    currency: 'USD',
    subtotal: invoiceAmount,
    taxTotal: 0,
    total: invoiceAmount,
    lines: [
      {
        id: `${number}-l1`,
        description: `${serviceDescription} Billing period: ${label}. Intercompany service fee = 90% of net Stripe revenue (USD ${netRevenue.toFixed(2)}) for the month, per Intercompany Service Agreement.`,
        quantity: 1,
        unit: 'month',
        unitPrice: invoiceAmount,
        amount: invoiceAmount,
        currency: 'USD',
        taxRate: 0,
        taxAmount: 0,
      },
    ],
    entity: 'parent',
    notes: `Auto-generated DRAFT — review before sending. Provider: ${provider.name} (GSTIN ${provider.gstin}). 90% of net Stripe revenue for ${label}. GST LUT zero-rated export${lutNumber ? ` (LUT ARN ${lutNumber})` : ' — WARNING: no LUT on file for this invoice date, add one before sending'}, RBI FIRC purpose code ${EXPORT_PURPOSE_CODE}, SAC ${EXPORT_SAC_CODE}.`,
    createdAt: nowIso,
    updatedAt: nowIso,
    transactionIds: monthTxns.map((t) => t.id as string),
    isForeignIncome: true,
    incomeType: 'export_of_services',
  };

  upsertInvoice(orgId, invoice);
  console.log(
    `Created DRAFT invoice ${number}: USD ${invoiceAmount.toFixed(2)} (90% of net Stripe revenue USD ${netRevenue.toFixed(2)}) for ${label}. ` +
      `Review in Invoices / Transfer Pricing before marking it Sent.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
