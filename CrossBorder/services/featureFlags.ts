/**
 * Feature flags — REQ-090
 * REQ: REQ-090
 */

const FLAG_STORAGE_PREFIX = 'suez_ff_';

export const PEOPLE_MODULE_FLAG = 'ff_people_module';
export const STRIPE_WEBHOOK_FLAG = 'ff_stripe_webhook_ingest';
export const STRIPE_SERVER_SYNC_FLAG = 'ff_stripe_server_sync';

const DEFAULTS: Record<string, boolean> = {
  [PEOPLE_MODULE_FLAG]: true,
  [STRIPE_WEBHOOK_FLAG]: true,
  [STRIPE_SERVER_SYNC_FLAG]: true,
};

export function isFeatureEnabled(flagId: string): boolean {
  try {
    const raw = localStorage.getItem(`${FLAG_STORAGE_PREFIX}${flagId}`);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return DEFAULTS[flagId] ?? false;
}

export function setFeatureFlag(flagId: string, enabled: boolean): void {
  localStorage.setItem(`${FLAG_STORAGE_PREFIX}${flagId}`, enabled ? 'true' : 'false');
}

export function isPeopleModuleEnabled(): boolean {
  return isFeatureEnabled(PEOPLE_MODULE_FLAG);
}

export function isStripeWebhookIngestEnabled(): boolean {
  return isFeatureEnabled(STRIPE_WEBHOOK_FLAG);
}

export function isStripeServerSyncEnabled(): boolean {
  return isFeatureEnabled(STRIPE_SERVER_SYNC_FLAG);
}
