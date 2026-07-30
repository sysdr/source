/** REQ: REQ-090 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPeopleModuleEnabled,
  isStripeServerSyncEnabled,
  isStripeWebhookIngestEnabled,
  setFeatureFlag,
  PEOPLE_MODULE_FLAG,
  STRIPE_SERVER_SYNC_FLAG,
  STRIPE_WEBHOOK_FLAG,
} from './featureFlags';

describe('featureFlags', () => {
  beforeEach(() => {
    localStorage.removeItem(`suez_ff_${PEOPLE_MODULE_FLAG}`);
    localStorage.removeItem(`suez_ff_${STRIPE_WEBHOOK_FLAG}`);
    localStorage.removeItem(`suez_ff_${STRIPE_SERVER_SYNC_FLAG}`);
  });

  it('defaults People module to enabled', () => {
    expect(isPeopleModuleEnabled()).toBe(true);
  });

  it('respects explicit off (REQ-090)', () => {
    setFeatureFlag(PEOPLE_MODULE_FLAG, false);
    expect(isPeopleModuleEnabled()).toBe(false);
  });

  it('defaults Stripe webhook and server sync flags on', () => {
    expect(isStripeWebhookIngestEnabled()).toBe(true);
    expect(isStripeServerSyncEnabled()).toBe(true);
  });

  it('can disable Stripe server sync', () => {
    setFeatureFlag(STRIPE_SERVER_SYNC_FLAG, false);
    expect(isStripeServerSyncEnabled()).toBe(false);
  });
});
