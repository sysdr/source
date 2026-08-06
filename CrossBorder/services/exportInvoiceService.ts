/**
 * B2B Export of Services — Commercial Invoice generation for LLP → US C-Corp.
 * Compliant with Indian GST (LUT zero-rated export), RBI FIRC (purpose code), and IRS deductibility.
 */

import type { Invoice, InvoiceStatus } from '../types';
import { RevenueCategory } from '../types';
import { storage, StorageKeys, getCompanyProfile, getInvoices } from './storageService';
import { getEntityRegistry, getCurrentLutArn, formatRegisteredAddress, formatSubsidiaryAddress, getSubsidiaryPlaceOfSupply, LUT_DECLARATION } from './entityRegistryService';

export const EXPORT_SAC_CODE = '998314';
export const EXPORT_PURPOSE_CODE = 'P0802';
export { LUT_DECLARATION };

export interface ExportInvoiceBankDetails {
  beneficiaryName: string;
  accountNumber: string;
  bankName: string;
  branchAddress: string;
  swiftCode: string;
  adCode: string;
}

export interface ExportInvoiceProvider {
  name: string;
  address: string;
  city: string;
  state: string;
  pin: string;
  country: string;
  gstin: string;
  pan: string;
  /** LLP Incorporation Number (LLPIN), e.g. ACP-3421 */
  llpin: string;
  /** DGFT Import Export Code (IEC) */
  iec: string;
  signatoryName: string;
  signatoryTitle: string;
}

/** US (or other) service recipient shown on the commercial invoice. */
export interface ExportInvoiceRecipient {
  name: string;
  /** Street / multi-line address body (excluding city/state/zip/country lines if those are filled separately). */
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  ein: string;
  contactName: string;
  email: string;
  phone: string;
}

/** Named, reusable service recipient saved for future TP invoices. */
export interface ServiceRecipientProfile extends ExportInvoiceRecipient {
  id: string;
  label: string;
}

/** Named, reusable service provider (From party) saved for future TP invoices. */
export interface ServiceProviderProfile extends ExportInvoiceProvider {
  id: string;
  label: string;
}

export function emptyExportInvoiceRecipient(): ExportInvoiceRecipient {
  return {
    name: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: 'USA',
    ein: '',
    contactName: '',
    email: '',
    phone: '',
  };
}

export function emptyExportInvoiceProvider(): ExportInvoiceProvider {
  return {
    name: '',
    address: '',
    city: '',
    state: '',
    pin: '',
    country: 'India',
    gstin: '',
    pan: '',
    llpin: '',
    iec: '',
    signatoryName: '',
    signatoryTitle: 'Partner',
  };
}

type InvoiceClientProfile = {
  name?: string;
  gstin?: string;
  pan?: string;
  addr?: string;
  city?: string;
  state?: string;
  pin?: string;
  contact?: string;
  email?: string;
};

type InvoiceCompanyBookProfile = {
  name?: string;
  label?: string;
  gstin?: string;
  pan?: string;
  /** Often stores LLPIN for LLPs (legacy invoice field name). */
  cin?: string;
  llpin?: string;
  iec?: string;
  addr1?: string;
  city?: string;
  state?: string;
  pin?: string;
  signatoryName?: string;
  signatoryDesignation?: string;
};

/** All Invoice → Client Address Book entries as TP service recipient profiles. */
export function listInvoiceClientRecipients(): ServiceRecipientProfile[] {
  try {
    const profiles = storage.get<InvoiceClientProfile[]>(StorageKeys.INVOICE_CLIENT_PROFILES) || [];
    return profiles
      .filter((p) => p?.name?.trim())
      .map((p, i) => ({
        id: `inv-client-${i}-${(p.name || '').trim().toLowerCase().replace(/\s+/g, '-')}`,
        label: (p.name || '').trim(),
        name: (p.name || '').trim(),
        address: p.addr || '',
        city: p.city || '',
        state: p.state || '',
        zip: p.pin || '',
        country: 'USA',
        ein: (p.pan || p.gstin || '').trim(),
        contactName: p.contact || '',
        email: p.email || '',
        phone: '',
      }));
  } catch {
    return [];
  }
}

/** All Invoice → Company profiles as TP service provider profiles. */
export function listInvoiceCompanyProviders(): ServiceProviderProfile[] {
  try {
    const profiles = storage.get<InvoiceCompanyBookProfile[]>(StorageKeys.INVOICE_COMPANY_PROFILES) || [];
    const active = storage.get<InvoiceCompanyBookProfile>(StorageKeys.INVOICE_ACTIVE_COMPANY);
    const list = [...profiles];
    if (active?.name?.trim() && !list.some((p) => (p.name || '').trim().toLowerCase() === active.name!.trim().toLowerCase())) {
      list.push(active);
    }
    return list
      .filter((p) => p?.name?.trim())
      .map((p, i) => ({
        id: `inv-co-${i}-${(p.name || '').trim().toLowerCase().replace(/\s+/g, '-')}`,
        label: (p.label || p.name || '').trim(),
        name: (p.name || '').trim(),
        address: p.addr1 || '',
        city: p.city || '',
        state: p.state || '',
        pin: p.pin || '',
        country: 'India',
        gstin: p.gstin || '',
        pan: p.pan || '',
        llpin: p.llpin || p.cin || '',
        iec: p.iec || '',
        signatoryName: p.signatoryName || '',
        signatoryTitle: p.signatoryDesignation || 'Partner',
      }));
  } catch {
    return [];
  }
}

