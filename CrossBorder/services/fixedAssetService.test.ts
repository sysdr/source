import { describe, expect, it } from 'vitest';
import {
  ACCUMULATED_DEPRECIATION_CODE,
  DEPRECIATION_EXPENSE_CODE,
  applyDepreciationToAssets,
  buildDepreciationJournalEntry,
  computeAssetDepreciation,
  computeRegisterDepreciation,
  toFixedAssetRecord,
} from './fixedAssetService';

describe('fixedAssetService (REQ-063 / T-025)', () => {
  it('computes WDV depreciation on opening book value', () => {
    const asset = toFixedAssetRecord({
      id: 'fa-1',
      name: 'Laptop',
      category: 'Computer',
      purchaseDate: '2025-01-01',
      cost: 100000,
      depreciationRate: 40,
      accumulated: 0,
      createdAt: '2025-01-01',
      method: 'WDV',
    });
    const dep = computeAssetDepreciation(asset);
    expect(dep.depreciationAmount).toBe(40000);
    expect(dep.closingBookValue).toBe(60000);
  });

  it('computes SLM depreciation from useful life', () => {
    const asset = toFixedAssetRecord({
      id: 'fa-2',
      name: 'Desk',
      category: 'Furniture',
      purchaseDate: '2025-01-01',
      cost: 60000,
      depreciationRate: 10,
      accumulated: 0,
      createdAt: '2025-01-01',
      method: 'SLM',
      usefulLifeYears: 10,
    });
    const dep = computeAssetDepreciation(asset);
    expect(dep.depreciationAmount).toBe(6000);
  });

  it('builds balanced depreciation JE and updates accumulated', () => {
    const assets = [
      toFixedAssetRecord({
        id: 'fa-1',
        name: 'Server',
        category: 'Computer',
        purchaseDate: '2025-01-01',
        cost: 200000,
        depreciationRate: 40,
        accumulated: 0,
        createdAt: '2025-01-01',
        method: 'WDV',
      }),
    ];
    const computations = computeRegisterDepreciation(assets, { periodFraction: 1 });
    const je = buildDepreciationJournalEntry({
      computations,
      date: '2025-12-28',
      period: '2025-12',
      number: 'JE-25-0100',
    });
    expect(je).not.toBeNull();
    expect(je!.lines[0].glAccountCode).toBe(DEPRECIATION_EXPENSE_CODE);
    expect(je!.lines[1].glAccountCode).toBe(ACCUMULATED_DEPRECIATION_CODE);
    expect(je!.lines[0].debit).toBe(je!.lines[1].credit);

    const updated = applyDepreciationToAssets(assets, computations);
    expect(updated[0].accumulated).toBe(80000);
  });
});
