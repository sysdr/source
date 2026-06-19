import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getBaseCurrencyFromProfile,
  convertToBaseSync,
  formatAmount,
  formatAmountDual,
  getAmountInBase,
  getGstImpactInBase,
  type BaseCurrency,
} from './currencyService';
import type { CompanyProfile } from '../types';

vi.mock('./storageService', () => ({
  getCompanyProfile: vi.fn(),
  getManualUsdToInrRate: vi.fn(() => null),
  getUIState: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
  StorageKeys: { UI_DISPLAY_CURRENCY: 'suez_ui_display_currency' },
}));

const { getCompanyProfile, getManualUsdToInrRate } = await import('./storageService');

describe('currencyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBaseCurrencyFromProfile', () => {
    it('returns INR when profile is null', () => {
      expect(getBaseCurrencyFromProfile(null)).toBe('INR');
    });

    it('returns profile.baseCurrency when set', () => {
      expect(getBaseCurrencyFromProfile({ baseCurrency: 'USD' } as CompanyProfile)).toBe('USD');
      expect(getBaseCurrencyFromProfile({ baseCurrency: 'INR' } as CompanyProfile)).toBe('INR');
    });

    it('returns USD when parent country is US', () => {
      expect(
        getBaseCurrencyFromProfile({
          parent: { country: 'US' } as any,
        } as CompanyProfile)
      ).toBe('USD');
    });

    it('returns INR when parent country is IN', () => {
      expect(
        getBaseCurrencyFromProfile({
          parent: { country: 'IN' } as any,
        } as CompanyProfile)
      ).toBe('INR');
    });

    it('returns USD when parent state is a US state', () => {
      expect(
        getBaseCurrencyFromProfile({
          parent: { state: 'California' } as any,
        } as CompanyProfile)
      ).toBe('USD');
    });

    it('returns INR when parent state is an Indian state', () => {
      expect(
        getBaseCurrencyFromProfile({
          parent: { state: 'Maharashtra' } as any,
        } as CompanyProfile)
      ).toBe('INR');
    });

    it('returns USD when parent has 9-digit US tax ID', () => {
      expect(
        getBaseCurrencyFromProfile({
          parent: { taxId: '12-3456789' } as any,
        } as CompanyProfile)
      ).toBe('USD');
    });

    it('returns INR when parent has long tax ID (GSTIN)', () => {
      expect(
        getBaseCurrencyFromProfile({
          parent: { taxId: '27AABCU9603R1ZM' } as any,
        } as CompanyProfile)
      ).toBe('INR');
    });

    it('defaults to INR', () => {
      expect(getBaseCurrencyFromProfile({ parent: {} } as CompanyProfile)).toBe('INR');
    });
  });

  describe('convertToBaseSync', () => {
    it('returns amount when currencies match', () => {
      expect(convertToBaseSync(100, 'USD', 'USD')).toBe(100);
      expect(convertToBaseSync(100, 'INR', 'INR')).toBe(100);
    });

    it('converts USD to INR', () => {
      expect(convertToBaseSync(100, 'USD', 'INR')).toBe(8350);
    });

    it('converts INR to USD', () => {
      expect(convertToBaseSync(8350, 'INR', 'USD')).toBe(100);
    });

    it('returns amount when conversion not USD/INR', () => {
      expect(convertToBaseSync(100, 'USD' as any, 'INR' as any)).toBeDefined();
    });
  });

  describe('formatAmount', () => {
    it('formats INR with rupee symbol', () => {
      expect(formatAmount(1000, 'INR')).toMatch(/₹/);
      expect(formatAmount(1000, 'INR')).toContain('1,000');
    });

    it('formats USD with dollar symbol', () => {
      expect(formatAmount(1000, 'USD')).toMatch(/\$/);
      expect(formatAmount(1000, 'USD')).toContain('1,000');
    });
  });

  describe('formatAmountDual', () => {
    it('formats USD amount with both USD and INR', () => {
      (getManualUsdToInrRate as any).mockReturnValue(83.5);
      const result = formatAmountDual(100, 'USD');
      expect(result).toMatch(/\$/);
      expect(result).toMatch(/₹/);
    });

    it('formats INR amount with both USD and INR', () => {
      (getManualUsdToInrRate as any).mockReturnValue(83.5);
      const result = formatAmountDual(8350, 'INR');
      expect(result).toMatch(/\$/);
      expect(result).toMatch(/₹/);
    });
  });

  describe('getAmountInBase', () => {
    it('returns amount when tx currency matches base', () => {
      expect(getAmountInBase({ amount: 100, currency: 'USD' }, 'USD')).toBe(100);
      expect(getAmountInBase({ amount: 1000, currency: 'INR' }, 'INR')).toBe(1000);
    });

    it('converts using originalAmount when originalCurrency differs', () => {
      expect(
        getAmountInBase(
          { amount: 8350, currency: 'INR', originalAmount: 100, originalCurrency: 'USD' },
          'INR'
        )
      ).toBe(8350);
    });

    it('converts tx.amount when currency differs from base', () => {
      expect(getAmountInBase({ amount: 100, currency: 'USD' }, 'INR')).toBe(8350);
    });
  });

  describe('getGstImpactInBase', () => {
    it('returns 0 when no gstImpact', () => {
      expect(getGstImpactInBase({ amount: 100, currency: 'USD' }, 'USD')).toBe(0);
    });

    it('returns gstImpact when currency matches base', () => {
      expect(getGstImpactInBase({ amount: 100, currency: 'USD', gstImpact: 18 }, 'USD')).toBe(18);
    });

    it('converts gstImpact when currency differs', () => {
      const result = getGstImpactInBase({ amount: 100, currency: 'USD', gstImpact: 1 }, 'INR');
      expect(result).toBeGreaterThan(0);
    });
  });
});
