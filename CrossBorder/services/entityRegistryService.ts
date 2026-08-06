/**
 * Canonical legal entity data for SYSTEMDR LLP — sourced from MCA FiLLiP, PAN, and GST LUT certificates.
 */

import entityData from '../data/systemdr-entity.json';

export type RegisteredAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pin: string;
  country?: string;
};

export type LutCertificate = {
  financialYear: string;
  form: string;
  title: string;
  orderNumber: string;
  applicationArn: string;
  applicationDate: string;
  deemedApprovalDate: string;
  validity: string;
  sourceFile: string;
};

export type UsPerson = {
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export type UsSubsidiary = {
  legalName: string;
  delawareFilingName?: string;
  displayName: string;
  entityType: string;
  stateOfIncorporation: string;
  country: string;
  ein: string;
  incorporationDate: string;
  executedDate?: string;
  incorporationTime?: string;
  certificateDate?: string;
  delawareFileNumber?: string;
  stateRecordNumber?: string;
  authenticationNumber?: string;
  verificationUrl?: string;
  registeredAgent?: string;
  registeredAddress?: {
    line1?: string;
    city?: string;
    county?: string;
    state: string;
    zip?: string;
    country: string;
  };
  operatingAddress?: { city: string; state: string; country: string; zip?: string };
  authorizedShares?: number;
  commonStockDesignation?: string;
  commonStockParValue?: number;
  management?: string;
  exclusiveForum?: string;
  corporatePurpose?: string;
  initialDirector?: UsPerson;
  incorporator?: UsPerson;
  ss4?: {
    form: string;
    letterType: string;
    ein: string;
    responsibleParty: string;
    responsiblePartyClassification: string;
    businessStartDate: string;
    accountingYearEnd: string;
    businessActivity: string;
    county?: string;
    irsMailingAddress?: UsPerson;
    thirdPartyDesignee?: UsPerson & { phone?: string; fax?: string; phoneAlt?: string };
    signedBy?: string;
    signedDate?: string;
  };
};

export type EntityRegistry = {
  legalName: string;
  displayName: string;
  entityType: string;
  gstin: string;
  pan: string;
  panIssueDate: string;
  tan: string;
  llpin: string;
  /** DGFT Import Export Code when registered */
  iec?: string;
  fillipReference: string;
  incorporationDate: string;
  incorporationPlace: string;
  incorporationForm: string;
  state: string;
  stateCode: string;
  registeredAddress: RegisteredAddress;
  gstRegisteredAddress: RegisteredAddress & { line2?: string };
  subsidiary: UsSubsidiary;
  lutCertificates: LutCertificate[];
  sourceDocuments: Array<{
    id: string;
    title: string;
    type: string;
    sourceFile: string;
    date: string;
    extractedFields: Record<string, string>;
  }>;
  invoiceDeclaration: string;
  lutConditions: string[];
};

const registry = entityData as EntityRegistry;

export function getEntityRegistry(): EntityRegistry {
  return registry;
}

export function formatRegisteredAddress(addr: RegisteredAddress = registry.registeredAddress): string {
  const lines = [addr.line1, addr.line2, `${addr.city}, ${addr.state} ${addr.pin}`].filter(Boolean);
  return lines.join('\n');
}

export function formatRegisteredAddressSingleLine(): string {
  const a = registry.registeredAddress;
  return [a.line1, a.line2, a.city, a.state, a.pin].filter(Boolean).join(', ');
}

/** US subsidiary (C-Corp) profile for CompanyProfile.subsidiary */
export function getSubsidiaryEntityProfile() {
  const s = registry.subsidiary;
  const reg = s.registeredAddress;
  return {
    name: s.legalName,
    type: s.entityType,
    taxId: s.ein,
    state: s.stateOfIncorporation,
    country: 'US' as const,
    incorporationDate: s.incorporationDate,
    address: reg?.line1,
    city: reg?.city,
    pin: reg?.zip,
  };
}

export function formatSubsidiaryRegisteredAddress(): string {
  const s = registry.subsidiary;
  const r = s.registeredAddress;
  if (!r?.line1) return `${s.legalName}\n${s.stateOfIncorporation}, USA`;
  const agent = s.registeredAgent ? `\nRegistered Agent: ${s.registeredAgent}` : '';
  return `${s.legalName}\n${r.line1}\n${r.city}, ${r.state} ${r.zip ?? ''}${agent}`.trim();
}

export function formatSubsidiaryAddress(): string {
  const s = registry.subsidiary;
  const op = s.operatingAddress;
  if (op?.city) {
    return `${s.legalName}\n${op.city}, ${op.state}, USA`;
  }
  return formatSubsidiaryRegisteredAddress();
}

export function getSubsidiaryPlaceOfSupply(): string {
  const op = registry.subsidiary.operatingAddress;
  if (op?.city) {
    return `${op.city}, ${op.state}, USA`;
  }
  return `${registry.subsidiary.stateOfIncorporation}, USA`;
}

/** Invoice editor client profile — US service recipient from EXP-2026-001 */
export function getInvoiceClientProfile() {
  const s = registry.subsidiary;
  const reg = s.registeredAddress;
  return {
    id: 'systemdr-inc-default',
    label: `${s.legalName} (Default — EXP-2026-001)`,
    name: s.legalName,
    gstin: '',
    pan: s.ein || '',
    addr: reg?.line1 || '131 Continental Dr, Suite 305',
    city: reg?.city || 'Newark',
    state: reg?.state || s.stateOfIncorporation || 'Delaware',
    pin: reg?.zip || '19713',
    stateCode: '',
    contact: 'Sumedh Shende',
    email: 'corp@systemdrd.com',
  };
}

/** Parent entity profile fields for CompanyProfile.parent */
export function getParentEntityProfile() {
  const r = registry;
  const a = r.registeredAddress;
  return {
    name: r.legalName,
    type: r.entityType,
    taxId: r.gstin,
    pan: r.pan,
    tan: r.tan,
    llpin: r.llpin,
    incorporationDate: r.incorporationDate,
    address: [a.line1, a.line2].filter(Boolean).join(', '),
    city: a.city,
    pin: a.pin,
    state: r.state,
    stateCode: r.stateCode,
    country: 'IN' as const,
  };
}

/** Invoice editor company profile snapshot — from EXP-2026-001 */
export function getInvoiceCompanyProfile() {
  const r = registry;
  const a = r.registeredAddress;
  return {
    id: 'systemdr-llp-default',
    label: 'SYSTEMDR LLP (Default — EXP-2026-001)',
    name: r.legalName,
    tagline: 'Information Technology & Software Services',
    gstin: r.gstin,
    pan: r.pan,
    cin: r.llpin,
    llpin: r.llpin,
    iec: r.iec || '',
    addr1: [a.line1, a.line2].filter(Boolean).join(', '),
    city: a.city,
    state: a.state,
    pin: a.pin,
    stateCode: r.stateCode,
    phone: '',
    email: '',
    website: '',
    signatoryName: 'Sumedh Shende',
    signatoryDesignation: 'Designated Partner',
    bankName: 'ICICI Bank',
    bankAccName: r.legalName,
    bankAccNum: '575705000010',
    bankAccType: 'Current',
    bankIFSC: '',
    bankBranch: 'Ajani, Wardha Road, Nagpur, Maharashtra, 440015',
    bankUPI: '',
    bankSWIFT: 'ICICINBBCTS',
  };
}

/** Vault document entries (text summaries for compliance vault) */
export function getVaultDocumentEntries() {
  return registry.sourceDocuments.map((doc) => ({
    id: doc.id,
    date: doc.date,
    title: doc.title,
    type: doc.type,
    content: Object.entries(doc.extractedFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') + `\nSource: ${doc.sourceFile}`,
  }));
}

export function currentIndianFinancialYear(date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = m >= 3 ? y : y - 1;
  const endShort = String((start + 1) % 100).padStart(2, '0');
  return `${start}-${endShort}`;
}

export function getLutForFinancialYear(fy: string): LutCertificate | undefined {
  return registry.lutCertificates.find((c) => c.financialYear === fy);
}

export function getCurrentLutArn(date = new Date()): string {
  return getLutForFinancialYear(currentIndianFinancialYear(date))?.applicationArn ?? '';
}

export const LUT_DECLARATION = registry.invoiceDeclaration;
