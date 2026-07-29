/**
 * Fixed asset register + depreciation posting (REQ-063 / T-025).
 */
import type { FixedAsset, JournalEntry, JournalEntryLine } from '../types';

export const DEPRECIATION_EXPENSE_CODE = '6800';
export const ACCUMULATED_DEPRECIATION_CODE = '1600';

export type DepreciationMethod = 'SLM' | 'WDV';

export interface FixedAssetRecord extends FixedAsset {
  method: DepreciationMethod;
  /** Useful life in years (required for SLM; optional for WDV) */
  usefulLifeYears?: number;
  disposedAt?: string;
}

export interface DepreciationComputation {
  assetId: string;
  assetName: string;
  method: DepreciationMethod;
  openingBookValue: number;
  depreciationAmount: number;
  closingBookValue: number;
  rate: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function netBookValue(asset: Pick<FixedAsset, 'cost' | 'accumulated'>): number {
  return round2(Math.max(0, asset.cost - asset.accumulated));
}

/**
 * Compute periodic (annual) depreciation for one asset.
 * WDV: rate% of opening WDV. SLM: cost / usefulLifeYears (or cost * rate/100).
 */
export function computeAssetDepreciation(
  asset: FixedAssetRecord,
  options: { periodFraction?: number } = {},
): DepreciationComputation {
  const fraction = options.periodFraction ?? 1;
  const opening = netBookValue(asset);
  let depreciationAmount = 0;

  if (asset.method === 'SLM') {
    const life = asset.usefulLifeYears && asset.usefulLifeYears > 0
      ? asset.usefulLifeYears
      : (asset.depreciationRate > 0 ? 100 / asset.depreciationRate : 0);
    if (life > 0) {
      depreciationAmount = round2((asset.cost / life) * fraction);
    } else if (asset.depreciationRate > 0) {
      depreciationAmount = round2(asset.cost * (asset.depreciationRate / 100) * fraction);
    }
  } else {
    // WDV
    depreciationAmount = round2(opening * (asset.depreciationRate / 100) * fraction);
  }

  depreciationAmount = Math.min(depreciationAmount, opening);
  const closingBookValue = round2(opening - depreciationAmount);

  return {
    assetId: asset.id,
    assetName: asset.name,
    method: asset.method,
    openingBookValue: opening,
    depreciationAmount,
    closingBookValue,
    rate: asset.depreciationRate,
  };
}

export function computeRegisterDepreciation(
  assets: FixedAssetRecord[],
  options?: { periodFraction?: number },
): DepreciationComputation[] {
  return assets
    .filter((a) => !a.disposedAt)
    .map((a) => computeAssetDepreciation(a, options))
    .filter((c) => c.depreciationAmount > 0);
}

export function applyDepreciationToAssets(
  assets: FixedAssetRecord[],
  computations: DepreciationComputation[],
): FixedAssetRecord[] {
  const byId = new Map(computations.map((c) => [c.assetId, c]));
  return assets.map((a) => {
    const c = byId.get(a.id);
    if (!c) return a;
    return {
      ...a,
      accumulated: round2(a.accumulated + c.depreciationAmount),
    };
  });
}

/** Build Dr Depreciation Expense / Cr Accumulated Depreciation JE lines. */
export function buildDepreciationJournalLines(
  computations: DepreciationComputation[],
  currency: 'INR' | 'USD' = 'INR',
): JournalEntryLine[] {
  const total = round2(computations.reduce((s, c) => s + c.depreciationAmount, 0));
  if (total <= 0) return [];
  const stamp = Date.now();
  return [
    {
      id: `jel-dep-${stamp}-1`,
      glAccountCode: DEPRECIATION_EXPENSE_CODE,
      description: `Depreciation (${computations.length} assets)`,
      debit: total,
      credit: 0,
      currency,
    },
    {
      id: `jel-dep-${stamp}-2`,
      glAccountCode: ACCUMULATED_DEPRECIATION_CODE,
      description: `Accumulated depreciation`,
      debit: 0,
      credit: total,
      currency,
    },
  ];
}

export function buildDepreciationJournalEntry(input: {
  computations: DepreciationComputation[];
  date: string;
  period: string;
  number: string;
  currency?: 'INR' | 'USD';
}): JournalEntry | null {
  const lines = buildDepreciationJournalLines(input.computations, input.currency);
  if (lines.length === 0) return null;
  const now = new Date().toISOString();
  return {
    id: `je-dep-${input.period}-${Date.now()}`,
    number: input.number,
    date: input.date,
    period: input.period,
    description: `Period-end depreciation ${input.period}`,
    lines,
    status: 'Posted',
    createdAt: now,
    postedAt: now,
  };
}

/** Normalize legacy FixedAsset (no method) to FixedAssetRecord defaulting WDV. */
export function toFixedAssetRecord(asset: FixedAsset & { method?: DepreciationMethod; usefulLifeYears?: number }): FixedAssetRecord {
  return {
    ...asset,
    method: asset.method === 'SLM' ? 'SLM' : 'WDV',
    usefulLifeYears: asset.usefulLifeYears,
  };
}
