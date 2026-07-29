/**
 * Tally Prime–compatible CSV exporters (REQ-081 / T-027).
 * Voucher CSV: voucher type, date, ledger name, debit, credit, narration
 * Trial balance CSV: ledger name, debit, credit
 */
import type { GLAccount, JournalEntry } from '../types';
import { computeTrialBalance } from './periodCloseEngine';

export const TALLY_VOUCHER_HEADERS = [
  'Voucher Type',
  'Date',
  'Ledger Name',
  'Debit',
  'Credit',
  'Narration',
] as const;

export const TALLY_TRIAL_BALANCE_HEADERS = [
  'Ledger Name',
  'Debit',
  'Credit',
] as const;

export interface TallyVoucherRow {
  voucherType: string;
  date: string;
  ledgerName: string;
  debit: number;
  credit: number;
  narration: string;
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function accountName(chart: GLAccount[], code: string): string {
  return chart.find((a) => a.code === code)?.name || code;
}

function voucherTypeFor(je: JournalEntry): string {
  const desc = (je.description || '').toLowerCase();
  if (desc.includes('reversal')) return 'Journal';
  if (desc.includes('year-end') || desc.includes('closing')) return 'Journal';
  if (desc.includes('depreciation')) return 'Journal';
  if (desc.includes('payment') || desc.includes('salary')) return 'Payment';
  if (desc.includes('receipt') || desc.includes('revenue')) return 'Receipt';
  if (desc.includes('sales') || desc.includes('invoice')) return 'Sales';
  return 'Journal';
}

/** Map posted journal entries to Tally voucher lines (one row per JE line). */
export function buildTallyVoucherRows(
  entries: JournalEntry[],
  chart: GLAccount[],
  period?: string,
): TallyVoucherRow[] {
  const rows: TallyVoucherRow[] = [];
  for (const je of entries) {
    if (je.status !== 'Posted') continue;
    if (period && je.period !== period) continue;
    const vType = voucherTypeFor(je);
    for (const line of je.lines) {
      rows.push({
        voucherType: vType,
        date: je.date,
        ledgerName: accountName(chart, line.glAccountCode),
        debit: line.debit,
        credit: line.credit,
        narration: line.description || je.description || je.number,
      });
    }
  }
  return rows;
}

export function tallyVouchersToCsv(rows: TallyVoucherRow[]): string {
  const lines = [
    TALLY_VOUCHER_HEADERS.join(','),
    ...rows.map((r) => [
      escapeCsv(r.voucherType),
      r.date,
      escapeCsv(r.ledgerName),
      r.debit.toFixed(2),
      r.credit.toFixed(2),
      escapeCsv(r.narration),
    ].join(',')),
  ];
  return lines.join('\n');
}

export function buildTallyTrialBalanceCsv(
  entries: JournalEntry[],
  chart: GLAccount[],
  period?: string,
): string {
  const tb = computeTrialBalance(entries, chart, period);
  const lines = [
    TALLY_TRIAL_BALANCE_HEADERS.join(','),
    ...tb.map((l) => [
      escapeCsv(l.accountName),
      l.debit.toFixed(2),
      l.credit.toFixed(2),
    ].join(',')),
  ];
  return lines.join('\n');
}

export function generateTallyExport(input: {
  entries: JournalEntry[];
  chart: GLAccount[];
  period?: string;
}): { vouchersCsv: string; trialBalanceCsv: string; voucherRowCount: number } {
  const voucherRows = buildTallyVoucherRows(input.entries, input.chart, input.period);
  return {
    vouchersCsv: tallyVouchersToCsv(voucherRows),
    trialBalanceCsv: buildTallyTrialBalanceCsv(input.entries, input.chart, input.period),
    voucherRowCount: voucherRows.length,
  };
}
