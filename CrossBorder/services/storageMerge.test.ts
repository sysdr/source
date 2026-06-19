/**
 * Ledger merge: Stripe + CSV/import sources (e.g. Substack) must all upsert to SQLite via setTransactions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Transaction } from '../types';
import { RevenueCategory } from '../types';
import {
  mergeRevenueIntoTransactions,
  getTransactions,
  addOrganisation,
} from './storageService';
import type { CompanyProfile } from '../types';

vi.mock('./apiClient', () => ({
  api: {
    upsertTransactions: vi.fn().mockResolvedValue(true),
    upsertEmployees: vi.fn().mockResolvedValue(true),
    upsertPayrollRun: vi.fn().mockResolvedValue(true),
    setOrgData: vi.fn().mockResolvedValue(true),
    getTransactions: vi.fn().mockResolvedValue(null),
  },
}));

function minimalProfile(): CompanyProfile {
  return {
    projectName: 'Test Co',
    baseCurrency: 'INR',
    parent: { name: 'P', type: 'LLP', taxId: 'GSTIN1', state: 'MH', country: 'IN' },
    subsidiary: { name: 'S', type: 'Inc', taxId: 'EIN1', state: 'DE', country: 'US' },
    payroll: { pfEnabled: true, esiEnabled: false, ptState: 'MH', standardWorkingDays: 22 },
    accounting: { expenseCategories: [], revenueChannels: ['Stripe'] },
  };
}

function seedOrgWithEmptyLedger(): void {
  addOrganisation(minimalProfile());
}

describe('mergeRevenueIntoTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('merges Substack rows into the ledger (no stripeChargeId)', () => {
    seedOrgWithEmptyLedger();
    const sub: Transaction = {
      id: 'substack-2025-01-01-0-1',
      date: '2025-01-01',
      description: 'Substack revenue',
      amount: 100,
      currency: 'INR',
      source: 'Substack',
      status: 'Completed',
      category: 'Substack revenue',
      type: 'Income',
      classification: RevenueCategory.EXPORT,
    };
    mergeRevenueIntoTransactions([sub]);
    const led = getTransactions();
    expect(led.some((t) => t.id === sub.id && t.source === 'Substack')).toBe(true);
  });

  it('still merges Stripe charges by stripeChargeId', () => {
    seedOrgWithEmptyLedger();
    const stripe: Transaction = {
      id: 'txn-1',
      date: '2025-02-01',
      description: 'Charge',
      amount: 50,
      currency: 'USD',
      source: 'Stripe',
      status: 'Completed',
      category: 'Sales',
      type: 'Income',
      stripeChargeId: 'ch_test_123',
      classification: RevenueCategory.EXPORT,
    };
    mergeRevenueIntoTransactions([stripe]);
    const led = getTransactions();
    expect(led.some((t) => t.stripeChargeId === 'ch_test_123')).toBe(true);
  });

  it('does not duplicate when the same Substack id is merged twice', () => {
    seedOrgWithEmptyLedger();
    const sub: Transaction = {
      id: 'substack-dup',
      date: '2025-01-01',
      description: 'x',
      amount: 10,
      currency: 'INR',
      source: 'Substack',
      status: 'Completed',
      category: 'Substack revenue',
      type: 'Income',
      classification: RevenueCategory.EXPORT,
    };
    mergeRevenueIntoTransactions([sub]);
    mergeRevenueIntoTransactions([sub]);
    expect(getTransactions().filter((t) => t.id === 'substack-dup')).toHaveLength(1);
  });
});