export function recipientProfileFromForm(
  recipient: ExportInvoiceRecipient,
  label?: string,
  id?: string,
): ServiceRecipientProfile {
  const name = recipient.name.trim();
  return {
    id: id || `sr-${Date.now()}`,
    label: (label || name || 'Untitled recipient').trim(),
    ...recipient,
    name,
  };
}

export function providerProfileFromForm(
  provider: ExportInvoiceProvider,
  label?: string,
  id?: string,
): ServiceProviderProfile {
  const name = provider.name.trim();
  return {
    id: id || `sp-${Date.now()}`,
    label: (label || name || 'Untitled provider').trim(),
    ...provider,
    name,
  };
}

/** Full snapshot of a generated TP commercial invoice for reload / edit / delete. */
export interface TransferPricingInvoiceRecord {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountUsd: number;
  usRevenue: number;
  usExpenses: number;
  margin: number;
  exportConfig: ExportInvoiceConfig;
  providerId?: string | null;
  recipientId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function buildTransferPricingInvoiceRecord(input: {
  id?: string;
  createdAt?: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountUsd: number;
  usRevenue: number;
  usExpenses: number;
  margin: number;
  exportConfig: ExportInvoiceConfig;
  providerId?: string | null;
  recipientId?: string | null;
}): TransferPricingInvoiceRecord {
  const now = new Date().toISOString();
  return {
    id: input.id || `tp-inv-${Date.now()}`,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    amountUsd: input.amountUsd,
    usRevenue: input.usRevenue,
    usExpenses: input.usExpenses,
    margin: input.margin,
    exportConfig: JSON.parse(JSON.stringify(input.exportConfig)) as ExportInvoiceConfig,
    providerId: input.providerId ?? null,
    recipientId: input.recipientId ?? null,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

/** Upsert by id, or by invoice number when editing an existing generation. */
export function upsertTransferPricingInvoice(
  list: TransferPricingInvoiceRecord[],
  record: TransferPricingInvoiceRecord,
): TransferPricingInvoiceRecord[] {
  const byId = list.findIndex((r) => r.id === record.id);
  if (byId >= 0) {
    const next = [...list];
    next[byId] = { ...record, createdAt: list[byId].createdAt, updatedAt: new Date().toISOString() };
    return next;
  }
  const byNumber = list.findIndex((r) => r.invoiceNumber === record.invoiceNumber);
  if (byNumber >= 0) {
    const next = [...list];
    next[byNumber] = {
      ...record,
      id: list[byNumber].id,
      createdAt: list[byNumber].createdAt,
      updatedAt: new Date().toISOString(),
    };
    return next;
  }
  return [record, ...list];
}

export function deleteTransferPricingInvoice(
  list: TransferPricingInvoiceRecord[],
  id: string,
): TransferPricingInvoiceRecord[] {
  return list.filter((r) => r.id !== id);
}

/** Canonical EXP-2026-001 snapshot for history seeding. */
export function getDefaultCommercialInvoiceRecord(): TransferPricingInvoiceRecord {
  const exportConfig = getCommercialInvoiceDefaults({
    billingPeriod: 'August 2026',
    lastSeq: 1,
  });
  return buildTransferPricingInvoiceRecord({
    id: 'tp-inv-exp-2026-001',
    createdAt: '2026-08-05T00:00:00.000Z',
    invoiceNumber: 'EXP-2026-001',
    invoiceDate: '2026-08-05',
    amountUsd: exportConfig.rateUsd,
    usRevenue: exportConfig.rateUsd,
    usExpenses: 0,
    margin: 0,
    exportConfig,
    providerId: DEFAULT_TP_PROVIDER_ID,
    recipientId: DEFAULT_TP_RECIPIENT_ID,
  });
}

/** Rebuild a TP history row from an Invoice Ledger export invoice. */
export function transferPricingRecordFromLedgerInvoice(inv: Invoice): TransferPricingInvoiceRecord {
  const line = inv.lines?.[0];
  const amountUsd = inv.currency === 'USD' ? inv.total : inv.total;
  const exportConfig = getCommercialInvoiceDefaults({
    serviceDescription: line?.description,
    placeOfSupply: inv.placeOfSupply,
    rateUsd: amountUsd,
    qty: line?.quantity ?? 1,
    recipient: {
      ...COMMERCIAL_INVOICE_PARTY_DEFAULTS.recipient,
      name: inv.customerName || COMMERCIAL_INVOICE_PARTY_DEFAULTS.recipient.name,
      address: inv.customerAddress || COMMERCIAL_INVOICE_PARTY_DEFAULTS.recipient.address,
    },
  });
  const rawId = inv.id || `ledger-${inv.number}`;
  const id = rawId.startsWith('exp-') ? rawId.slice(4) : `tp-ledger-${rawId}`;
  return buildTransferPricingInvoiceRecord({
    id,
    createdAt: inv.createdAt,
    invoiceNumber: inv.number,
    invoiceDate: inv.date,
    amountUsd,
    usRevenue: amountUsd,
    usExpenses: 0,
    margin: 0,
    exportConfig,
    providerId: DEFAULT_TP_PROVIDER_ID,
    recipientId: DEFAULT_TP_RECIPIENT_ID,
  });
}

/**
 * Ensure TP Saved Invoices has rows to show.
 * Prefer existing history; otherwise backfill from Invoice Ledger EXP/* exports;
 * otherwise seed the canonical EXP-2026-001 default.
 */
export function ensureCommercialInvoiceHistory(
  existing?: TransferPricingInvoiceRecord[] | null,
): TransferPricingInvoiceRecord[] {
  const list = (existing || []).filter((r) => r?.invoiceNumber && r?.exportConfig);
  if (list.length > 0) return list;

  const fromLedger: TransferPricingInvoiceRecord[] = [];
  try {
    const ledger = getInvoices().filter(
      (i) =>
        /^EXP-/i.test(i.number || '') ||
        i.incomeType === 'export_of_services' ||
        (i.id || '').startsWith('exp-'),
    );
    const byNumber = new Map<string, Invoice>();
    for (const inv of ledger) {
      const prev = byNumber.get(inv.number);
      if (!prev || (inv.updatedAt || '') >= (prev.updatedAt || '')) {
        byNumber.set(inv.number, inv);
      }
    }
    for (const inv of byNumber.values()) {
      fromLedger.push(transferPricingRecordFromLedgerInvoice(inv));
    }
  } catch {
    /* ledger unavailable */
  }

  if (fromLedger.length > 0) {
    return fromLedger.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  return [getDefaultCommercialInvoiceRecord()];
}

/** Upsert provider/recipient profiles from the current invoice form (keeps modifications). */
export function syncPartyProfilesFromInvoice(input: {
  providers: ServiceProviderProfile[];
  recipients: ServiceRecipientProfile[];
  provider: ExportInvoiceProvider;
  recipient: ExportInvoiceRecipient;
  activeProviderId?: string | null;
  activeRecipientId?: string | null;
}): {
  providers: ServiceProviderProfile[];
  recipients: ServiceRecipientProfile[];
  activeProviderId: string | null;
  activeRecipientId: string | null;
} {
  let providers = [...input.providers];
  let recipients = [...input.recipients];
  let activeProviderId = input.activeProviderId || null;
  let activeRecipientId = input.activeRecipientId || null;

  if (input.provider.name.trim()) {
    const existing =
      (activeProviderId && providers.find((p) => p.id === activeProviderId)) ||
      providers.find((p) => p.name.trim().toLowerCase() === input.provider.name.trim().toLowerCase());
    const profile = providerProfileFromForm(
      input.provider,
      existing?.label || input.provider.name.trim(),
      existing?.id,
    );
    providers = [
      ...providers.filter((p) => p.id !== profile.id && p.name.trim().toLowerCase() !== profile.name.toLowerCase()),
      profile,
    ];
    activeProviderId = profile.id;
  }

  if (input.recipient.name.trim()) {
    const existing =
      (activeRecipientId && recipients.find((r) => r.id === activeRecipientId)) ||
      recipients.find((r) => r.name.trim().toLowerCase() === input.recipient.name.trim().toLowerCase());
    const profile = recipientProfileFromForm(
      input.recipient,
      existing?.label || input.recipient.name.trim(),
      existing?.id,
    );
    recipients = [
      ...recipients.filter((r) => r.id !== profile.id && r.name.trim().toLowerCase() !== profile.name.toLowerCase()),
      profile,
    ];
    activeRecipientId = profile.id;
  }

  return { providers, recipients, activeProviderId, activeRecipientId };
}

export interface ExportInvoiceConfig {
  lutNumber: string;
  paymentTerms: string;
  billingPeriod: string;
  placeOfSupply: string;
  agreementDate: string;
  agreementReference: string;
  serviceDescription: string;
  sacCode: string;
  purposeCode: string;
  qty: number;
  rateUsd: number;
  useCalculatedAmount: boolean;
  /** @deprecated Prefer `recipient.address` — kept for older saved configs. */
  recipientAddress: string;
  recipient: ExportInvoiceRecipient;
  provider: ExportInvoiceProvider;
  bank: ExportInvoiceBankDetails;
  signatoryTitle: string;
  lastSeq?: number;
}

export interface ExportInvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  providerName: string;
  providerAddress: string;
  providerState: string;
    providerGstin: string;
  providerPan: string;
  providerLlpin?: string;
  providerIec?: string;
  recipientName: string;
  recipientAddress: string;
  recipientState: string;
  recipientEin: string;
  recipientCity?: string;
  recipientZip?: string;
  recipientCountry?: string;
  recipientContactName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  config: ExportInvoiceConfig;
  amountUsd: number;
}

type InvoiceCompanyProfile = {
  name?: string;
  gstin?: string;
  pan?: string;
  addr1?: string;
  city?: string;
  state?: string;
  pin?: string;
  phone?: string;
  email?: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  bankName?: string;
  bankAccName?: string;
  bankAccNum?: string;
  bankBranch?: string;
  bankSWIFT?: string;
};

function loadInvoiceCompanyProfile(): Partial<InvoiceCompanyProfile> {
  try {
    const active = storage.get<Partial<InvoiceCompanyProfile>>(StorageKeys.INVOICE_ACTIVE_COMPANY);
    if (active?.name) return active;
    const profiles = storage.get<InvoiceCompanyProfile[]>(StorageKeys.INVOICE_COMPANY_PROFILES);
    if (profiles?.length) return profiles[profiles.length - 1];
  } catch {
    /* ignore */
  }
  return {};
}

/** Most recently saved Invoice → Client Address Book entry (or last ledger customer). */
function loadInvoiceClientProfile(): Partial<InvoiceClientProfile> {
  try {
    const profiles = storage.get<InvoiceClientProfile[]>(StorageKeys.INVOICE_CLIENT_PROFILES);
    if (profiles?.length) {
      // Prefer profiles that look like US/export recipients (have name); take latest.
      const withName = profiles.filter((p) => p?.name?.trim());
      if (withName.length) return withName[withName.length - 1];
      return profiles[profiles.length - 1];
    }
  } catch {
    /* ignore */
  }
  // Fall back to last invoice on the active org ledger
  try {
    const list = getInvoices();
    for (const inv of list) {
      if (inv.customerName?.trim()) {
        return {
          name: inv.customerName,
          addr: inv.customerAddress || '',
          gstin: inv.customerGstin || '',
          pan: '',
          city: '',
          state: '',
          pin: '',
          contact: '',
          email: '',
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

function providerFromEntity(): ExportInvoiceProvider {
  const entity = getEntityRegistry();
  const profile = getCompanyProfile();
  const parent = profile?.parent;
  const a = entity.registeredAddress;
  return {
    name: entity.legalName || parent?.name || '',
    address: [a.line1, a.line2].filter(Boolean).join(', '),
    city: a.city || parent?.city || '',
    state: a.state || entity.state || parent?.state || 'Maharashtra',
    pin: a.pin || parent?.pin || '',
    country: 'India',
    gstin: entity.gstin || parent?.taxId || '',
    pan: entity.pan || parent?.pan || '',
    llpin: entity.llpin || parent?.llpin || '',
    iec: entity.iec || '',
    signatoryName: '',
    signatoryTitle: 'Partner',
  };
}

function providerFromDocuments(): ExportInvoiceProvider {
  const base = providerFromEntity();
  const co = loadInvoiceCompanyProfile();
  if (!co.name && !co.gstin && !co.addr1) return base;
  return {
    name: co.name || base.name,
    address: co.addr1 || base.address,
    city: co.city || base.city,
    state: co.state || base.state,
    pin: co.pin || base.pin,
    country: 'India',
    gstin: co.gstin || base.gstin,
    pan: co.pan || base.pan,
    llpin: co.llpin || co.cin || base.llpin,
    iec: co.iec || base.iec,
    signatoryName: co.signatoryName || base.signatoryName,
    signatoryTitle: co.signatoryDesignation || base.signatoryTitle || 'Partner',
  };
}

function recipientFromEntity(): ExportInvoiceRecipient {
  const entity = getEntityRegistry();
  const us = entity.subsidiary;
  const profile = getCompanyProfile();
  const subsidiary = profile?.subsidiary;
  const op = us.operatingAddress;
  return {
    name: subsidiary?.name || us.legalName || '',
    address: op?.city
      ? ''
      : (formatSubsidiaryAddress().split('\n').slice(1).join('\n') || ''),
    city: op?.city || '',
    state: op?.state || subsidiary?.state || us.stateOfIncorporation || '',
    zip: op?.zip || '',
    country: op?.country || 'USA',
    ein: subsidiary?.taxId || us.ein || '',
    contactName: '',
    email: '',
    phone: '',
  };
}

/** Prefer Invoice module client profiles / prior invoices, then entity registry. */
function recipientFromDocuments(): ExportInvoiceRecipient {
  const base = recipientFromEntity();
  const client = loadInvoiceClientProfile();
  if (!client.name && !client.addr && !client.pan) return base;

  // EIN for US recipients is often stored in pan or gstin field on client profiles
  const ein = (client.pan || client.gstin || base.ein || '').trim();
  return {
    name: client.name || base.name,
    address: client.addr || base.address,
    city: client.city || base.city,
    state: client.state || base.state,
    zip: client.pin || base.zip,
    country: base.country || 'USA',
    ein: ein || base.ein,
    contactName: client.contact || base.contactName,
    email: client.email || base.email,
    phone: base.phone,
  };
}

function formatProviderAddressBlock(p: ExportInvoiceProvider): string {
  const lines: string[] = [];
  if (p.address?.trim()) lines.push(p.address.trim());
  const cityLine = [p.city, p.state, p.pin].filter(Boolean).join(', ').trim();
  if (cityLine) lines.push(cityLine);
  if (p.country?.trim()) lines.push(p.country.trim());
  return lines.join('\n');
}

/** Compose multi-line address block for invoice display. */
export function formatRecipientAddressBlock(r: ExportInvoiceRecipient): string {
  const lines: string[] = [];
  if (r.address?.trim()) lines.push(r.address.trim());
  const cityLine = [r.city, r.state, r.zip].filter(Boolean).join(', ').trim();
  if (cityLine) lines.push(cityLine);
  if (r.country?.trim()) lines.push(r.country.trim());
  return lines.join('\n');
}

export function getDefaultRecipientDetails(): ExportInvoiceRecipient {
  return recipientFromDocuments();
}

export function getDefaultProviderDetails(): ExportInvoiceProvider {
  return providerFromDocuments();
}

function bankFromDocuments(provider: ExportInvoiceProvider): ExportInvoiceBankDetails {
  const co = loadInvoiceCompanyProfile();
  const entity = getEntityRegistry();
  const defaults = COMMERCIAL_INVOICE_PARTY_DEFAULTS.bank;
  return {
    beneficiaryName: co.bankAccName || provider.name || entity.legalName || defaults.beneficiaryName,
    accountNumber: co.bankAccNum || defaults.accountNumber,
    bankName: co.bankName || defaults.bankName,
    branchAddress: co.bankBranch || defaults.branchAddress,
    swiftCode: co.bankSWIFT || defaults.swiftCode,
    adCode: defaults.adCode,
  };
}

/**
 * Canonical commercial-invoice defaults verified from
 * Commercial Invoice EXP-2026-001 (Domestic PDF, 2026-08-05).
 * Used every time a new TP invoice is created.
 */
export const DEFAULT_TP_PROVIDER_ID = 'sp-default-exp-2026-001';
export const DEFAULT_TP_RECIPIENT_ID = 'sr-default-exp-2026-001';

export const COMMERCIAL_INVOICE_PARTY_DEFAULTS = {
  provider: {
    name: 'SYSTEMDR LLP',
    address: 'P No.70, F No. 202, Green Planet colony Besa, Parvati Nagar, Besa Police Station',
    city: 'Nagpur',
    state: 'Maharashtra',
    pin: '440027',
    country: 'India',
    gstin: '27AFQFS5950Q1ZU',
    pan: 'AFQFS5950Q',
    llpin: 'ACP-3421',
    iec: '',
    signatoryName: 'Sumedh Shende',
    signatoryTitle: 'Designated Partner',
  } satisfies ExportInvoiceProvider,
  recipient: {
    name: 'SystemDR, Inc.',
    address: '131 Continental Dr, Suite 305',
    city: 'Newark',
    state: 'Delaware',
    zip: '19713',
    country: 'USA',
    ein: '35-2939054',
    contactName: 'Sumedh Shende',
    email: 'corp@systemdrd.com',
    phone: '+91 8767849570',
  } satisfies ExportInvoiceRecipient,
  bank: {
    beneficiaryName: 'SYSTEMDR LLP',
    accountNumber: '575705000010',
    bankName: 'ICICI Bank',
    branchAddress: 'Ajani, Wardha Road, Nagpur, Maharashtra, 440015',
    swiftCode: 'ICICINBBCTS',
    adCode: '63901XE',
  } satisfies ExportInvoiceBankDetails,
  serviceDescription:
    'Software, Information Technology (IT), Courses & Lessons and Digital product design, development services for www.systemdrd.com. Technology Content services for 21 newsletters. https://systemdr.systemdrd.com, https://sdcourse.substack.com, https://aiamastery.substack.com, https://aieworks.substack.com, https://javatsc.substack.com, https://handsonkafka.substack.com',
  agreementReference: 'Intercompany Service Agreement',
  agreementDate: '2026-01-01',
  paymentTerms: 'Net 30',
  lutNumber: 'AD270326080742Y',
  placeOfSupply: 'Newark, Delaware, USA',
  sacCode: EXPORT_SAC_CODE,
  purposeCode: EXPORT_PURPOSE_CODE,
  rateUsd: 11875,
} as const;

export function getDefaultProviderProfile(): ServiceProviderProfile {
  return {
    id: DEFAULT_TP_PROVIDER_ID,
    label: 'SYSTEMDR LLP (Default — EXP-2026-001)',
    ...COMMERCIAL_INVOICE_PARTY_DEFAULTS.provider,
  };
}

export function getDefaultRecipientProfile(): ServiceRecipientProfile {
  return {
    id: DEFAULT_TP_RECIPIENT_ID,
    label: 'SystemDR, Inc. (Default — EXP-2026-001)',
    ...COMMERCIAL_INVOICE_PARTY_DEFAULTS.recipient,
  };
}

/** Full export config defaults for Create Invoice — always reloadable. */
export function getCommercialInvoiceDefaults(
  overrides?: Partial<ExportInvoiceConfig>,
): ExportInvoiceConfig {
  const d = COMMERCIAL_INVOICE_PARTY_DEFAULTS;
  const billingPeriod =
    (overrides?.billingPeriod || '').trim() ||
    new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  const fillProvider = (partial?: Partial<ExportInvoiceProvider>): ExportInvoiceProvider => {
    const out = { ...d.provider };
    if (!partial) return out;
    for (const key of Object.keys(out) as (keyof ExportInvoiceProvider)[]) {
      const v = partial[key];
      if (typeof v === 'string' && v.trim()) out[key] = v;
    }
    return out;
  };
  const fillRecipient = (partial?: Partial<ExportInvoiceRecipient>): ExportInvoiceRecipient => {
    const out = { ...d.recipient };
    if (!partial) return out;
    for (const key of Object.keys(out) as (keyof ExportInvoiceRecipient)[]) {
      const v = partial[key];
      if (typeof v === 'string' && v.trim()) out[key] = v;
    }
    return out;
  };
  const fillBank = (partial?: Partial<ExportInvoiceBankDetails>): ExportInvoiceBankDetails => {
    const out = { ...d.bank };
    if (!partial) return out;
    for (const key of Object.keys(out) as (keyof ExportInvoiceBankDetails)[]) {
      const v = partial[key];
      if (typeof v === 'string' && v.trim()) out[key] = v;
    }
    return out;
  };

  const provider = fillProvider(overrides?.provider);
  const recipient = fillRecipient(overrides?.recipient);
  const bank = fillBank(overrides?.bank);

  return {
    lutNumber: (overrides?.lutNumber || '').trim() || d.lutNumber,
    paymentTerms: (overrides?.paymentTerms || '').trim() || d.paymentTerms,
    billingPeriod,
    placeOfSupply: (overrides?.placeOfSupply || '').trim() || d.placeOfSupply,
    agreementDate: (overrides?.agreementDate || '').trim() || d.agreementDate,
    agreementReference: (overrides?.agreementReference || '').trim() || d.agreementReference,
    serviceDescription: (overrides?.serviceDescription || '').trim() || d.serviceDescription,
    sacCode: (overrides?.sacCode || '').trim() || d.sacCode,
    purposeCode: (overrides?.purposeCode || '').trim() || d.purposeCode,
    qty: overrides?.qty ?? 1,
    rateUsd: overrides?.rateUsd ?? d.rateUsd,
    useCalculatedAmount: overrides?.useCalculatedAmount ?? true,
    recipientAddress: formatRecipientAddressBlock(recipient),
    recipient,
    provider,
    bank,
    signatoryTitle: (overrides?.signatoryTitle || '').trim() || provider.signatoryTitle,
    lastSeq: overrides?.lastSeq,
  };
}

const DEFAULT_CONFIG: ExportInvoiceConfig = getCommercialInvoiceDefaults();

export function getDefaultExportInvoiceConfig(
  saved?: Partial<ExportInvoiceConfig>,
): ExportInvoiceConfig {
  // Always start from verified EXP-2026-001 defaults, then layer saved/document values.
  const base = getCommercialInvoiceDefaults();
  const docRecipient = recipientFromDocuments();
  const docProvider = providerFromDocuments();
  const docBank = bankFromDocuments(docProvider);

  const mergedRecipient: ExportInvoiceRecipient = {
    ...base.recipient,
    ...docRecipient,
    ...(saved?.recipient || {}),
  };
  for (const key of Object.keys(base.recipient) as (keyof ExportInvoiceRecipient)[]) {
    if (!String(mergedRecipient[key] || '').trim() && String(base.recipient[key] || '').trim()) {
      mergedRecipient[key] = base.recipient[key];
    }
  }
  if (String(mergedRecipient.ein || '').startsWith('enc:v1:')) {
    mergedRecipient.ein = base.recipient.ein;
  }

  if (!saved?.recipient && saved?.recipientAddress) {
    const legacy = saved.recipientAddress.trim();
    const parts = legacy.split('\n').map((l) => l.trim()).filter(Boolean);
    if (parts.length && !mergedRecipient.address) {
      mergedRecipient.address = parts[0] === mergedRecipient.name
        ? parts.slice(1).join('\n')
        : legacy;
    }
  }

  const mergedProvider: ExportInvoiceProvider = {
    ...base.provider,
    ...docProvider,
    ...(saved?.provider || {}),
  };
  for (const key of Object.keys(base.provider) as (keyof ExportInvoiceProvider)[]) {
    if (!String(mergedProvider[key] || '').trim() && String(base.provider[key] || '').trim()) {
      mergedProvider[key] = base.provider[key];
    }
  }

  const mergedBank: ExportInvoiceBankDetails = {
    ...base.bank,
    ...docBank,
    ...(saved?.bank || {}),
  };
  for (const key of Object.keys(base.bank) as (keyof ExportInvoiceBankDetails)[]) {
    if (!String(mergedBank[key] || '').trim() && String(base.bank[key] || '').trim()) {
      mergedBank[key] = base.bank[key];
    }
  }

  const addressBlock = formatRecipientAddressBlock(mergedRecipient);
  const signatoryTitle =
    saved?.signatoryTitle ||
    mergedProvider.signatoryTitle ||
    base.signatoryTitle ||
    'Designated Partner';

  return {
    ...base,
    ...saved,
    lutNumber: saved?.lutNumber || base.lutNumber,
    paymentTerms: saved?.paymentTerms || base.paymentTerms,
    billingPeriod: saved?.billingPeriod || base.billingPeriod,
    placeOfSupply: saved?.placeOfSupply || base.placeOfSupply,
    agreementDate: saved?.agreementDate || base.agreementDate,
    agreementReference: saved?.agreementReference || base.agreementReference,
    serviceDescription: saved?.serviceDescription || base.serviceDescription,
    sacCode: saved?.sacCode || base.sacCode,
    purposeCode: saved?.purposeCode || base.purposeCode,
    bank: mergedBank,
    recipient: mergedRecipient,
    provider: mergedProvider,
    recipientAddress: addressBlock || saved?.recipientAddress || base.recipientAddress,
    signatoryTitle,
  };
}

export function peekExportInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const stored = Number(localStorage.getItem(`export_invoice_seq_${year}`) || '0') + 1;
  return `EXP-${year}-${String(stored).padStart(3, '0')}`;
}

export function generateExportInvoiceNumber(seq?: number): string {
  const year = new Date().getFullYear();
  const stored = seq ?? Number(localStorage.getItem(`export_invoice_seq_${year}`) || '0') + 1;
  localStorage.setItem(`export_invoice_seq_${year}`, String(stored));
  return `EXP-${year}-${String(stored).padStart(3, '0')}`;
}

export function roundUsdWhole(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

/** Format USD as whole dollars only (no cents), e.g. $11,875. */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(roundUsdWhole(amount));
}

export function formatInvoiceDate(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** USD amount in words (international numbering) — whole dollars only. */
export function usdAmountInWords(amount: number): string {
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convertBelow1000 = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) {
      const t = Math.floor(n / 10);
      const o = n % 10;
      return o ? `${tens[t]} ${ones[o]}` : tens[t];
    }
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r ? `${ones[h]} Hundred ${convertBelow1000(r)}` : `${ones[h]} Hundred`;
  };

  const convert = (n: number): string => {
    if (n === 0) return 'Zero';
    if (n < 1000) return convertBelow1000(n);
    if (n < 1_000_000) {
      const th = Math.floor(n / 1000);
      const r = n % 1000;
      return r
        ? `${convertBelow1000(th)} Thousand ${convertBelow1000(r)}`
        : `${convertBelow1000(th)} Thousand`;
    }
    if (n < 1_000_000_000) {
      const m = Math.floor(n / 1_000_000);
      const r = n % 1_000_000;
      return r ? `${convert(m)} Million ${convert(r)}` : `${convert(m)} Million`;
    }
    const b = Math.floor(n / 1_000_000_000);
    const r = n % 1_000_000_000;
    return r ? `${convert(b)} Billion ${convert(r)}` : `${convert(b)} Billion`;
  };

  const major = roundUsdWhole(amount);
  return `${convert(major)} US Dollars`;
}

export function buildExportInvoiceData(
  config: ExportInvoiceConfig,
  calculatedAmountUsd: number,
  overrides?: Partial<Pick<ExportInvoiceData, 'invoiceNumber' | 'invoiceDate'>>,
): ExportInvoiceData {
  const profile = getCompanyProfile();
  const subsidiary = profile?.subsidiary;
  const entity = getEntityRegistry();
  const us = entity.subsidiary;

  const amountUsd = roundUsdWhole(
    config.useCalculatedAmount
      ? calculatedAmountUsd
      : config.qty * config.rateUsd,
  );

  const provider = config.provider?.name
    ? config.provider
    : { ...getDefaultProviderDetails(), ...(config.provider || {}) };
  const providerAddress =
    formatProviderAddressBlock(provider) || formatRegisteredAddress();

  const monthYear = new Date(overrides?.invoiceDate ?? new Date().toISOString().split('T')[0])
    .toLocaleString('default', { month: 'long', year: 'numeric' });
  const billingPeriod = (config.billingPeriod || '').trim() || monthYear;

  const serviceLine = config.serviceDescription.includes(billingPeriod)
    ? config.serviceDescription
    : `${config.serviceDescription} for the month of ${billingPeriod}.`;

  const recipient = config.recipient?.name
    ? config.recipient
    : { ...getDefaultRecipientDetails(), ...(config.recipient || {}) };
  const recipientAddress =
    formatRecipientAddressBlock(recipient) ||
    config.recipientAddress ||
    formatSubsidiaryAddress();

  const signatoryTitle =
    config.signatoryTitle || provider.signatoryTitle || 'Partner';

  return {
    invoiceNumber: overrides?.invoiceNumber ?? generateExportInvoiceNumber(config.lastSeq),
    invoiceDate: overrides?.invoiceDate ?? new Date().toISOString().split('T')[0],
    providerName: provider.name || entity.legalName || 'India LLP',
    providerAddress,
    providerState: provider.state || entity.registeredAddress.state || 'Maharashtra',
    providerGstin: provider.gstin || entity.gstin || '',
    providerPan: provider.pan || entity.pan || '',
    providerLlpin: provider.llpin || entity.llpin || '',
    providerIec: provider.iec || '',
    recipientName: recipient.name || subsidiary?.name || us.legalName,
    recipientAddress,
    recipientState: recipient.state || us.operatingAddress?.state || subsidiary?.state || us.stateOfIncorporation,
    recipientEin: recipient.ein || subsidiary?.taxId || us.ein || '',
    recipientCity: recipient.city || undefined,
    recipientZip: recipient.zip || undefined,
    recipientCountry: recipient.country || undefined,
    recipientContactName: recipient.contactName || undefined,
    recipientEmail: recipient.email || undefined,
    recipientPhone: recipient.phone || undefined,
    config: {
      ...config,
      billingPeriod,
      provider,
      recipient,
      recipientAddress,
      signatoryTitle,
      serviceDescription: serviceLine,
    },
    amountUsd,
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateExportInvoiceHtml(data: ExportInvoiceData): string {
  const { config } = data;
  const signatory =
    config.provider?.signatoryName ||
    loadInvoiceCompanyProfile().signatoryName ||
    'Authorized Signatory';
  const agreementRef = `Reference: ${config.agreementReference} dated ${formatInvoiceDate(config.agreementDate)}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Commercial Invoice ${esc(data.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 820px; margin: 32px auto; padding: 24px; color: #1e293b; font-size: 13px; line-height: 1.5; }
    .lut-banner { background: #fef3c7; border: 2px solid #d97706; padding: 10px 14px; text-align: center; font-weight: 700; font-size: 11px; letter-spacing: 0.03em; margin-bottom: 24px; color: #92400e; }
    h1 { font-size: 22px; text-align: center; margin: 0 0 20px; letter-spacing: 0.08em; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; }
    .meta-table td:first-child { width: 38%; font-weight: 600; background: #f8fafc; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; align-items: start; }
    .entity-block { border: 1px solid #cbd5e1; border-radius: 4px; padding: 10px 12px; margin: 0; }
    .entity-block h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin: 0 0 6px; }
    .entity-block p { margin: 2px 0; }
    .services th { background: #1e3a5f; color: #fff; }
    .total-row { font-weight: 700; font-size: 14px; }
    .amount-words { font-style: italic; color: #475569; margin-top: 4px; }
    .wire-section h3 { font-size: 13px; margin-bottom: 8px; }
    .signatory { margin-top: 40px; }
    .signatory .line { border-top: 1px solid #334155; width: 240px; margin-top: 48px; padding-top: 6px; }
    .footer-note { margin-top: 32px; font-size: 10px; color: #94a3b8; text-align: center; }
    @media print {
      body { margin: 0; padding: 16px; }
      .parties { gap: 12px; }
    }
  </style>
</head>
<body>
  <div class="lut-banner">${LUT_DECLARATION}</div>
  <h1>COMMERCIAL INVOICE</h1>

  <table class="meta-table">
    <tr><td>Invoice Number</td><td>${esc(data.invoiceNumber)}</td></tr>
    <tr><td>Invoice Date</td><td>${esc(formatInvoiceDate(data.invoiceDate))}</td></tr>
    <tr><td>Payment Terms</td><td>${esc(config.paymentTerms)}</td></tr>
    <tr><td>Billing Period</td><td>${esc(config.billingPeriod || '[Month Year]')}</td></tr>
    <tr><td>Place of Supply</td><td>${esc(config.placeOfSupply)}</td></tr>
    <tr><td>LUT Number</td><td>${esc(config.lutNumber || '[Insert Your 2026-2027 ARN Number]')}</td></tr>
  </table>

  <div class="parties">
    <div class="entity-block">
      <h3>From (Service Provider)</h3>
      <p><strong>${esc(data.providerName)}</strong></p>
      <p>${esc(data.providerAddress).replace(/\n/g, '<br>')}</p>
      <p><strong>GSTIN:</strong> ${esc(data.providerGstin || '[Your 15-digit GST Number]')}</p>
      <p><strong>PAN:</strong> ${esc(data.providerPan || '[LLP PAN Number]')}</p>
      <p><strong>LLP Incorporation Code:</strong> ${esc(data.providerLlpin || data.config.provider?.llpin || '[LLPIN]')}</p>
      <p><strong>Import / Export Code:</strong> ${esc(data.providerIec || data.config.provider?.iec || '[IEC Number]')}</p>
    </div>
    <div class="entity-block">
      <h3>To (Service Recipient)</h3>
      <p><strong>${esc(data.recipientName)}</strong></p>
      <p>${esc(data.recipientAddress).replace(/\n/g, '<br>')}</p>
      ${data.recipientContactName ? `<p><strong>Contact:</strong> ${esc(data.recipientContactName)}</p>` : ''}
      ${data.recipientEmail ? `<p><strong>Email:</strong> ${esc(data.recipientEmail)}</p>` : ''}
      ${data.recipientPhone ? `<p><strong>Phone:</strong> ${esc(data.recipientPhone)}</p>` : ''}
      <p><strong>EIN:</strong> ${esc(data.recipientEin || '[US Employer Identification Number]')}</p>
    </div>
  </div>

  <h3 style="margin-top: 24px;">Service Description</h3>
  <table class="services">
    <thead>
      <tr>
        <th>SAC Code</th>
        <th>Description of Services</th>
        <th>Qty / Hours</th>
        <th>Rate (USD)</th>
        <th>Amount (USD)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${esc(config.sacCode)}</strong></td>
        <td>${esc(config.serviceDescription)}<br><em style="color:#64748b;font-size:11px;">${esc(agreementRef)}</em></td>
        <td>${config.qty}</td>
        <td>${formatUsd(config.useCalculatedAmount ? data.amountUsd : config.rateUsd)}</td>
        <td>${formatUsd(data.amountUsd)}</td>
      </tr>
    </tbody>
  </table>

  <p class="total-row">Total Invoice Value: ${formatUsd(data.amountUsd)} USD</p>
  <p class="amount-words">(Amount in words: ${esc(usdAmountInWords(data.amountUsd))})</p>

  <div class="wire-section">
    <h3>Wire Transfer Instructions (Inward Remittance)</h3>
    <p style="font-size:12px;color:#475569;margin-bottom:12px;">To ensure the issuance of a Foreign Inward Remittance Certificate (FIRC) by the Reserve Bank of India, please route funds precisely as follows:</p>
    <table class="meta-table">
      <tr><td>Beneficiary Name</td><td>${esc(config.bank.beneficiaryName || '[Your LLP Bank Account Name]')}</td></tr>
      <tr><td>Beneficiary Account No.</td><td>${esc(config.bank.accountNumber || '[Current Account Number]')}</td></tr>
      <tr><td>Beneficiary Bank Name</td><td>${esc(config.bank.bankName || '[Your Indian Bank]')}</td></tr>
      <tr><td>Bank Branch Address</td><td>${esc(config.bank.branchAddress || '[Branch Location]')}</td></tr>
      <tr><td>Bank SWIFT Code</td><td>${esc(config.bank.swiftCode || '[8 or 11 Character SWIFT]')}</td></tr>
      <tr><td>Purpose Code</td><td>${esc(config.purposeCode)} (Software consultancy/implementation)</td></tr>
      <tr><td>AD Code</td><td>${esc(config.bank.adCode || '[Authorized Dealer Code of your branch]')}</td></tr>
    </table>
  </div>

  <div class="signatory">
    <p><strong>Authorized Signatory</strong></p>
    <div class="line">
      <strong>${config.signatoryTitle}</strong>, ${esc(data.providerName)}<br>
      ${esc(signatory)}
    </div>
  </div>

  <p class="footer-note">Generated by Project Suez Financial OS — B2B Export of Services</p>
</body>
</html>`;
}

export function openExportInvoicePrint(data: ExportInvoiceData): void {
  const html = generateExportInvoiceHtml(data);
  const printWin = window.open('', '_blank');
  if (!printWin) {
    alert('Please allow popups to export as PDF, then use Print → Save as PDF.');
    return;
  }
  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => {
    printWin.print();
  }, 300);
}

export function buildInvoiceRecordFromExport(data: ExportInvoiceData): Invoice {
  const now = new Date().toISOString();
  const due = new Date(data.invoiceDate);
  due.setDate(due.getDate() + 30);

  return {
    id: `exp-inv-${Date.now()}`,
    number: data.invoiceNumber,
    date: data.invoiceDate,
    dueDate: due.toISOString().split('T')[0],
    customerName: data.recipientName,
    customerAddress: data.recipientAddress,
    customerCountry: 'US',
    placeOfSupply: data.config.placeOfSupply,
    status: 'Draft' as InvoiceStatus,
    currency: 'USD',
    subtotal: data.amountUsd,
    taxTotal: 0,
    total: data.amountUsd,
    lines: [
      {
        id: 'line-1',
        description: data.config.serviceDescription,
        quantity: data.config.qty,
        unit: 'Service',
        unitPrice: data.config.useCalculatedAmount ? data.amountUsd : data.config.rateUsd,
        amount: data.amountUsd,
        currency: 'USD',
        taxRate: 0,
        taxAmount: 0,
      },
    ],
    entity: 'parent',
    notes: `${LUT_DECLARATION} SAC ${data.config.sacCode}. Purpose ${data.config.purposeCode}. LUT: ${data.config.lutNumber}`,
    isForeignIncome: true,
    incomeType: 'export_of_services',
    classification: RevenueCategory.EXPORT,
    createdAt: now,
    updatedAt: now,
  };
}
