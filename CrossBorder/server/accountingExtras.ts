/**
 * Server handlers for bank CSV import, fixed assets, Tally export (EPIC-05).
 */
import { getOrgData, setOrgData, queryTransactions, bulkUpsertTransactions } from './db.js';
import type { CompanyProfile, FixedAsset, GLAccount, JournalEntry, Transaction } from '../types.js';
import { importAndMatchIndianBankCSV } from '../services/bankStatementMatch.js';
import {
  applyDepreciationToAssets,
  buildDepreciationJournalEntry,
  computeRegisterDepreciation,
  toFixedAssetRecord,
  type FixedAssetRecord,
} from '../services/fixedAssetService.js';
import { generateTallyExport } from '../services/tallyExport.js';
import { ensureRetainedEarnings } from '../services/periodCloseEngine.js';
import { listJournals } from './periodClose.js';

const FIXED_ASSETS_KEY = 'fixedAssets';
const JOURNAL_KEY = 'journalEntries';
const PROFILE_KEY = 'suez_company_profile';

const DEFAULT_CHART: GLAccount[] = [
  { code: '4000', name: 'Revenue', type: 'Income' },
  { code: '6200', name: 'Payroll', type: 'Expense' },
  { code: '6800', name: 'Depreciation Expense', type: 'Expense' },
  { code: '1000', name: 'Bank/Cash', type: 'Asset' },
  { code: '1500', name: 'Fixed Assets', type: 'Asset' },
  { code: '1600', name: 'Accumulated Depreciation', type: 'Asset' },
  { code: '3000', name: 'Equity', type: 'Equity' },
  { code: '3100', name: 'Retained Earnings', type: 'Equity' },
];

function loadChart(orgId: string): GLAccount[] {
  const profile = getOrgData(orgId, PROFILE_KEY) as CompanyProfile | null;
  const accounts = profile?.accounting?.glAccounts;
  if (accounts && accounts.length > 0) return ensureRetainedEarnings(accounts);
  return DEFAULT_CHART;
}

function loadAssets(orgId: string): FixedAssetRecord[] {
  const raw = getOrgData(orgId, FIXED_ASSETS_KEY);
  if (!Array.isArray(raw)) return [];
  return (raw as FixedAsset[]).map((a) => toFixedAssetRecord(a));
}

function saveAssets(orgId: string, assets: FixedAssetRecord[]): void {
  setOrgData(orgId, FIXED_ASSETS_KEY, assets);
}

function loadJournals(orgId: string): JournalEntry[] {
  const raw = getOrgData(orgId, JOURNAL_KEY);
  return Array.isArray(raw) ? (raw as JournalEntry[]) : listJournals(orgId);
}

function saveJournals(orgId: string, list: JournalEntry[]): void {
  setOrgData(orgId, JOURNAL_KEY, list);
}

export function importBankStatementCsv(
  orgId: string,
  csv: string,
  options: { dateWindowDays?: number; persistUnmatched?: boolean } = {},
) {
  const ledger = queryTransactions({ orgId }) as Transaction[];
  const report = importAndMatchIndianBankCSV(csv, ledger, {
    dateWindowDays: options.dateWindowDays,
  });

  if (options.persistUnmatched !== false && report.suggestedTransactions.length > 0) {
    const rows = report.suggestedTransactions.map((t) => ({
      ...t,
      id: t.id || `indianbank-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    }));
    bulkUpsertTransactions(orgId, rows as Record<string, unknown>[]);
  }

  return report;
}

export function listFixedAssets(orgId: string): FixedAssetRecord[] {
  return loadAssets(orgId);
}

export function upsertFixedAsset(orgId: string, asset: FixedAssetRecord): FixedAssetRecord {
  const list = loadAssets(orgId);
  const idx = list.findIndex((a) => a.id === asset.id);
  const normalized = toFixedAssetRecord(asset);
  if (idx >= 0) list[idx] = normalized;
  else list.push(normalized);
  saveAssets(orgId, list);
  return normalized;
}

export function runDepreciationPosting(
  orgId: string,
  input: { period: string; date?: string; periodFraction?: number },
) {
  if (!/^\d{4}-\d{2}$/.test(input.period)) {
    throw new Error('period must be YYYY-MM');
  }
  const assets = loadAssets(orgId);
  const computations = computeRegisterDepreciation(assets, {
    periodFraction: input.periodFraction ?? 1 / 12,
  });
  if (computations.length === 0) {
    throw new Error('No depreciable assets with positive book value');
  }

  const date = input.date || `${input.period}-28`;
  const journals = loadJournals(orgId);
  const year = String(new Date().getFullYear()).slice(-2);
  const maxNum = journals
    .filter((j) => j.number.startsWith(`JE-${year}`))
    .reduce((max, j) => Math.max(max, parseInt(j.number.split('-')[2] || '0', 10)), 0);
  const number = `JE-${year}-${String(maxNum + 1).padStart(4, '0')}`;

  const je = buildDepreciationJournalEntry({
    computations,
    date,
    period: input.period,
    number,
  });
  if (!je) throw new Error('Depreciation journal could not be built');

  const updatedAssets = applyDepreciationToAssets(assets, computations);
  saveAssets(orgId, updatedAssets);
  saveJournals(orgId, [je, ...journals]);

  return { journal: je, computations, assets: updatedAssets };
}

export function exportTallyCsv(orgId: string, period?: string) {
  const entries = loadJournals(orgId);
  const chart = loadChart(orgId);
  return generateTallyExport({ entries, chart, period });
}
