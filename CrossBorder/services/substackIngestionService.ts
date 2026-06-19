/**
 * Substack actuals: CSV import or manual entry. No public API; data entered manually or from export.
 */

import { Transaction, RevenueCategory } from '../types';
import { getRevenueData, setRevenueData, mergeRevenueIntoTransactions } from './storageService';
import { getBaseCurrency, convertToBaseCurrency } from './currencyService';

export interface SubstackActualRow {
  date: string;
  amount: number;
  currency: string;
  description?: string;
  type: 'revenue' | 'commission' | 'charge';
}

/** Parse CSV text. Expected columns: date, amount [, currency] [, description] [, type]. Header optional. */
export function parseSubstackCSV(csv: string): SubstackActualRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase();
  const hasHeader = /date|amount|revenue|commission/.test(header);
  const start = hasHeader ? 1 : 0;
  const rows: SubstackActualRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(',').map((p) => p.replace(/^["']|["']$/g, '').trim());
    const date = parts[0];
    const amount = parseFloat(parts[1] ?? '0') || 0;
    if (!date || isNaN(amount)) continue;
    const currency = (parts[2] ?? 'USD').toUpperCase();
    const description = parts[3] ?? `Substack ${parts[4] ?? 'revenue'}`;
    const typeRaw = (parts[4] ?? parts[3] ?? 'revenue').toLowerCase();
    const type: SubstackActualRow['type'] =
      typeRaw === 'commission' || typeRaw === 'fee' ? 'commission'
        : typeRaw === 'charge' || typeRaw === 'gross' ? 'charge'
        : 'revenue';
    rows.push({ date, amount, currency, description, type });
  }
  return rows;
}

/** Convert parsed Substack rows to transactions and add to revenue data. */
export async function importSubstackActuals(rows: SubstackActualRow[]): Promise<{ added: number; errors: string[] }> {
  const base = getBaseCurrency();
  const revenue = getRevenueData();
  const existingIds = new Set(revenue.transactions.map((t) => t.id));
  const newTxns: Transaction[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const id = `substack-${row.date}-${i}-${Date.now()}`;
    if (existingIds.has(id)) continue;
    try {
      const { amount, fxRate, fxRateDate } = await convertToBaseCurrency(row.amount, row.currency, row.date, base);
      const isRevenue = row.type === 'revenue' || row.type === 'charge';
      const feeAmount = row.type === 'commission' ? amount : 0;
      const netAmount = row.type === 'commission' ? 0 : amount;
      const t: Transaction = {
        id,
        date: row.date,
        description: row.description ?? `Substack ${row.type}`,
        amount: isRevenue ? amount : -amount,
        currency: base,
        originalAmount: row.amount,
        originalCurrency: row.currency as 'USD' | 'INR',
        fxRate,
        fxRateDate,
        feeAmount: row.type === 'charge' ? 0 : row.type === 'commission' ? amount : undefined,
        netAmount: isRevenue ? amount : undefined,
        source: 'Substack',
        status: 'Completed',
        category: row.type === 'commission' ? 'Substack fee' : 'Substack revenue',
        type: row.type === 'commission' ? 'Expense' : 'Income',
        classification: RevenueCategory.EXPORT,
      };
      newTxns.push(t);
      existingIds.add(id);
    } catch (e) {
      errors.push(`Row ${i + 1}: ${(e as Error).message}`);
    }
  }

  if (newTxns.length > 0) {
    const merged = [...newTxns, ...revenue.transactions];
    setRevenueData({
      ...revenue,
      transactions: merged.sort((a, b) => (b.date > a.date ? 1 : -1)),
      lastSyncDate: new Date().toISOString(),
    });
    mergeRevenueIntoTransactions(newTxns);
    window.dispatchEvent(new Event('suez_data_updated'));
  }

  return { added: newTxns.length, errors };
}

/** Add a single Substack manual entry. */
export async function addSubstackManualEntry(input: {
  date: string;
  amount: number;
  currency: string;
  description: string;
  type: 'revenue' | 'commission' | 'charge';
}): Promise<Transaction> {
  const base = getBaseCurrency();
  const { amount, fxRate, fxRateDate } = await convertToBaseCurrency(input.amount, input.currency, input.date, base);
  const id = `substack-${input.date}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const isRevenue = input.type === 'revenue' || input.type === 'charge';
  const t: Transaction = {
    id,
    date: input.date,
    description: input.description || `Substack ${input.type}`,
    amount: isRevenue ? amount : -amount,
    currency: base,
    originalAmount: input.amount,
    originalCurrency: input.currency as 'USD' | 'INR',
    fxRate,
    fxRateDate,
    feeAmount: input.type === 'commission' ? amount : undefined,
    netAmount: isRevenue ? amount : undefined,
    source: 'Substack',
    status: 'Completed',
    category: input.type === 'commission' ? 'Substack fee' : 'Substack revenue',
    type: input.type === 'commission' ? 'Expense' : 'Income',
    classification: RevenueCategory.EXPORT,
  };
  const revenue = getRevenueData();
  const merged = [t, ...revenue.transactions];
  setRevenueData({ ...revenue, transactions: merged, lastSyncDate: new Date().toISOString() });
  mergeRevenueIntoTransactions([t]);
  window.dispatchEvent(new Event('suez_data_updated'));
  return t;
}

/** Summary of Substack actuals from revenue transactions. */
export function computeSubstackActualsSummary(transactions: Transaction[]): {
  totalRevenue: number;
  totalCommissions: number;
  totalCharges: number;
  count: number;
} {
  const sub = transactions.filter((t) => t.source === 'Substack' && t.status === 'Completed');
  let totalRevenue = 0;
  let totalCommissions = 0;
  let totalCharges = 0;
  for (const t of sub) {
    if (t.type === 'Income') {
      totalRevenue += t.netAmount ?? t.amount;
      totalCharges += t.amount;
    } else {
      totalCommissions += Math.abs(t.amount);
    }
  }
  return { totalRevenue, totalCommissions, totalCharges, count: sub.length };
}
