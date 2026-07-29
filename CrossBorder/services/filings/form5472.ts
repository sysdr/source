/**
 * Form 5472 related-party transaction preparation (REQ-014).
 */
import type { CompanyProfile, Transaction } from '../../types';
import { withDisclaimerMeta } from './disclaimer';
import { validateExport, type ValidationResult } from './validateExport';

export interface TransferPricingSnapshot {
  usRevenue: number;
  usExpenses: number;
}

export interface Form5472Input {
  profile: CompanyProfile;
  taxYear: string;
  transactions: Transaction[];
  transferPricing?: TransferPricingSnapshot | null;
}

function mapTxnType(t: Transaction): {
  transactionType: 'purchases' | 'sales' | 'rents' | 'royalties' | 'interest' | 'service_fees' | 'other';
  direction: 'inbound' | 'outbound';
} {
  const desc = (t.description || '').toLowerCase();
  const cat = (t.category || '').toLowerCase();
  if (desc.includes('royalt') || cat.includes('royalt')) {
    return { transactionType: 'royalties', direction: t.type === 'Income' ? 'inbound' : 'outbound' };
  }
  if (desc.includes('interest') || cat.includes('interest')) {
    return { transactionType: 'interest', direction: t.type === 'Income' ? 'inbound' : 'outbound' };
  }
  if (desc.includes('rent') || cat.includes('rent')) {
    return { transactionType: 'rents', direction: t.type === 'Income' ? 'inbound' : 'outbound' };
  }
  if (t.type === 'Income') {
    return { transactionType: 'service_fees', direction: 'inbound' };
  }
  if (t.type === 'Purchase') {
    return { transactionType: 'purchases', direction: 'outbound' };
  }
  return { transactionType: 'other', direction: 'outbound' };
}

export function buildForm5472Payload(input: Form5472Input) {
  const related = input.transactions.filter((t) =>
    !t.deleted
    && (
      t.category === 'Transfer Pricing'
      || (t.description || '').toLowerCase().includes('intercompany')
      || (t.description || '').toLowerCase().includes('related party')
    ),
  );

  const transactions = related.map((t) => {
    const mapped = mapTxnType(t);
    return {
      date: t.date,
      description: t.description || t.category || 'Related party transaction',
      amountUsd: t.currency === 'USD' ? Number(t.amount) || 0 : 0,
      amountInr: t.currency === 'INR' ? Number(t.amount) || 0 : undefined,
      ...mapped,
    };
  });

  const tp = input.transferPricing;
  if (tp && (tp.usRevenue > 0 || tp.usExpenses > 0)) {
    const net = tp.usRevenue - tp.usExpenses;
    transactions.unshift({
      date: `${input.taxYear}-12-31`,
      description: 'Intercompany service fee (transfer pricing summary)',
      amountUsd: Number(net.toFixed(2)),
      amountInr: undefined,
      transactionType: 'service_fees',
      direction: net >= 0 ? 'inbound' : 'outbound',
    });
  }

  return withDisclaimerMeta({
    form: '5472' as const,
    reportingCorporation: {
      name: input.profile.subsidiary?.name || 'US Subsidiary',
      ein: input.profile.subsidiary?.ein || input.profile.subsidiary?.taxId || 'EIN-MISSING',
    },
    relatedParty: {
      name: input.profile.parent?.name || 'Foreign Related Party',
      country: 'IN',
    },
    taxYear: input.taxYear,
    transactions,
  });
}

export function generateForm5472(input: Form5472Input): ValidationResult {
  const payload = buildForm5472Payload(input);
  return validateExport('form5472', payload);
}

export function form5472ToCsv(payload: ReturnType<typeof buildForm5472Payload>): string {
  const lines = [
    `# DISCLAIMER: ${payload.meta.disclaimer}`,
    `# Form 5472 - Related Party Transaction Data`,
    `# Reporting Corporation: ${payload.reportingCorporation.name}`,
    `# EIN: ${payload.reportingCorporation.ein}`,
    `# Related Party: ${payload.relatedParty.name} (${payload.relatedParty.country})`,
    `# Tax Year: ${payload.taxYear}`,
    `# Generated: ${payload.meta.generatedAt}`,
    'Date,Description,AmountUSD,AmountINR,TransactionType,Direction',
    ...payload.transactions.map((t) => [
      t.date,
      `"${t.description.replace(/"/g, '""')}"`,
      t.amountUsd,
      t.amountInr ?? '',
      t.transactionType,
      t.direction,
    ].join(',')),
  ];
  return lines.join('\n');
}
