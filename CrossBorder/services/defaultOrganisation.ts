/**
 * Build default organisation payload from bundled entity registry + org template.
 * Used for first-run seed and SQLite persistence.
 */

import orgTemplate from '../data/default-organisation.json';
import {
  getParentEntityProfile,
  getSubsidiaryEntityProfile,
  getInvoiceCompanyProfile,
  getInvoiceClientProfile,
  getVaultDocumentEntries,
  getEntityRegistry,
} from './entityRegistryService';
import { getCommercialInvoiceDefaults } from './exportInvoiceService';
import type { ConfigExportPayload } from './storageService';

export const DEFAULT_ORG_VERSION = '9';

export function buildDefaultOrganisationPayload(): ConfigExportPayload {
  const template = orgTemplate as ConfigExportPayload;
  const data = JSON.parse(JSON.stringify(template.data)) as Record<string, unknown>;
  const entity = getEntityRegistry();

  const orgs = data.suez_organisations as {
    activeOrgId: string;
    organisations: Record<string, Record<string, unknown>>;
  };
  const activeId = orgs.activeOrgId;
  const org = orgs.organisations[activeId] as Record<string, unknown>;

  org.profile = {
    ...(org.profile as object),
    projectName: entity.displayName,
    parent: getParentEntityProfile(),
    subsidiary: getSubsidiaryEntityProfile(),
  };

  const invoiceCo = getInvoiceCompanyProfile();
  const invoiceClient = getInvoiceClientProfile();
  data.invoice_company_profiles = [invoiceCo];
  data.invoice_active_company = invoiceCo;
  data.invoice_client_profiles = [invoiceClient];
  data.suez_vault = getVaultDocumentEntries();

  const tp = org.transferPricing as Record<string, unknown> | undefined;
  if (tp) {
    const defaults = getCommercialInvoiceDefaults({
      billingPeriod: 'August 2026',
      lastSeq: 1,
    });
    tp.exportInvoice = defaults;
    tp.activeProviderId = 'sp-default-exp-2026-001';
    tp.activeRecipientId = 'sr-default-exp-2026-001';
  }

  orgs.organisations[activeId] = org;
  data.suez_organisations = orgs;
  data.suez_company_profile = (org.profile as { projectName: string; parent: unknown; subsidiary: unknown; baseCurrency: string; payroll: unknown; accounting: unknown });

  return {
    version: template.version,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function getDefaultOrganisationPayload(): ConfigExportPayload {
  return buildDefaultOrganisationPayload();
}

// ── Browser seed / restore ────────────────────────────────────────────────────

import { importConfig } from './storageService';

const DEFAULT_ORG_VERSION_KEY = 'suez_default_org_version';
const DEFAULT_ORG_SEEDED_KEY = 'suez_default_org_seeded';

/** Import bundled config only when this browser has no organisation yet. */
export function seedDefaultOrganisationIfNeeded(): boolean {
  // Never clobber a hydrate-from-SQLite (or existing) workspace.
  const current = localStorage.getItem(DEFAULT_ORG_VERSION_KEY);
  const onboardedRaw = localStorage.getItem('suez_onboarded');
  const onboarded = onboardedRaw === 'true' || onboardedRaw === '"true"';
  const hasOrgs = !!localStorage.getItem('suez_organisations');
  if (hasOrgs || onboarded) {
    if (current !== DEFAULT_ORG_VERSION) {
      localStorage.setItem(DEFAULT_ORG_VERSION_KEY, DEFAULT_ORG_VERSION);
      localStorage.setItem(DEFAULT_ORG_SEEDED_KEY, '1');
    }
    return false;
  }
  if (current === DEFAULT_ORG_VERSION) {
    return false;
  }
  const result = importConfig(buildDefaultOrganisationPayload());
  if (result.success) {
    localStorage.setItem(DEFAULT_ORG_VERSION_KEY, DEFAULT_ORG_VERSION);
    localStorage.setItem(DEFAULT_ORG_SEEDED_KEY, '1');
  }
  return result.success;
}

/** Force-import the bundled default organisation (replaces current config). */
export function loadDefaultOrganisationConfig(): { success: boolean; error?: string } {
  const result = importConfig(buildDefaultOrganisationPayload());
  if (result.success) {
    localStorage.setItem(DEFAULT_ORG_VERSION_KEY, DEFAULT_ORG_VERSION);
    localStorage.setItem(DEFAULT_ORG_SEEDED_KEY, '1');
  }
  return result;
}
