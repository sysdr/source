import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLastSyncStatus,
  runStripeSyncForAllAccounts,
  runStripeSyncForAccount,
  STRIPE_EARLIEST_CHARGE_TS,
} from './stripeSyncService';
import { storage, StorageKeys } from './storageService';

vi.mock('./storageService', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getStripeOrgConfig: vi.fn(),
    getRevenueData: vi.fn(),
    setRevenueData: vi.fn(),
    mergeRevenueIntoTransactions: vi.fn(),
    getActiveOrgId: vi.fn(() => null),
  };
});

describe('stripeSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.remove(StorageKeys.SYNC_SCHEDULE);
  });

  describe('getLastSyncStatus', () => {
    it('returns default when no schedule stored', () => {
      const status = getLastSyncStatus();
      expect(status).toEqual({
        lastSyncAt: null,
        nextScheduledAt: null,
      });
    });

    it('returns stored schedule when present', () => {
      const schedule = {
        lastSyncAt: '2025-01-15T10:00:00.000Z',
        nextScheduledAt: '2025-01-16T10:00:00.000Z',
        lastSyncResult: { success: true, transactionCount: 42, accountsSynced: 1 },
      };
      storage.set(StorageKeys.SYNC_SCHEDULE, schedule);
      const status = getLastSyncStatus();
      expect(status).toEqual(schedule);
    });
  });

  describe('runStripeSyncForAllAccounts', () => {
    it('returns error when no API key configured', async () => {
      const { getStripeOrgConfig } = await import('./storageService');
      (getStripeOrgConfig as any).mockReturnValue({ apiKey: '', accounts: [] });
      const result = await runStripeSyncForAllAccounts();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No Stripe API key');
    });

    it('returns error when API key does not start with sk_', async () => {
      const { getStripeOrgConfig } = await import('./storageService');
      (getStripeOrgConfig as any).mockReturnValue({ apiKey: 'pk_test_xxx', accounts: [] });
      const result = await runStripeSyncForAllAccounts();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No Stripe API key');
    });
  });

  describe('runStripeSyncForAccount', () => {
    const TEST_ACCOUNT_ID = 'acct_1RVjHOGs1d9scdb0';

    it('calls Stripe API with Stripe-Account header for given account and returns success when charges returned', async () => {
      const { getStripeOrgConfig, getRevenueData } = await import('./storageService');
      (getStripeOrgConfig as any).mockReturnValue({
        apiKey: 'sk_test_xxx',
        accounts: [{ id: TEST_ACCOUNT_ID, name: 'Test Account', scope: 'standalone' }],
        accountsSource: undefined,
        stripeContextAccountId: undefined,
      });
      (getRevenueData as any).mockReturnValue({
        transactions: [],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });

      let stripeUrl = '';
      let stripeHeaders: HeadersInit = {};
      vi.stubGlobal('fetch', (url: string, opts: { method?: string; headers?: HeadersInit }) => {
        if (url.includes('api.stripe.com')) {
          stripeUrl = url;
          stripeHeaders = opts?.headers ?? {};
        }
        if (url.includes('api.stripe.com')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'ch_test1',
                    amount: 1000,
                    currency: 'usd',
                    created: Math.floor(new Date('2025-06-01').getTime() / 1000),
                    status: 'succeeded',
                    refunded: false,
                    billing_details: { address: { country: 'US' } },
                  },
                ],
                has_more: false,
              }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      });

      const result = await runStripeSyncForAccount(TEST_ACCOUNT_ID);

      expect(result.success).toBe(true);
      expect(result.accountsSynced).toBe(1);
      expect(result.transactionCount).toBe(1);
      expect(stripeUrl).toContain('https://api.stripe.com/v1/charges');
      expect((stripeHeaders as Record<string, string>)['Stripe-Account']).toBe(TEST_ACCOUNT_ID);
      expect((stripeHeaders as Record<string, string>)['Stripe-Context']).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('uses earliest Stripe timestamp when entireHistory is true', async () => {
      const { getStripeOrgConfig, getRevenueData } = await import('./storageService');
      (getStripeOrgConfig as any).mockReturnValue({
        apiKey: 'sk_test_xxx',
        accounts: [{ id: TEST_ACCOUNT_ID, name: 'Test Account', scope: 'standalone' }],
        accountsSource: undefined,
        stripeContextAccountId: undefined,
      });
      (getRevenueData as any).mockReturnValue({
        transactions: [],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });

      let stripeUrl = '';
      vi.stubGlobal('fetch', (url: string) => {
        if (url.includes('api.stripe.com')) stripeUrl = url;
        if (url.includes('api.stripe.com')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                data: [],
                has_more: false,
              }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      });

      await runStripeSyncForAccount(TEST_ACCOUNT_ID, { entireHistory: true });

      expect(stripeUrl).toContain(`created%5Bgte%5D=${STRIPE_EARLIEST_CHARGE_TS}`);
      vi.unstubAllGlobals();
    });

    it('returns error when no API key for runStripeSyncForAccount', async () => {
      const { getStripeOrgConfig } = await import('./storageService');
      (getStripeOrgConfig as any).mockReturnValue({ apiKey: '', accounts: [] });
      const result = await runStripeSyncForAccount(TEST_ACCOUNT_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No Stripe API key');
    });
  });
});
