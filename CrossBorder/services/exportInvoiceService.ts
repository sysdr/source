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

export interface ExportInvoiceConfig {
  lutNumber: string;
  paymentTerms: string;
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
  return {
    beneficiaryName: co.bankAccName || provider.name || entity.legalName || '',
    accountNumber: co.bankAccNum || '',
    bankName: co.bankName || '',
    branchAddress: co.bankBranch || [provider.city, provider.state].filter(Boolean).join(', '),
    swiftCode: co.bankSWIFT || '',
    adCode: '',
  };
}

const DEFAULT_CONFIG: ExportInvoiceConfig = {
  lutNumber: getCurrentLutArn(),
  paymentTerms: 'Net 30',
  placeOfSupply: getSubsidiaryPlaceOfSupply(),
  agreementDate: '2026-01-01',
  agreementReference: 'Intercompany Service Agreement',
  serviceDescription: 'Information Technology (IT) design and development services',
  sacCode: EXPORT_SAC_CODE,
  purposeCode: EXPORT_PURPOSE_CODE,
  qty: 1,
  rateUsd: 5000,
  useCalculatedAmount: true,
  recipientAddress: '',
  recipient: {
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
  },
  provider: {
    name: '',
    address: '',
    city: '',
    state: '',
    pin: '',
    country: 'India',
    gstin: '',
    pan: '',
    signatoryName: '',
    signatoryTitle: 'Partner',
  },
  bank: {
    beneficiaryName: '',
    accountNumber: '',
    bankName: '',
    branchAddress: '',
    swiftCode: '',
    adCode: '',
  },
  signatoryTitle: 'Partner',
};

export function getDefaultExportInvoiceConfig(
  saved?: Partial<ExportInvoiceConfig>,
): ExportInvoiceConfig {
  const docRecipient = recipientFromDocuments();
  const docProvider = providerFromDocuments();
  const docBank = bankFromDocuments(docProvider);

  const mergedRecipient: ExportInvoiceRecipient = {
    ...docRecipient,
    ...(saved?.recipient || {}),
  };
  // Fill blank saved fields from documents (so old TP saves still pick up address book)
  for (const key of Object.keys(docRecipient) as (keyof ExportInvoiceRecipient)[]) {
    if (!String(mergedRecipient[key] || '').trim() && String(docRecipient[key] || '').trim()) {
      mergedRecipient[key] = docRecipient[key];
    }
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
    ...docProvider,
    ...(saved?.provider || {}),
  };
  for (const key of Object.keys(docProvider) as (keyof ExportInvoiceProvider)[]) {
    if (!String(mergedProvider[key] || '').trim() && String(docProvider[key] || '').trim()) {
      mergedProvider[key] = docProvider[key];
    }
  }

  const mergedBank: ExportInvoiceBankDetails = {
    ...docBank,
    ...(saved?.bank || {}),
  };
  for (const key of Object.keys(docBank) as (keyof ExportInvoiceBankDetails)[]) {
    if (!String(mergedBank[key] || '').trim() && String(docBank[key] || '').trim()) {
      mergedBank[key] = docBank[key];
    }
  }

  const addressBlock = formatRecipientAddressBlock(mergedRecipient);
  const signatoryTitle =
    saved?.signatoryTitle ||
    mergedProvider.signatoryTitle ||
    docProvider.signatoryTitle ||
    'Partner';

  return {
    ...DEFAULT_CONFIG,
    ...saved,
    lutNumber: saved?.lutNumber || getCurrentLutArn(),
    placeOfSupply: saved?.placeOfSupply || getSubsidiaryPlaceOfSupply(),
    bank: mergedBank,
    recipient: mergedRecipient,
    provider: mergedProvider,
    recipientAddress: addressBlock || saved?.recipientAddress || formatSubsidiaryAddress(),
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

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatInvoiceDate(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** USD amount in words (international numbering). */
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

  const major = Math.floor(amount);
  const cents = Math.round((amount - major) * 100);
  const words = convert(major);
  if (cents > 0) {
    return `${words} US Dollars and ${convert(cents)} Cents`;
  }
  return `${words} US Dollars`;
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

  const amountUsd = config.useCalculatedAmount
    ? calculatedAmountUsd
    : config.qty * config.rateUsd;

  const provider = config.provider?.name
    ? config.provider
    : { ...getDefaultProviderDetails(), ...(config.provider || {}) };
  const providerAddress =
    formatProviderAddressBlock(provider) || formatRegisteredAddress();

  const monthYear = new Date(overrides?.invoiceDate ?? new Date().toISOString().split('T')[0])
    .toLocaleString('default', { month: 'long', year: 'numeric' });

  const serviceLine = config.serviceDescription.includes(monthYear)
    ? config.serviceDescription
    : `${config.serviceDescription} for the month of ${monthYear}.`;

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
    .entity-block { margin: 16px 0; }
    .entity-block h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin: 0 0 6px; }
    .entity-block p { margin: 2px 0; }
    .services th { background: #1e3a5f; color: #fff; }
    .total-row { font-weight: 700; font-size: 14px; }
    .amount-words { font-style: italic; color: #475569; margin-top: 4px; }
    .wire-section h3 { font-size: 13px; margin-bottom: 8px; }
    .signatory { margin-top: 40px; }
    .signatory .line { border-top: 1px solid #334155; width: 240px; margin-top: 48px; padding-top: 6px; }
    .footer-note { margin-top: 32px; font-size: 10px; color: #94a3b8; text-align: center; }
    @media print { body { margin: 0; padding: 16px; } }
  </style>
</head>
<body>
  <div class="lut-banner">${LUT_DECLARATION}</div>
  <h1>COMMERCIAL INVOICE</h1>

  <table class="meta-table">
    <tr><td>Invoice Number</td><td>${esc(data.invoiceNumber)}</td></tr>
    <tr><td>Invoice Date</td><td>${esc(formatInvoiceDate(data.invoiceDate))}</td></tr>
    <tr><td>Payment Terms</td><td>${esc(config.paymentTerms)}</td></tr>
    <tr><td>Place of Supply</td><td>${esc(config.placeOfSupply)}</td></tr>
    <tr><td>LUT Number</td><td>${esc(config.lutNumber || '[Insert Your 2026-2027 ARN Number]')}</td></tr>
  </table>

  <div class="entity-block">
    <h3>From (Service Provider)</h3>
    <p><strong>${esc(data.providerName)}</strong></p>
    <p>${esc(data.providerAddress).replace(/\n/g, '<br>')}</p>
    <p><strong>GSTIN:</strong> ${esc(data.providerGstin || '[Your 15-digit GST Number]')}</p>
    <p><strong>PAN:</strong> ${esc(data.providerPan || '[LLP PAN Number]')}</p>
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
