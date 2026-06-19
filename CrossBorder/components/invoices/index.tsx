import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { storage, StorageKeys, getActiveOrgId } from '../../services/storageService';
import { useUpsertInvoice, useDeleteInvoice } from '../../hooks/useInvoices';
import type { Invoice, InvoiceLine, InvoiceStatus } from '../../types';
import CompanyTab from './CompanyTab';
import InvoiceTab from './InvoiceTab';
import ClientTab from './ClientTab';
import LineItemsTab, { type ServiceLibraryItem } from './LineItemsTab';
import TaxTab from './TaxTab';
import NotesTab from './NotesTab';
import DesignTab, { FONT_STACKS } from './DesignTab';
import InvoiceList from './InvoiceList';

type Item = { desc: string; hsn: string; rate: number; qty: number; unit: string; gst: number; disc: number };
type CompanyProfile = {
  id: string; label: string;
  name: string; tagline: string; gstin: string; pan: string; cin: string;
  addr1: string; city: string; state: string; pin: string; stateCode: string;
  phone: string; email: string; website: string;
  signatoryName: string; signatoryDesignation: string;
  bankName: string; bankAccName: string; bankAccNum: string; bankAccType: string;
  bankIFSC: string; bankBranch: string; bankUPI: string; bankSWIFT: string;
};
const COMPANY_KEY = 'invoice_company_profiles';
type ClientProfile = {
  id: string; label: string;
  name: string; gstin: string; pan: string;
  addr: string; city: string; state: string; pin: string; stateCode: string;
  contact: string; email: string;
};
const CLIENT_KEY = 'invoice_client_profiles';
const ACTIVE_COMPANY_KEY = 'invoice_active_company';
const ACTIVE_LOGO_KEY = 'invoice_active_logo';
type Features = {
  showTaxTable: boolean;
  showAmountWords: boolean;
  showRoundOff: boolean;
  showTDS: boolean;
  showEInvoice: boolean;
  showSignature: boolean;
  showBankDetails: boolean;
  showWatermark: boolean;
};

// ─── Invoice default settings ─────────────────────────────────────────────────

const INVOICE_DEFAULTS_KEY = 'invoice_default_settings';

type InvoiceDefaults = {
  // Design
  template: 'zoho' | 'tally' | 'modern';
  headerColor: string;
  bgStyle: 'clean' | 'cream' | 'ruled';
  fontFamily: 'system' | 'sans' | 'serif' | 'mono';
  logoSize: 'small' | 'medium' | 'large';
  paperSize: 'a4' | 'letter' | 'a5';
  tableStyle: 'clean' | 'striped' | 'bordered';
  accentColor: string;
  watermarkText: string;
  zoom: number;
  // Invoice settings
  invoiceType: string;
  placeOfSupply: string;
  supplyType: 'intra' | 'inter';
  reverseCharge: 'N' | 'Y';
  currency: string;
  // Tax settings
  defaultGST: number;
  defaultSAC: string;
  tdsSection: string;
  features: Features;
  // Notes
  footerNote: string;
  terms: string[];
  commissionLabel: string;
  otherChargesLabel: string;
};

const HARDCODED_DEFAULTS: InvoiceDefaults = {
  template: 'zoho',
  headerColor: '#1a3a5c',
  bgStyle: 'clean',
  fontFamily: 'system',
  logoSize: 'medium',
  paperSize: 'a4',
  tableStyle: 'clean',
  accentColor: '#f5a623',
  watermarkText: 'DRAFT',
  zoom: 1,
  invoiceType: 'Tax Invoice',
  placeOfSupply: '',
  supplyType: 'intra',
  reverseCharge: 'N',
  currency: 'INR',
  defaultGST: 18,
  defaultSAC: '998313',
  tdsSection: '2% u/s 194J',
  features: {
    showTaxTable: true, showAmountWords: true, showRoundOff: true, showTDS: false,
    showEInvoice: false, showSignature: true, showBankDetails: true, showWatermark: false,
  },
  footerNote: 'This is a computer-generated invoice. No signature is required.',
  terms: [
    'Payment due within 30 days of invoice date.',
    'Late payment attracts 2% interest per month after due date.',
    'Subject to jurisdiction of the courts at the place of business.',
  ],
  commissionLabel: 'Commission',
  otherChargesLabel: 'Handling Charges',
};

function loadInvoiceDefaults(): InvoiceDefaults {
  try {
    const stored = localStorage.getItem(INVOICE_DEFAULTS_KEY);
    if (!stored) return HARDCODED_DEFAULTS;
    return { ...HARDCODED_DEFAULTS, ...JSON.parse(stored) };
  } catch { return HARDCODED_DEFAULTS; }
}

// ─── Component ────────────────────────────────────────────────────────────────

const Invoices: React.FC = () => {
  const invoiceRef = useRef<HTMLDivElement | null>(null);
  // Load saved defaults once on mount
  const _defaults = useMemo(() => loadInvoiceDefaults(), []);
  const _initCo = useMemo((): Partial<CompanyProfile> => {
    try {
      const active: Partial<CompanyProfile> = JSON.parse(localStorage.getItem(ACTIVE_COMPANY_KEY) || '{}');
      if (active?.name) return active;
      const activeFromDb = storage.get<Partial<CompanyProfile>>(StorageKeys.INVOICE_ACTIVE_COMPANY);
      if (activeFromDb?.name) return activeFromDb;
      const profiles: CompanyProfile[] = storage.get<CompanyProfile[]>(StorageKeys.INVOICE_COMPANY_PROFILES)
        ?? JSON.parse(localStorage.getItem(COMPANY_KEY) || '[]');
      if (profiles.length > 0) return profiles[profiles.length - 1];
      return active;
    } catch { return {}; }
  }, []);

  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [activeTab, setActiveTab] = useState('company');
  const [template, setTemplate] = useState<'zoho' | 'tally' | 'modern'>(_defaults.template);
  const [status, setStatus] = useState<'draft' | 'pending' | 'paid' | 'overdue'>('draft');
  const [zoom, setZoom] = useState(_defaults.zoom);
  const [companyName, setCompanyName] = useState(_initCo.name ?? '');
  const [companyGSTIN, setCompanyGSTIN] = useState(_initCo.gstin ?? '');
  const [companyPAN, setCompanyPAN] = useState(_initCo.pan ?? '');
  const [companyCIN, setCompanyCIN] = useState(_initCo.cin ?? '');
  const [companyTagline, setCompanyTagline] = useState(_initCo.tagline ?? '');
  const [companyAddr1, setCompanyAddr1] = useState(_initCo.addr1 ?? '');
  const [companyCity, setCompanyCity] = useState(_initCo.city ?? '');
  const [companyState, setCompanyState] = useState(_initCo.state ?? '');
  const [companyPIN, setCompanyPIN] = useState(_initCo.pin ?? '');
  const [companyPhone, setCompanyPhone] = useState(_initCo.phone ?? '');
  const [companyEmail, setCompanyEmail] = useState(_initCo.email ?? '');
  const [companyWebsite, setCompanyWebsite] = useState(_initCo.website ?? '');
  const [signatoryName, setSignatoryName] = useState(_initCo.signatoryName ?? '');
  const [signatoryDesignation, setSignatoryDesignation] = useState(_initCo.signatoryDesignation ?? '');
  const [companyStateCode, setCompanyStateCode] = useState(_initCo.stateCode ?? '');
  const [invoiceType, setInvoiceType] = useState(_defaults.invoiceType);
  const [invoiceNumber, setInvoiceNumber] = useState('INV/2025-26/0847');
  const [invoiceDate, setInvoiceDate] = useState('2025-03-15');
  const [dueDate, setDueDate] = useState('2025-04-14');
  const [poNumber, setPoNumber] = useState('PO/2025/3421');
  const [poDate, setPoDate] = useState('2025-03-01');
  const [placeOfSupply, setPlaceOfSupply] = useState(_defaults.placeOfSupply || 'Maharashtra (27)');
  const [supplyType, setSupplyType] = useState<'intra' | 'inter'>(_defaults.supplyType);
  const [reverseCharge, setReverseCharge] = useState<'N' | 'Y'>(_defaults.reverseCharge);
  const [currency, setCurrency] = useState(_defaults.currency);
  const [irnNumber, setIrnNumber] = useState('');
  const [clientName, setClientName] = useState('Nexus Digital Commerce Pvt. Ltd.');
  const [clientGSTIN, setClientGSTIN] = useState('29AAHCN5132L1ZT');
  const [clientPAN, setClientPAN] = useState('AAHCN5132L');
  const [clientAddr, setClientAddr] = useState('12th Floor, Brigade Gateway\nDr. Rajkumar Road, Malleswaram');
  const [clientCity, setClientCity] = useState('Bengaluru');
  const [clientState, setClientState] = useState('Karnataka');
  const [clientPIN, setClientPIN] = useState('560055');
  const [clientContact, setClientContact] = useState('Priya Venkatesh');
  const [clientEmail, setClientEmail] = useState('accounts@nexusdc.com');
  const [clientStateCode, setClientStateCode] = useState('29');
  const [shipSame, setShipSame] = useState(true);
  const [shipName, setShipName] = useState('');
  const [shipAddr, setShipAddr] = useState('');
  const [shipCity, setShipCity] = useState('');
  const [shipState, setShipState] = useState('');
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [commission, setCommission] = useState(0);
  const [commissionLabel, setCommissionLabel] = useState(_defaults.commissionLabel);
  const [shippingCharge, setShippingCharge] = useState(0);
  const [otherCharges, setOtherCharges] = useState(0);
  const [otherChargesLabel, setOtherChargesLabel] = useState(_defaults.otherChargesLabel);
  const [defaultGST, setDefaultGST] = useState(_defaults.defaultGST);
  const [defaultSAC, setDefaultSAC] = useState(_defaults.defaultSAC);
  const [bankName, setBankName] = useState(_initCo.bankName ?? '');
  const [bankAccName, setBankAccName] = useState(_initCo.bankAccName ?? '');
  const [bankAccNum, setBankAccNum] = useState(_initCo.bankAccNum ?? '');
  const [bankAccType, setBankAccType] = useState(_initCo.bankAccType ?? 'Current');
  const [bankIFSC, setBankIFSC] = useState(_initCo.bankIFSC ?? '');
  const [bankBranch, setBankBranch] = useState(_initCo.bankBranch ?? '');
  const [bankUPI, setBankUPI] = useState(_initCo.bankUPI ?? '');
  const [bankSWIFT, setBankSWIFT] = useState(_initCo.bankSWIFT ?? '');
  const [watermarkText, setWatermarkText] = useState(_defaults.watermarkText);
  const [headerColor, setHeaderColor] = useState(_defaults.headerColor);
  const [bgStyle, setBgStyle] = useState<'clean' | 'cream' | 'ruled'>(_defaults.bgStyle);
  const [fontFamily, setFontFamily] = useState<'system' | 'sans' | 'serif' | 'mono'>(_defaults.fontFamily);
  const [logoSize, setLogoSize] = useState<'small' | 'medium' | 'large'>(_defaults.logoSize);
  const [paperSize, setPaperSize] = useState<'a4' | 'letter' | 'a5'>(_defaults.paperSize);
  const [tableStyle, setTableStyle] = useState<'clean' | 'striped' | 'bordered'>(_defaults.tableStyle);
  const [accentColor, setAccentColor] = useState(_defaults.accentColor);
  const [footerNote, setFooterNote] = useState(_defaults.footerNote);
  const [invoiceSubject, setInvoiceSubject] = useState('Software Development Services — Q4 FY 2025-26');
  const [projectRef, setProjectRef] = useState('PROJ-SYT-2025-09');
  const [terms, setTerms] = useState<string[]>(_defaults.terms);
  const [items, setItems] = useState<Item[]>([
    { desc: 'Custom Web Application Development', hsn: '998314', rate: 120000, qty: 1, unit: 'Nos', gst: 18, disc: 0 },
    { desc: 'UI/UX Design Services', hsn: '998313', rate: 45000, qty: 1, unit: 'Nos', gst: 18, disc: 5 },
  ]);
  const [features, setFeatures] = useState<Features>(_defaults.features);
  const [tdsSection, setTdsSection] = useState(_defaults.tdsSection);
  const [tdsAmount, setTdsAmount] = useState(0);
  const [savedCompanies, setSavedCompanies] = useState<CompanyProfile[]>(() => {
    try {
      return storage.get<CompanyProfile[]>(StorageKeys.INVOICE_COMPANY_PROFILES)
        ?? JSON.parse(localStorage.getItem(COMPANY_KEY) || '[]');
    } catch { return []; }
  });
  const [profileLabel, setProfileLabel] = useState('');
  const [companyLogo, setCompanyLogo] = useState<string>(() => {
    try { return localStorage.getItem(ACTIVE_LOGO_KEY) || ''; } catch { return ''; }
  });
  const [savedClients, setSavedClients] = useState<ClientProfile[]>(() => {
    try {
      return storage.get<ClientProfile[]>(StorageKeys.INVOICE_CLIENT_PROFILES)
        ?? JSON.parse(localStorage.getItem(CLIENT_KEY) || '[]');
    } catch { return []; }
  });
  const [clientLabel, setClientLabel] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [originalInvNum, setOriginalInvNum] = useState('');
  const [originalInvDate, setOriginalInvDate] = useState('');

  // ── Service item library (library state is managed inside LineItemsTab) ──────
  const handleAddFromLibrary = (svc: ServiceLibraryItem) => {
    setItems(prev => [...prev, { desc: svc.desc, hsn: svc.hsn, rate: svc.rate, qty: 1, unit: svc.unit, gst: svc.gst, disc: 0 }]);
  };

  // ── Defaults popover state ──────────────────────────────────────────────
  const [defaultsPopoverOpen, setDefaultsPopoverOpen] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const defaultsPopoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!defaultsPopoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (defaultsPopoverRef.current && !defaultsPopoverRef.current.contains(e.target as Node)) {
        setDefaultsPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [defaultsPopoverOpen]);

  const saveAsDefault = useCallback(() => {
    const d: InvoiceDefaults = {
      template, headerColor, bgStyle, fontFamily, logoSize, paperSize, tableStyle,
      accentColor, watermarkText, zoom,
      invoiceType, placeOfSupply, supplyType, reverseCharge, currency,
      defaultGST, defaultSAC, tdsSection,
      features,
      footerNote, terms, commissionLabel, otherChargesLabel,
    };
    localStorage.setItem(INVOICE_DEFAULTS_KEY, JSON.stringify(d));
    setDefaultsSaved(true);
    setTimeout(() => setDefaultsSaved(false), 2000);
    setDefaultsPopoverOpen(false);
  }, [template, headerColor, bgStyle, fontFamily, logoSize, paperSize, tableStyle,
      accentColor, watermarkText, zoom, invoiceType, placeOfSupply, supplyType,
      reverseCharge, currency, defaultGST, defaultSAC, tdsSection, features,
      footerNote, terms, commissionLabel, otherChargesLabel]);

  const applyDefaults = useCallback((d: InvoiceDefaults) => {
    setTemplate(d.template);
    setHeaderColor(d.headerColor);
    setBgStyle(d.bgStyle);
    setFontFamily(d.fontFamily);
    setLogoSize(d.logoSize);
    setPaperSize(d.paperSize);
    setTableStyle(d.tableStyle);
    setAccentColor(d.accentColor);
    setWatermarkText(d.watermarkText);
    setZoom(d.zoom);
    setInvoiceType(d.invoiceType);
    setPlaceOfSupply(d.placeOfSupply);
    setSupplyType(d.supplyType);
    setReverseCharge(d.reverseCharge);
    setCurrency(d.currency);
    setDefaultGST(d.defaultGST);
    setDefaultSAC(d.defaultSAC);
    setTdsSection(d.tdsSection);
    setFeatures(d.features);
    setFooterNote(d.footerNote);
    setTerms(d.terms);
    setCommissionLabel(d.commissionLabel);
    setOtherChargesLabel(d.otherChargesLabel);
  }, []);

  // ── Persistence state ──────────────────────────────────────────────────────
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const upsertInvoice = useUpsertInvoice();
  const deleteInvoice = useDeleteInvoice();

  const statusMeta = {
    draft: { label: 'Draft', bg: 'var(--n-100)', color: 'var(--n-500)' },
    pending: { label: 'Pending', bg: 'var(--warning-bg)', color: 'var(--warning-text)' },
    paid: { label: 'Paid', bg: 'var(--success-bg)', color: 'var(--success-text)' },
    overdue: { label: 'Overdue', bg: 'var(--danger-bg)', color: 'var(--danger-text)' },
  } as const;

  const curSymbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : '€';

  const totals = useMemo(() => {
    const subTotal = items.reduce((a, i) => a + (i.rate * i.qty * (1 - i.disc / 100)), 0);
    const taxableBeforeTax = subTotal * (1 - globalDiscount / 100) + shippingCharge + otherCharges;
    const rows = new Map<string, { hsn: string; gst: number; taxable: number; tax: number }>();
    let taxTotal = 0;
    items.forEach((i) => {
      const taxable = i.rate * i.qty * (1 - i.disc / 100) * (1 - globalDiscount / 100);
      const tax = taxable * i.gst / 100;
      taxTotal += tax;
      const key = `${i.hsn}-${i.gst}`;
      const row = rows.get(key) || { hsn: i.hsn, gst: i.gst, taxable: 0, tax: 0 };
      row.taxable += taxable;
      row.tax += tax;
      rows.set(key, row);
    });
    const invoiceGross = taxableBeforeTax + taxTotal;
    const commissionAmount = taxableBeforeTax * commission / 100;
    let netPayable = invoiceGross - commissionAmount - (features.showTDS ? tdsAmount : 0);
    let roundOff = 0;
    if (features.showRoundOff) {
      const rounded = Math.round(netPayable);
      roundOff = rounded - netPayable;
      netPayable = rounded;
    }
    return { subTotal, taxableBeforeTax, taxTotal, invoiceGross, commissionAmount, netPayable, roundOff, taxRows: Array.from(rows.values()) };
  }, [items, globalDiscount, commission, shippingCharge, otherCharges, features.showRoundOff, features.showTDS, tdsAmount]);

  const toggleFeature = (k: keyof Features) => setFeatures((p) => ({ ...p, [k]: !p[k] }));
  const isValidGSTIN = (v: string) => !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v);
  const isValidPAN = (v: string) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v);
  const invalidStyle: React.CSSProperties = { borderColor: '#ef4444', background: '#fef2f2' };
  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: string) => {
    const [y, m, dd] = d.split('-');
    const mm = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.max(0, Number(m) - 1)];
    return `${dd} ${mm} ${y}`;
  };
  const numToWords = (n: number) => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const cvt = (x: number): string => {
      if (x < 20) return ones[x];
      if (x < 100) return `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`;
      if (x < 1000) return `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${cvt(x % 100)}` : ''}`;
      if (x < 100000) return `${cvt(Math.floor(x / 1000))} Thousand${x % 1000 ? ` ${cvt(x % 1000)}` : ''}`;
      if (x < 10000000) return `${cvt(Math.floor(x / 100000))} Lakh${x % 100000 ? ` ${cvt(x % 100000)}` : ''}`;
      return `${cvt(Math.floor(x / 10000000))} Crore${x % 10000000 ? ` ${cvt(x % 10000000)}` : ''}`;
    };
    const major = Math.floor(n);
    const minor = Math.round((n - major) * 100);
    const currencyWords: Record<string, [string, string]> = {
      INR: ['Rupees', 'Paise'],
      USD: ['US Dollars', 'Cents'],
      EUR: ['Euros', 'Cents'],
    };
    const [majorWord, minorWord] = currencyWords[currency] ?? ['Rupees', 'Paise'];
    return `${cvt(major)} ${majorWord}${minor ? ` and ${cvt(minor)} ${minorWord}` : ''} Only`;
  };

  const generateInvoice = () => {
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyEndShort = String((fyStart + 1) % 100).padStart(2, '0');
    const seqKey = `invoice_seq_${companyName.replace(/\W+/g, '_')}_${fyStart}`;
    const nextSeq = parseInt(localStorage.getItem(seqKey) || '0', 10) + 1;
    localStorage.setItem(seqKey, String(nextSeq));
    const newNumber = `INV/${fyStart}-${fyEndShort}/${String(nextSeq).padStart(4, '0')}`;
    setInvoiceNumber(newNumber);
    const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setInvoiceDate(toISO(now));
    const due = new Date(now); due.setDate(due.getDate() + 30); setDueDate(toISO(due));
    if (features.showEInvoice) setIrnNumber(Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase());
    setStatus('draft');
    setActiveTab('invoice');
    // Save to backend — use a new ID if this is a fresh invoice
    const newId = activeInvoiceId ?? `inv_${Date.now()}`;
    if (!activeInvoiceId) setActiveInvoiceId(newId);
    setTimeout(() => saveInvoice(newId), 0); // defer until state updates flush
  };

  const currentCompanyData = (): Omit<CompanyProfile, 'id' | 'label'> => ({
    name: companyName, tagline: companyTagline, gstin: companyGSTIN, pan: companyPAN, cin: companyCIN,
    addr1: companyAddr1, city: companyCity, state: companyState, pin: companyPIN, stateCode: companyStateCode,
    phone: companyPhone, email: companyEmail, website: companyWebsite,
    signatoryName, signatoryDesignation,
    bankName, bankAccName, bankAccNum, bankAccType, bankIFSC, bankBranch, bankUPI, bankSWIFT,
  });

  const saveCompanyProfile = () => {
    const label = profileLabel.trim() || companyName;
    const profile: CompanyProfile = { id: Date.now().toString(), label, ...currentCompanyData() };
    const updated = [...savedCompanies.filter((c) => c.label !== label), profile];
    setSavedCompanies(updated);
    storage.set(StorageKeys.INVOICE_COMPANY_PROFILES, updated);
    setProfileLabel('');
  };

  const loadCompanyProfile = (p: CompanyProfile) => {
    setCompanyName(p.name); setCompanyTagline(p.tagline); setCompanyGSTIN(p.gstin);
    setCompanyPAN(p.pan); setCompanyCIN(p.cin); setCompanyAddr1(p.addr1);
    setCompanyCity(p.city); setCompanyState(p.state); setCompanyPIN(p.pin);
    setCompanyStateCode(p.stateCode); setCompanyPhone(p.phone); setCompanyEmail(p.email);
    setCompanyWebsite(p.website); setSignatoryName(p.signatoryName); setSignatoryDesignation(p.signatoryDesignation);
    if (p.bankName     !== undefined) setBankName(p.bankName);
    if (p.bankAccName  !== undefined) setBankAccName(p.bankAccName);
    if (p.bankAccNum   !== undefined) setBankAccNum(p.bankAccNum);
    if (p.bankAccType  !== undefined) setBankAccType(p.bankAccType);
    if (p.bankIFSC     !== undefined) setBankIFSC(p.bankIFSC);
    if (p.bankBranch   !== undefined) setBankBranch(p.bankBranch);
    if (p.bankUPI      !== undefined) setBankUPI(p.bankUPI);
    if (p.bankSWIFT    !== undefined) setBankSWIFT(p.bankSWIFT);
  };

  const deleteCompanyProfile = (id: string) => {
    const updated = savedCompanies.filter((c) => c.id !== id);
    setSavedCompanies(updated);
    storage.set(StorageKeys.INVOICE_COMPANY_PROFILES, updated);
  };

  const updateCompanyProfile = (p: CompanyProfile) => {
    const updated = savedCompanies.map((c) => c.id === p.id ? { ...p, ...currentCompanyData() } : c);
    setSavedCompanies(updated);
    storage.set(StorageKeys.INVOICE_COMPANY_PROFILES, updated);
  };

  // AUTO-PERSIST ACTIVE COMPANY FORM
  useEffect(() => {
    const snapshot = {
      name: companyName, tagline: companyTagline, gstin: companyGSTIN, pan: companyPAN, cin: companyCIN,
      addr1: companyAddr1, city: companyCity, state: companyState, pin: companyPIN, stateCode: companyStateCode,
      phone: companyPhone, email: companyEmail, website: companyWebsite,
      signatoryName, signatoryDesignation,
      bankName, bankAccName, bankAccNum, bankAccType, bankIFSC, bankBranch, bankUPI, bankSWIFT,
    };
    localStorage.setItem(ACTIVE_COMPANY_KEY, JSON.stringify(snapshot));
    storage.set(StorageKeys.INVOICE_ACTIVE_COMPANY, snapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyName, companyTagline, companyGSTIN, companyPAN, companyCIN,
      companyAddr1, companyCity, companyState, companyPIN, companyStateCode,
      companyPhone, companyEmail, companyWebsite, signatoryName, signatoryDesignation,
      bankName, bankAccName, bankAccNum, bankAccType, bankIFSC, bankBranch, bankUPI, bankSWIFT]);

  useEffect(() => {
    try {
      if (companyLogo) localStorage.setItem(ACTIVE_LOGO_KEY, companyLogo);
      else localStorage.removeItem(ACTIVE_LOGO_KEY);
    } catch { /* quota exceeded — skip silently */ }
  }, [companyLogo]);

  // CLIENT ADDRESS BOOK
  const currentClientData = (): Omit<ClientProfile, 'id' | 'label'> => ({
    name: clientName, gstin: clientGSTIN, pan: clientPAN,
    addr: clientAddr, city: clientCity, state: clientState,
    pin: clientPIN, stateCode: clientStateCode,
    contact: clientContact, email: clientEmail,
  });

  const saveClientProfile = () => {
    const label = clientLabel.trim() || clientName;
    const profile: ClientProfile = { id: Date.now().toString(), label, ...currentClientData() };
    const updated = [...savedClients.filter((c) => c.label !== label), profile];
    setSavedClients(updated);
    storage.set(StorageKeys.INVOICE_CLIENT_PROFILES, updated);
    setClientLabel('');
  };

  const loadClientProfile = (p: ClientProfile) => {
    setClientName(p.name); setClientGSTIN(p.gstin); setClientPAN(p.pan);
    setClientAddr(p.addr); setClientCity(p.city); setClientState(p.state);
    setClientPIN(p.pin); setClientStateCode(p.stateCode);
    setClientContact(p.contact); setClientEmail(p.email);
  };

  const updateClientProfile = (p: ClientProfile) => {
    const updated = savedClients.map((c) => c.id === p.id ? { ...p, ...currentClientData() } : c);
    setSavedClients(updated);
    storage.set(StorageKeys.INVOICE_CLIENT_PROFILES, updated);
  };

  const deleteClientProfile = (id: string) => {
    const updated = savedClients.filter((c) => c.id !== id);
    setSavedClients(updated);
    storage.set(StorageKeys.INVOICE_CLIENT_PROFILES, updated);
  };

  const addItem = () => setItems((p) => [...p, { desc: 'New Service Item', hsn: defaultSAC, rate: 10000, qty: 1, unit: 'Nos', gst: defaultGST, disc: 0 }]);
  const updateItem = (idx: number, key: keyof Item, val: string | number) => setItems((p) => p.map((i, x) => x === idx ? { ...i, [key]: val } : i));
  const removeItem = (idx: number) => setItems((p) => p.filter((_, i) => i !== idx));
  const addTerm = () => setTerms((p) => [...p, 'New term or condition']);

  const downloadPdf = async () => {
    if (!invoiceRef.current || isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const source = invoiceRef.current;
      const cloneHost = document.createElement('div');
      cloneHost.style.position = 'fixed';
      cloneHost.style.left = '-100000px';
      cloneHost.style.top = '0';
      cloneHost.style.background = '#ffffff';
      cloneHost.style.padding = '0';
      cloneHost.style.margin = '0';
      cloneHost.style.width = `${source.scrollWidth}px`;
      cloneHost.style.overflow = 'visible';

      const clone = source.cloneNode(true) as HTMLDivElement;
      clone.style.transform = 'none';
      clone.style.width = `${source.scrollWidth}px`;
      clone.style.maxWidth = 'none';
      cloneHost.appendChild(clone);
      document.body.appendChild(cloneHost);

      const canvas = await html2canvas(clone, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: clone.scrollWidth,
        height: clone.scrollHeight,
        windowWidth: clone.scrollWidth,
        windowHeight: clone.scrollHeight,
        scrollX: 0,
        scrollY: 0,
      });

      document.body.removeChild(cloneHost);

      const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
      doc.setProperties({
        title: invoiceNumber || 'Invoice',
        subject: invoiceType,
        author: companyName,
        creator: 'CrossBorder Financial OS',
        keywords: `GST Invoice, ${companyGSTIN}, ${invoiceNumber}`,
      });
      const pageWidth  = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin     = 14;
      const printWidth  = pageWidth  - margin * 2;
      const printHeight = pageHeight - margin * 2;

      const contentHeightPt = (canvas.height * printWidth) / canvas.width;

      if (contentHeightPt <= printHeight) {
        const imgData = canvas.toDataURL('image/jpeg', 0.93);
        doc.addImage(imgData, 'JPEG', margin, margin, printWidth, contentHeightPt);
      } else {
        const srcPageSliceHeight = (printHeight * canvas.width) / printWidth;
        let srcY = 0;
        let pageIndex = 0;

        while (srcY < canvas.height) {
          const currentSliceHeight = Math.min(srcPageSliceHeight, canvas.height - srcY);
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width  = canvas.width;
          pageCanvas.height = Math.max(1, Math.floor(currentSliceHeight));
          const pageCtx = pageCanvas.getContext('2d');
          if (!pageCtx) break;
          pageCtx.drawImage(canvas, 0, srcY, canvas.width, currentSliceHeight, 0, 0, canvas.width, currentSliceHeight);
          const imgData = pageCanvas.toDataURL('image/jpeg', 0.93);
          const renderedHeight = (currentSliceHeight * printWidth) / canvas.width;
          if (pageIndex > 0) doc.addPage();
          doc.addImage(imgData, 'JPEG', margin, margin, printWidth, renderedHeight);
          srcY       += currentSliceHeight;
          pageIndex  += 1;
        }
      }

      const safeNo = invoiceNumber.replace(/[^\w-]+/g, '_');
      doc.save(`${safeNo || 'invoice'}.pdf`);
    } catch {
      window.print();
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // ── Status mapping ──────────────────────────────────────────────────────────
  const localToInvoiceStatus = (s: typeof status): InvoiceStatus => {
    if (s === 'paid')    return 'Paid';
    if (s === 'pending') return 'Sent';
    if (s === 'overdue') return 'Overdue';
    return 'Draft';
  };
  const invoiceToLocalStatus = (s: InvoiceStatus): typeof status => {
    if (s === 'Paid' || s === 'PartiallyPaid') return 'paid';
    if (s === 'Sent' || s === 'Viewed')        return 'pending';
    if (s === 'Overdue')                        return 'overdue';
    return 'draft';
  };

  // ── Build full Invoice payload from current local state ───────────────────
  const buildInvoicePayload = useCallback((overrideId?: string): Invoice & { _editorState: string } => {
    const id = overrideId ?? activeInvoiceId ?? `inv_${Date.now()}`;
    const now = new Date().toISOString();
    const lines: InvoiceLine[] = items.map((item, i) => ({
      id:          `line_${i}`,
      description: item.desc,
      quantity:    item.qty,
      unitPrice:   item.rate,
      amount:      parseFloat((item.rate * item.qty * (1 - item.disc / 100)).toFixed(2)),
      currency:    currency as 'USD' | 'INR',
      discountPct: item.disc,
      taxRate:     item.gst,
      taxAmount:   parseFloat((item.rate * item.qty * (1 - item.disc / 100) * item.gst / 100).toFixed(2)),
      glAccountCode: item.hsn,
    }));
    return {
      id,
      number: invoiceNumber,
      date: invoiceDate,
      dueDate,
      customerName:    clientName,
      customerEmail:   clientEmail,
      customerAddress: [clientAddr, clientCity, clientState, clientPIN].filter(Boolean).join(', '),
      customerGstin:   clientGSTIN,
      shipToName:      shipSame ? '' : shipName,
      shipToAddress:   shipSame ? '' : [shipAddr, shipCity, shipState].filter(Boolean).join(', '),
      shipToGstin:     '',
      placeOfSupply,
      status:    localToInvoiceStatus(status),
      currency:  currency as 'USD' | 'INR',
      subtotal:  parseFloat(totals.subTotal.toFixed(2)),
      taxTotal:  parseFloat(totals.taxTotal.toFixed(2)),
      total:     parseFloat(totals.netPayable.toFixed(2)),
      lines,
      notes:     terms.join('\n'),
      createdAt: now,
      updatedAt: now,
      // Full editor state stored for round-trip restore
      _editorState: JSON.stringify({
        invoiceType, poNumber, poDate, supplyType, reverseCharge, irnNumber,
        originalInvNum, originalInvDate,
        clientPAN, clientAddr, clientCity, clientState, clientPIN, clientStateCode, clientContact,
        shipSame, shipName, shipAddr, shipCity, shipState,
        items, globalDiscount, commission, commissionLabel, shippingCharge, otherCharges, otherChargesLabel,
        features, tdsSection, tdsAmount, defaultGST, defaultSAC,
        footerNote, invoiceSubject, projectRef, terms,
        template, headerColor, bgStyle, watermarkText, zoom,
        accentColor, fontFamily, logoSize, paperSize, tableStyle,
      }),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInvoiceId, invoiceNumber, invoiceDate, dueDate, clientName, clientEmail, clientAddr,
      clientCity, clientState, clientPIN, clientGSTIN, shipSame, shipName, shipAddr, shipCity, shipState,
      items, globalDiscount, commission, commissionLabel, shippingCharge, otherCharges, otherChargesLabel,
      features, tdsSection, tdsAmount, terms, currency, totals, status,
      invoiceType, poNumber, poDate, supplyType, reverseCharge, placeOfSupply]);

  // ── Save current invoice to backend ──────────────────────────────────────
  const saveInvoice = useCallback(async (overrideId?: string) => {
    const payload = buildInvoicePayload(overrideId);
    if (!activeInvoiceId && !overrideId) setActiveInvoiceId(payload.id);
    setIsSaving(true);
    try {
      await upsertInvoice.mutateAsync(payload);
      setActiveInvoiceId(payload.id);
      setLastSaved(new Date());
    } finally {
      setIsSaving(false);
    }
  }, [buildInvoicePayload, activeInvoiceId, upsertInvoice]);

  // ── Load a saved invoice into the editor ──────────────────────────────────
  const loadFromInvoice = useCallback((inv: Invoice & { _editorState?: string }) => {
    setActiveInvoiceId(inv.id);
    setInvoiceNumber(inv.number);
    setInvoiceDate(inv.date);
    setDueDate(inv.dueDate);
    setClientName(inv.customerName);
    setClientEmail(inv.customerEmail ?? '');
    setClientGSTIN(inv.customerGstin ?? '');
    setClientAddr(inv.customerAddress ?? '');
    setStatus(invoiceToLocalStatus(inv.status));
    setCurrency(inv.currency);
    if (inv._editorState) {
      try {
        const s = JSON.parse(inv._editorState as string);
        if (s.invoiceType)        setInvoiceType(s.invoiceType);
        if (s.poNumber != null)   setPoNumber(s.poNumber);
        if (s.poDate != null)     setPoDate(s.poDate);
        if (s.supplyType)         setSupplyType(s.supplyType);
        if (s.reverseCharge)      setReverseCharge(s.reverseCharge);
        if (s.irnNumber != null)  setIrnNumber(s.irnNumber);
        if (s.originalInvNum)     setOriginalInvNum(s.originalInvNum);
        if (s.originalInvDate)    setOriginalInvDate(s.originalInvDate);
        if (s.clientPAN != null)  setClientPAN(s.clientPAN);
        if (s.clientCity != null) setClientCity(s.clientCity);
        if (s.clientState != null) setClientState(s.clientState);
        if (s.clientPIN != null)  setClientPIN(s.clientPIN);
        if (s.clientStateCode)    setClientStateCode(s.clientStateCode);
        if (s.clientContact)      setClientContact(s.clientContact);
        if (s.shipSame != null)   setShipSame(s.shipSame);
        if (s.shipName != null)   setShipName(s.shipName);
        if (s.shipAddr != null)   setShipAddr(s.shipAddr);
        if (s.shipCity != null)   setShipCity(s.shipCity);
        if (s.shipState != null)  setShipState(s.shipState);
        if (s.items?.length)      setItems(s.items);
        if (s.globalDiscount != null) setGlobalDiscount(s.globalDiscount);
        if (s.commission != null)  setCommission(s.commission);
        if (s.commissionLabel)     setCommissionLabel(s.commissionLabel);
        if (s.shippingCharge != null) setShippingCharge(s.shippingCharge);
        if (s.otherCharges != null)   setOtherCharges(s.otherCharges);
        if (s.otherChargesLabel)      setOtherChargesLabel(s.otherChargesLabel);
        if (s.features)        setFeatures(s.features);
        if (s.tdsSection)      setTdsSection(s.tdsSection);
        if (s.tdsAmount != null) setTdsAmount(s.tdsAmount);
        if (s.defaultGST != null) setDefaultGST(s.defaultGST);
        if (s.defaultSAC)      setDefaultSAC(s.defaultSAC);
        if (s.footerNote)      setFooterNote(s.footerNote);
        if (s.invoiceSubject)  setInvoiceSubject(s.invoiceSubject);
        if (s.projectRef)      setProjectRef(s.projectRef);
        if (s.terms?.length)   setTerms(s.terms);
        if (s.template)        setTemplate(s.template);
        if (s.headerColor)     setHeaderColor(s.headerColor);
        if (s.bgStyle)         setBgStyle(s.bgStyle);
        if (s.watermarkText)   setWatermarkText(s.watermarkText);
        if (s.zoom != null)    setZoom(s.zoom);
        if (s.accentColor)     setAccentColor(s.accentColor);
        if (s.fontFamily)      setFontFamily(s.fontFamily);
        if (s.logoSize)        setLogoSize(s.logoSize);
        if (s.paperSize)       setPaperSize(s.paperSize);
        if (s.tableStyle)      setTableStyle(s.tableStyle);
      } catch { /* corrupt state — skip */ }
    }
    setLastSaved(new Date());
  }, []);

  // ── New invoice (clear editor, re-apply saved defaults) ──────────────────
  const handleNew = useCallback(() => {
    const d = loadInvoiceDefaults();
    setActiveInvoiceId(null);
    setLastSaved(null);
    setInvoiceNumber('');
    setInvoiceDate('');
    setDueDate('');
    setClientName('');
    setClientEmail('');
    setClientGSTIN('');
    setClientPAN('');
    setClientAddr('');
    setClientCity('');
    setClientState('');
    setClientPIN('');
    setClientContact('');
    setItems([{ desc: 'New Service Item', hsn: d.defaultSAC, rate: 10000, qty: 1, unit: 'Nos', gst: d.defaultGST, disc: 0 }]);
    setStatus('draft');
    setActiveTab('invoice');
    applyDefaults(d);
  }, [applyDefaults]);

  // ── Duplicate invoice ─────────────────────────────────────────────────────
  const handleDuplicate = useCallback((inv: Invoice & { _editorState?: string }) => {
    loadFromInvoice(inv);
    const newId = `inv_${Date.now()}`;
    setActiveInvoiceId(newId);
    setInvoiceNumber(''); // Clear number — user generates a new one
    setStatus('draft');
    setLastSaved(null);
  }, [loadFromInvoice]);

  // ── Status change with persist ────────────────────────────────────────────
  const handleStatusChange = useCallback(async (newStatus: typeof status) => {
    setStatus(newStatus);
    if (activeInvoiceId) {
      const payload = buildInvoicePayload(activeInvoiceId);
      payload.status = localToInvoiceStatus(newStatus);
      setIsSaving(true);
      try {
        await upsertInvoice.mutateAsync(payload);
        setLastSaved(new Date());
      } finally {
        setIsSaving(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInvoiceId, buildInvoicePayload, upsertInvoice]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: listCollapsed ? '32px 420px 1fr' : '248px 420px 1fr', gap: 14, minHeight: 'calc(100vh - 180px)', transition: 'grid-template-columns 0.2s ease' }}>

      {/* ── Invoice List Sidebar ─────────────────────────────────────────── */}
      {listCollapsed ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--surface-base)', border: '1px solid var(--n-200)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }} onClick={() => setListCollapsed(false)}>
          <div style={{ padding: '8px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', borderBottom: '1px solid var(--n-200)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 0' }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: 'var(--n-400)', textTransform: 'uppercase', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Invoices</span>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <InvoiceList
            activeId={activeInvoiceId}
            onSelect={(inv) => loadFromInvoice(inv as Invoice & { _editorState?: string })}
            onNew={handleNew}
            onDuplicate={(inv) => handleDuplicate(inv as Invoice & { _editorState?: string })}
            onDelete={(id) => deleteInvoice.mutate(id)}
          />
          {/* Collapse button */}
          <button
            type="button"
            onClick={() => setListCollapsed(true)}
            title="Hide invoice list"
            style={{ position: 'absolute', top: 8, right: -10, width: 20, height: 20, borderRadius: '50%', background: 'var(--surface-base)', border: '1px solid var(--n-200)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--n-400)', zIndex: 5, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── Editor Panel ─────────────────────────────────────────────────── */}
      <div className="card" style={{ maxHeight: 'calc(100vh - 180px)', overflow: 'auto' }}>
        {/* Compact sticky header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface-base)', borderBottom: '1px solid var(--n-200)', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--n-600)', letterSpacing: 0.3 }}>INVOICE EDITOR</span>
          {/* Save indicator */}
          {lastSaved && !isSaving && (
            <span style={{ fontSize: 9, color: 'var(--n-400)', marginLeft: 2 }}>
              ✓ saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          {isSaving && <span style={{ fontSize: 9, color: 'var(--n-400)' }}>saving…</span>}
          <div style={{ flex: 1 }} />
          {/* Status badge — click to cycle with persistence */}
          <button
            type="button"
            onClick={() => {
              const cycle: (typeof status)[] = ['draft', 'pending', 'paid', 'overdue'];
              handleStatusChange(cycle[(cycle.indexOf(status) + 1) % cycle.length]);
            }}
            style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: 'none', cursor: 'pointer', background: statusMeta[status].bg, color: statusMeta[status].color }}
          >
            {statusMeta[status].label}
          </button>
          {/* Save manually */}
          {activeInvoiceId && (
            <button
              type="button"
              onClick={() => saveInvoice()}
              disabled={isSaving}
              style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--n-200)', background: 'var(--n-50)', color: 'var(--n-600)', cursor: 'pointer' }}
            >
              💾
            </button>
          )}
          {/* Defaults button + popover */}
          <div ref={defaultsPopoverRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setDefaultsPopoverOpen(v => !v)}
              title="Invoice defaults"
              style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--n-200)', background: defaultsSaved ? '#dcfce7' : 'var(--n-50)', color: defaultsSaved ? '#16a34a' : 'var(--n-600)', cursor: 'pointer', transition: 'background 0.3s, color 0.3s', fontWeight: 600 }}
            >
              {defaultsSaved ? '✓ Saved' : '📌 Defaults'}
            </button>
            {defaultsPopoverOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--surface-base)', border: '1px solid var(--n-200)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '10px 12px', minWidth: 220, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n-500)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Invoice Defaults</div>
                <div style={{ fontSize: 11, color: 'var(--n-500)', lineHeight: 1.4 }}>
                  Save the current design, tax, and notes settings as defaults for new invoices.
                </div>
                <button
                  type="button"
                  onClick={saveAsDefault}
                  style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
                >
                  💾 Save current as default
                </button>
                <button
                  type="button"
                  onClick={() => { applyDefaults(loadInvoiceDefaults()); setDefaultsPopoverOpen(false); }}
                  style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--n-200)', background: 'var(--n-50)', color: 'var(--n-600)', cursor: 'pointer' }}
                >
                  ↺ Reset to saved default
                </button>
                <button
                  type="button"
                  onClick={() => { localStorage.removeItem(INVOICE_DEFAULTS_KEY); applyDefaults(HARDCODED_DEFAULTS); setDefaultsPopoverOpen(false); }}
                  style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--n-150)', background: 'transparent', color: 'var(--n-400)', cursor: 'pointer' }}
                >
                  ✕ Clear saved defaults
                </button>
                <div style={{ borderTop: '1px solid var(--n-150)', paddingTop: 5, fontSize: 9, color: 'var(--n-400)', lineHeight: 1.5 }}>
                  Defaults apply to: template, colors, fonts, paper size, tax rates, terms, and features.
                </div>
              </div>
            )}
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={generateInvoice} style={{ fontSize: 11, padding: '3px 10px' }}>⚡ Generate</button>
        </div>
        {/* Tab strip */}
        <div style={{ position: 'sticky', top: 33, zIndex: 1, background: 'var(--surface-base)', borderBottom: '1px solid var(--n-200)', padding: '5px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['company', 'invoice', 'client', 'items', 'tax', 'notes', 'design'].map((t) => (
            <button key={t} type="button" onClick={() => setActiveTab(t)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: activeTab === t ? 700 : 400, background: activeTab === t ? 'var(--accent)' : 'var(--n-100)', color: activeTab === t ? '#fff' : 'var(--n-600)', transition: 'all 0.15s' }}>{t}</button>
          ))}
        </div>
        {/* Form body */}
        <style>{`.inv-panel input.form-input,.inv-panel select.form-input,.inv-panel textarea.form-input{font-size:11px;padding:4px 7px}.inv-panel .card-inset{padding:7px}.inv-panel label{font-size:11px}`}</style>
        <div className="inv-panel" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {activeTab === 'company' && (
            <CompanyTab
              companyName={companyName} setCompanyName={setCompanyName}
              companyTagline={companyTagline} setCompanyTagline={setCompanyTagline}
              companyGSTIN={companyGSTIN} setCompanyGSTIN={setCompanyGSTIN}
              companyPAN={companyPAN} setCompanyPAN={setCompanyPAN}
              companyCIN={companyCIN} setCompanyCIN={setCompanyCIN}
              companyAddr1={companyAddr1} setCompanyAddr1={setCompanyAddr1}
              companyCity={companyCity} setCompanyCity={setCompanyCity}
              companyState={companyState} setCompanyState={setCompanyState}
              companyPIN={companyPIN} setCompanyPIN={setCompanyPIN}
              companyStateCode={companyStateCode} setCompanyStateCode={setCompanyStateCode}
              companyPhone={companyPhone} setCompanyPhone={setCompanyPhone}
              companyEmail={companyEmail} setCompanyEmail={setCompanyEmail}
              companyWebsite={companyWebsite} setCompanyWebsite={setCompanyWebsite}
              signatoryName={signatoryName} setSignatoryName={setSignatoryName}
              signatoryDesignation={signatoryDesignation} setSignatoryDesignation={setSignatoryDesignation}
              companyLogo={companyLogo} setCompanyLogo={setCompanyLogo}
              bankName={bankName} setBankName={setBankName}
              bankAccName={bankAccName} setBankAccName={setBankAccName}
              bankAccNum={bankAccNum} setBankAccNum={setBankAccNum}
              bankAccType={bankAccType} setBankAccType={setBankAccType}
              bankIFSC={bankIFSC} setBankIFSC={setBankIFSC}
              bankBranch={bankBranch} setBankBranch={setBankBranch}
              bankUPI={bankUPI} setBankUPI={setBankUPI}
              bankSWIFT={bankSWIFT} setBankSWIFT={setBankSWIFT}
              profileLabel={profileLabel} setProfileLabel={setProfileLabel}
              savedCompanies={savedCompanies}
              onSaveProfile={saveCompanyProfile}
              onLoadProfile={loadCompanyProfile}
              onUpdateProfile={updateCompanyProfile}
              onDeleteProfile={deleteCompanyProfile}
              isValidGSTIN={isValidGSTIN}
              isValidPAN={isValidPAN}
              invalidStyle={invalidStyle}
            />
          )}
          {activeTab === 'invoice' && (
            <InvoiceTab
              invoiceType={invoiceType} setInvoiceType={setInvoiceType}
              invoiceNumber={invoiceNumber} setInvoiceNumber={setInvoiceNumber}
              invoiceDate={invoiceDate} setInvoiceDate={setInvoiceDate}
              dueDate={dueDate} setDueDate={setDueDate}
              poNumber={poNumber} setPoNumber={setPoNumber}
              poDate={poDate} setPoDate={setPoDate}
              placeOfSupply={placeOfSupply} setPlaceOfSupply={setPlaceOfSupply}
              supplyType={supplyType} setSupplyType={setSupplyType}
              reverseCharge={reverseCharge} setReverseCharge={setReverseCharge}
              currency={currency} setCurrency={setCurrency}
              irnNumber={irnNumber} setIrnNumber={setIrnNumber}
              originalInvNum={originalInvNum} setOriginalInvNum={setOriginalInvNum}
              originalInvDate={originalInvDate} setOriginalInvDate={setOriginalInvDate}
              showEInvoice={features.showEInvoice}
              invoiceSubject={invoiceSubject} setInvoiceSubject={setInvoiceSubject}
            />
          )}
          {activeTab === 'client' && (
            <ClientTab
              clientName={clientName} setClientName={setClientName}
              clientGSTIN={clientGSTIN} setClientGSTIN={setClientGSTIN}
              clientPAN={clientPAN} setClientPAN={setClientPAN}
              clientAddr={clientAddr} setClientAddr={setClientAddr}
              clientCity={clientCity} setClientCity={setClientCity}
              clientState={clientState} setClientState={setClientState}
              clientPIN={clientPIN} setClientPIN={setClientPIN}
              clientStateCode={clientStateCode} setClientStateCode={setClientStateCode}
              clientContact={clientContact} setClientContact={setClientContact}
              clientEmail={clientEmail} setClientEmail={setClientEmail}
              shipSame={shipSame} setShipSame={setShipSame}
              shipName={shipName} setShipName={setShipName}
              shipAddr={shipAddr} setShipAddr={setShipAddr}
              shipCity={shipCity} setShipCity={setShipCity}
              shipState={shipState} setShipState={setShipState}
              clientLabel={clientLabel} setClientLabel={setClientLabel}
              clientSearch={clientSearch} setClientSearch={setClientSearch}
              savedClients={savedClients}
              onSaveClient={saveClientProfile}
              onLoadClient={loadClientProfile}
              onUpdateClient={updateClientProfile}
              onDeleteClient={deleteClientProfile}
              isValidGSTIN={isValidGSTIN}
              isValidPAN={isValidPAN}
              invalidStyle={invalidStyle}
            />
          )}
          {activeTab === 'items' && (
            <LineItemsTab
              items={items}
              globalDiscount={globalDiscount} setGlobalDiscount={setGlobalDiscount}
              shippingCharge={shippingCharge} setShippingCharge={setShippingCharge}
              otherCharges={otherCharges} setOtherCharges={setOtherCharges}
              otherChargesLabel={otherChargesLabel} setOtherChargesLabel={setOtherChargesLabel}
              commission={commission} setCommission={setCommission}
              commissionLabel={commissionLabel} setCommissionLabel={setCommissionLabel}
              onAddItem={addItem}
              onUpdateItem={updateItem}
              onRemoveItem={removeItem}
              onAddFromLibrary={handleAddFromLibrary}
            />
          )}
          {activeTab === 'tax' && (
            <TaxTab
              features={features}
              tdsSection={tdsSection} setTdsSection={setTdsSection}
              tdsAmount={tdsAmount} setTdsAmount={setTdsAmount}
              defaultGST={defaultGST} setDefaultGST={setDefaultGST}
              defaultSAC={defaultSAC} setDefaultSAC={setDefaultSAC}
              onToggleFeature={toggleFeature}
            />
          )}
          {activeTab === 'notes' && (
            <NotesTab
              terms={terms}
              setTerms={setTerms}
              footerNote={footerNote} setFooterNote={setFooterNote}
              projectRef={projectRef} setProjectRef={setProjectRef}
              onAddTerm={addTerm}
            />
          )}
          {activeTab === 'design' && (
            <DesignTab
              template={template} setTemplate={setTemplate}
              headerColor={headerColor} setHeaderColor={setHeaderColor}
              bgStyle={bgStyle} setBgStyle={setBgStyle}
              watermarkText={watermarkText} setWatermarkText={setWatermarkText}
              zoom={zoom} setZoom={setZoom}
              fontFamily={fontFamily} setFontFamily={setFontFamily}
              logoSize={logoSize} setLogoSize={setLogoSize}
              paperSize={paperSize} setPaperSize={setPaperSize}
              tableStyle={tableStyle} setTableStyle={setTableStyle}
              accentColor={accentColor} setAccentColor={setAccentColor}
              showWatermark={features.showWatermark}
              onToggleWatermark={() => toggleFeature('showWatermark')}
            />
          )}
        </div>
      </div>

      <div className="card" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 180px)', background: '#2a2c35' }}>
        <div className="card-body">
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
            <div ref={invoiceRef} style={{ background: bgStyle === 'clean' ? '#fff' : bgStyle === 'cream' ? '#fefbf3' : '#fff', backgroundImage: bgStyle === 'ruled' ? 'repeating-linear-gradient(to bottom, rgba(26,58,92,0.05) 0 1px, transparent 1px 24px)' : 'none', borderRadius: 4, overflow: 'visible', position: 'relative', fontFamily: FONT_STACKS[fontFamily] }}>
              {features.showWatermark && <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 84, fontWeight: 800, color: 'rgba(26,58,92,0.05)', transform: 'rotate(-35deg)', pointerEvents: 'none' }}>{watermarkText}</div>}

              {/* ZOHO TEMPLATE HEADER */}
              {template === 'zoho' && (<>
                <div style={{ background: headerColor, color: '#fff', padding: '16px 20px', display: 'grid', gridTemplateColumns: `${companyLogo ? 'auto ' : ''}1fr auto`, gap: '0 14px', alignItems: 'flex-start' }}>
                  {companyLogo && (
                    <img src={companyLogo} alt="logo" style={{ height: logoSize === 'small' ? 28 : logoSize === 'large' ? 52 : 38, width: 'auto', maxWidth: logoSize === 'large' ? 110 : 76, borderRadius: 4, background: 'rgba(255,255,255,0.92)', padding: '2px 5px', display: 'block', flexShrink: 0, marginTop: 2 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35, wordBreak: 'break-word' }}>{companyName}</div>
                    {companyTagline && <div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>{companyTagline}</div>}
                    <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{[companyAddr1, companyCity, companyState, companyPIN].filter(Boolean).join(', ')}</div>
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>{[companyPhone, companyEmail, companyWebsite].filter(Boolean).join(' · ')}</div>
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>
                      {[companyGSTIN && `GSTIN: ${companyGSTIN}`, companyPAN && `PAN: ${companyPAN}`, companyCIN && `CIN: ${companyCIN}`].filter(Boolean).join(' · ')}
                    </div>
                    {features.showEInvoice && <div style={{ fontSize: 9, opacity: 0.85, marginTop: 2, background: 'rgba(255,255,255,0.15)', display: 'inline-block', padding: '1px 6px', borderRadius: 3 }}>e-Invoice{irnNumber ? ` · IRN: ${irnNumber.slice(0, 18)}…` : ' · IRN pending'}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, paddingTop: 2 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.28, letterSpacing: 1.5, textTransform: 'uppercase' }}>{invoiceType}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2, whiteSpace: 'nowrap' }}>{invoiceNumber}</div>
                    <div style={{ fontSize: 10, marginTop: 4, opacity: 0.85 }}>Date: {fmtDate(invoiceDate)}</div>
                    <div style={{ fontSize: 10, marginTop: 2, opacity: 0.85 }}>Due:&nbsp;&nbsp;{fmtDate(dueDate)}</div>
                  </div>
                </div>
                <div style={{ height: 3, background: `linear-gradient(90deg, ${accentColor}, ${headerColor})` }} />
              </>)}

              {/* TALLY TEMPLATE HEADER */}
              {template === 'tally' && (
                <div style={{ padding: '14px 16px', borderBottom: `2px solid ${headerColor}`, background: '#fff', display: 'grid', gridTemplateColumns: `${companyLogo ? 'auto ' : ''}1fr auto`, gap: '0 12px', alignItems: 'flex-start' }}>
                  {companyLogo && <img src={companyLogo} alt="logo" style={{ height: logoSize === 'small' ? 24 : logoSize === 'large' ? 48 : 34, display: 'block', flexShrink: 0, marginTop: 2 }} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: headerColor, letterSpacing: 0.3, wordBreak: 'break-word', lineHeight: 1.3 }}>{companyName.toUpperCase()}</div>
                    {companyTagline && <div style={{ fontSize: 9, color: '#666', marginTop: 1 }}>{companyTagline}</div>}
                    <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{[companyAddr1, companyCity, companyState, companyPIN].filter(Boolean).join(', ')}</div>
                    <div style={{ fontSize: 9, color: '#444', marginTop: 1 }}>
                      {[companyPhone && `Ph: ${companyPhone}`, companyEmail].filter(Boolean).join(' · ')}
                    </div>
                    <div style={{ fontSize: 9, color: '#333', marginTop: 1 }}>
                      {[companyGSTIN && `GSTIN: ${companyGSTIN}`, companyPAN && `PAN: ${companyPAN}`, companyCIN && `CIN: ${companyCIN}`].filter(Boolean).join(' · ')}
                      {features.showEInvoice && ` · IRN: ${irnNumber ? irnNumber.slice(0, 14) + '…' : 'Pending'}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, paddingTop: 2 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: headerColor, letterSpacing: 1.5, textTransform: 'uppercase' }}>{invoiceType}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap' }}>No: {invoiceNumber}</div>
                    <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>Date: {fmtDate(invoiceDate)}</div>
                    <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>Due:&nbsp; {fmtDate(dueDate)}</div>
                  </div>
                </div>
              )}

              {/* MODERN TEMPLATE HEADER */}
              {template === 'modern' && (
                <div style={{ padding: '16px 20px', background: '#fafafa', borderBottom: `3px solid ${headerColor}`, display: 'grid', gridTemplateColumns: `${companyLogo ? 'auto ' : ''}1fr auto`, gap: '0 16px', alignItems: 'flex-start' }}>
                  {companyLogo && (
                    <div style={{ background: headerColor, borderRadius: 6, padding: '4px 6px', display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: 2 }}>
                      <img src={companyLogo} alt="logo" style={{ height: logoSize === 'small' ? 26 : logoSize === 'large' ? 48 : 36, display: 'block' }} />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: headerColor, lineHeight: 1.35, wordBreak: 'break-word' }}>{companyName}</div>
                    {companyTagline && <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{companyTagline}</div>}
                    <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{[companyAddr1, companyCity, companyState, companyPIN].filter(Boolean).join(', ')}</div>
                    <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{[companyPhone, companyEmail].filter(Boolean).join(' · ')}</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                      {companyGSTIN && <span style={{ fontSize: 9, background: `${headerColor}15`, border: `1px solid ${headerColor}35`, borderRadius: 3, padding: '1px 5px', color: headerColor, fontWeight: 700 }}>GSTIN: {companyGSTIN}</span>}
                      {companyPAN && <span style={{ fontSize: 9, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px', color: '#374151', fontWeight: 600 }}>PAN: {companyPAN}</span>}
                      {companyCIN && <span style={{ fontSize: 9, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px', color: '#374151', fontWeight: 600 }}>CIN: {companyCIN}</span>}
                    </div>
                    {features.showEInvoice && <div style={{ fontSize: 9, color: '#b45309', marginTop: 3 }}>e-Invoice · IRN: {irnNumber ? `${irnNumber.slice(0, 18)}…` : 'Pending'}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, paddingTop: 2 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: headerColor, lineHeight: 1.2 }}>{invoiceType}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap' }}>{invoiceNumber}</div>
                    <div style={{ fontSize: 10, color: '#555', marginTop: 5 }}>Date: <strong style={{ color: '#111' }}>{fmtDate(invoiceDate)}</strong></div>
                    <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Due:&nbsp; <strong style={{ color: '#111' }}>{fmtDate(dueDate)}</strong></div>
                  </div>
                </div>
              )}

              <div style={{ padding: template === 'tally' ? '10px 14px' : '12px 18px' }}>

                {/* CN/DN Reference Banner */}
                {(invoiceType === 'Credit Note' || invoiceType === 'Debit Note') && originalInvNum && (
                  <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 5, padding: '7px 12px', marginBottom: 12, fontSize: 11 }}>
                    <strong>{invoiceType} against Tax Invoice:</strong> {originalInvNum}{originalInvDate ? ` dated ${fmtDate(originalInvDate)}` : ''}
                  </div>
                )}

                {/* Invoice Reference Details */}
                <div style={{ marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'hidden', fontSize: 9 }}>
                  {!!invoiceSubject && (
                    <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #e5e7eb' }}>
                      <div style={{ width: 3, background: headerColor, flexShrink: 0 }} />
                      <div style={{ padding: '3px 8px', flex: 1 }}>
                        <span style={{ fontSize: 7, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6 }}>Subject</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#111' }}>{invoiceSubject}</span>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.4fr 1fr 1.4fr', borderBottom: '1px solid #f3f4f6' }}>
                    {[
                      { label: 'Place of Supply', value: placeOfSupply || '—', rb: true },
                      { label: 'Supply Type', value: supplyType === 'inter' ? 'Inter-State (IGST)' : 'Intra-State (CGST+SGST)', rb: true },
                      { label: 'State Codes', value: `Seller ${companyStateCode || '—'} · Buyer ${clientStateCode || '—'}`, rb: true },
                      { label: 'Reverse Charge', value: reverseCharge === 'Y' ? '▲ Applicable' : '✓ Not Applicable', rb: false, accent: reverseCharge === 'Y' ? '#dc2626' : '#16a34a' },
                    ].map((c, i) => (
                      <div key={i} style={{ padding: '3px 6px', borderRight: c.rb ? '1px solid #f3f4f6' : undefined, background: c.accent === '#dc2626' ? '#fef2f2' : undefined }}>
                        <div style={{ color: '#9ca3af', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 1 }}>{c.label}</div>
                        <div style={{ fontWeight: 600, color: c.accent ?? '#111', fontSize: 9 }}>{c.value}</div>
                      </div>
                    ))}
                  </div>
                  {(poNumber || projectRef) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                      <div style={{ padding: '3px 6px', borderRight: '1px solid #f3f4f6' }}>
                        <div style={{ color: '#9ca3af', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 1 }}>PO Reference</div>
                        <div style={{ fontWeight: 600, color: '#111', fontSize: 9 }}>{poNumber || '—'}{poDate ? <span style={{ color: '#6b7280', fontWeight: 400 }}> · {fmtDate(poDate)}</span> : ''}</div>
                      </div>
                      <div style={{ padding: '3px 6px' }}>
                        <div style={{ color: '#9ca3af', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 1 }}>Project Reference</div>
                        <div style={{ fontWeight: 600, color: '#111', fontSize: 9 }}>{projectRef || '—'}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bill To / Ship To */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'hidden', fontSize: 10 }}>
                    <div style={{ padding: '3px 8px', fontSize: 8, fontWeight: 700, color: headerColor, textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '1px solid #e5e7eb', background: `${headerColor}12` }}>Bill To</div>
                    <div style={{ padding: '6px 8px' }}>
                      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 1 }}>{clientName}</div>
                      <div style={{ whiteSpace: 'pre-line', color: '#374151', lineHeight: 1.4 }}>{clientAddr}</div>
                      <div style={{ color: '#374151' }}>{clientCity}, {clientState} — {clientPIN}</div>
                      {(clientContact || clientEmail) && (
                        <div style={{ marginTop: 2, color: '#6b7280', fontSize: 9 }}>{clientContact}{clientContact && clientEmail ? ' · ' : ''}{clientEmail}</div>
                      )}
                      <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {clientGSTIN && <span style={{ fontSize: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px' }}>GSTIN: <strong>{clientGSTIN}</strong></span>}
                        {clientPAN && <span style={{ fontSize: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px' }}>PAN: <strong>{clientPAN}</strong></span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'hidden', fontSize: 10 }}>
                    <div style={{ padding: '3px 8px', fontSize: 8, fontWeight: 700, color: headerColor, textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '1px solid #e5e7eb', background: `${headerColor}12` }}>{shipSame ? 'Seller / Supplier Details' : 'Ship To'}</div>
                    <div style={{ padding: '6px 8px' }}>
                      {shipSame ? (
                        <>
                          <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 1 }}>{companyName}</div>
                          {companyAddr1 && <div style={{ color: '#374151', lineHeight: 1.4 }}>{companyAddr1}</div>}
                          <div style={{ color: '#374151' }}>{companyCity}, {companyState} — {companyPIN}</div>
                          <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {companyPAN && <span style={{ fontSize: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px' }}>PAN: <strong>{companyPAN}</strong></span>}
                            {companyCIN && <span style={{ fontSize: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px' }}>CIN: <strong>{companyCIN}</strong></span>}
                            {companyStateCode && <span style={{ fontSize: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px' }}>State: <strong>{companyStateCode}</strong></span>}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 1 }}>{shipName || clientName}</div>
                          <div style={{ whiteSpace: 'pre-line', color: '#374151', lineHeight: 1.4 }}>{shipAddr || clientAddr}</div>
                          <div style={{ color: '#374151' }}>{shipCity || clientCity}, {shipState || clientState}</div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Line Items Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: template === 'tally' ? 11 : 12 }}>
                  <thead>
                    <tr style={{ background: template === 'tally' ? '#f3f4f6' : headerColor, color: template === 'tally' ? '#111' : '#fff' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: 28, borderBottom: template === 'tally' ? `2px solid ${headerColor}` : 'none' }}>#</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: template === 'tally' ? `2px solid ${headerColor}` : 'none' }}>Description</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: template === 'tally' ? `2px solid ${headerColor}` : 'none' }}>Qty</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: template === 'tally' ? `2px solid ${headerColor}` : 'none' }}>Rate</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: template === 'tally' ? `2px solid ${headerColor}` : 'none' }}>Disc%</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: template === 'tally' ? `2px solid ${headerColor}` : 'none' }}>GST%</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: template === 'tally' ? `2px solid ${headerColor}` : 'none' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i, idx) => {
                      const amt = i.rate * i.qty * (1 - i.disc / 100);
                      return (
                        <tr key={`${i.desc}-${idx}`} style={{ borderBottom: '1px solid #e5e7eb', background: tableStyle === 'striped' && idx % 2 === 0 ? (bgStyle === 'cream' ? 'rgba(0,0,0,0.02)' : '#f8fafc') : tableStyle === 'striped' ? 'transparent' : idx % 2 === 1 ? '#fafafa' : '#fff' }}>
                          <td style={{ padding: '6px 8px', color: '#9ca3af', verticalAlign: 'top', border: tableStyle === 'bordered' ? '1px solid #e2e8f0' : 'none' }}>{idx + 1}</td>
                          <td style={{ padding: '6px 8px', verticalAlign: 'top', border: tableStyle === 'bordered' ? '1px solid #e2e8f0' : 'none' }}>
                            <div style={{ fontWeight: 600 }}>{i.desc}</div>
                            <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>HSN/SAC: {i.hsn} &nbsp;·&nbsp; {i.unit}</div>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', verticalAlign: 'top', border: tableStyle === 'bordered' ? '1px solid #e2e8f0' : 'none' }}>{i.qty}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', verticalAlign: 'top', border: tableStyle === 'bordered' ? '1px solid #e2e8f0' : 'none' }}>{curSymbol}{fmt(i.rate)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', verticalAlign: 'top', color: i.disc > 0 ? '#dc2626' : '#9ca3af', border: tableStyle === 'bordered' ? '1px solid #e2e8f0' : 'none' }}>{i.disc > 0 ? `${i.disc}%` : '—'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', verticalAlign: 'top', color: '#6b7280', border: tableStyle === 'bordered' ? '1px solid #e2e8f0' : 'none' }}>{i.gst}%</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, verticalAlign: 'top', border: tableStyle === 'bordered' ? '1px solid #e2e8f0' : 'none' }}>{curSymbol}{fmt(amt)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: '#f8fafc', borderTop: '2px solid #e5e7eb' }}>
                      <td colSpan={6} style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#6b7280', fontSize: 10 }}>Sub Total (before discount)</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, fontSize: 11 }}>{curSymbol}{fmt(totals.subTotal)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* GST Summary + Amount Summary */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 10, marginTop: 8 }}>
                  <div>
                    {features.showTaxTable && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: '#f3f4f6' }}>
                            <th style={{ border: '1px solid #e5e7eb', padding: '4px 6px', textAlign: 'center', color: '#374151', fontWeight: 700 }}>HSN/SAC</th>
                            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', color: '#374151', fontWeight: 700 }}>Taxable Value</th>
                            <th style={{ border: '1px solid #e5e7eb', padding: '4px 6px', textAlign: 'center', color: '#374151', fontWeight: 700 }}>Rate</th>
                            {supplyType === 'inter'
                              ? <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', color: '#374151', fontWeight: 700 }}>IGST Amt</th>
                              : <><th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', color: '#374151', fontWeight: 700 }}>CGST Amt</th><th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', color: '#374151', fontWeight: 700 }}>SGST Amt</th></>
                            }
                            <th style={{ border: '1px solid #e5e7eb', padding: '6px 8px', textAlign: 'right', color: '#374151', fontWeight: 700 }}>Total Tax</th>
                          </tr>
                        </thead>
                        <tbody>
                          {totals.taxRows.map((r, i) => (
                            <tr key={`${r.hsn}-${i}`} style={{ background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                              <td style={{ border: '1px solid #e5e7eb', padding: '3px 6px', textAlign: 'center' }}>{r.hsn}</td>
                              <td style={{ border: '1px solid #e5e7eb', padding: '3px 6px', textAlign: 'right' }}>{curSymbol}{fmt(r.taxable)}</td>
                              <td style={{ border: '1px solid #e5e7eb', padding: '3px 6px', textAlign: 'center' }}>{r.gst}%</td>
                              {supplyType === 'inter'
                                ? <td style={{ border: '1px solid #e5e7eb', padding: '3px 6px', textAlign: 'right', fontWeight: 600 }}>{curSymbol}{fmt(r.tax)}</td>
                                : <><td style={{ border: '1px solid #e5e7eb', padding: '3px 6px', textAlign: 'right' }}>{curSymbol}{fmt(r.tax / 2)}</td><td style={{ border: '1px solid #e5e7eb', padding: '3px 6px', textAlign: 'right' }}>{curSymbol}{fmt(r.tax / 2)}</td></>
                              }
                              <td style={{ border: '1px solid #e5e7eb', padding: '3px 6px', textAlign: 'right', fontWeight: 700 }}>{curSymbol}{fmt(r.tax)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 5, overflow: 'hidden', fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid #f3f4f6' }}><span>Sub Total</span><strong>{curSymbol}{fmt(totals.subTotal)}</strong></div>
                    {globalDiscount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid #f3f4f6', color: '#dc2626' }}><span>Discount ({globalDiscount}%)</span><strong>− {curSymbol}{fmt(totals.subTotal * globalDiscount / 100)}</strong></div>}
                    {shippingCharge > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid #f3f4f6' }}><span>Shipping</span><strong>{curSymbol}{fmt(shippingCharge)}</strong></div>}
                    {otherCharges > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid #f3f4f6' }}><span>{otherChargesLabel}</span><strong>{curSymbol}{fmt(otherCharges)}</strong></div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid #f3f4f6' }}>
                      <span>{supplyType === 'inter' ? 'IGST' : 'CGST + SGST'}</span>
                      <strong>{curSymbol}{fmt(totals.taxTotal)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '2px solid #e5e7eb', background: '#f9fafb', fontWeight: 700 }}>
                      <span>Invoice Total</span><span>{curSymbol}{fmt(totals.invoiceGross)}</span>
                    </div>
                    {commission > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid #f3f4f6', color: '#dc2626' }}><span>{commissionLabel} ({commission}%)</span><strong>− {curSymbol}{fmt(totals.commissionAmount)}</strong></div>}
                    {features.showTDS && tdsAmount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid #f3f4f6', color: '#dc2626' }}><span>TDS u/s {tdsSection}</span><strong>− {curSymbol}{fmt(tdsAmount)}</strong></div>}
                    {features.showRoundOff && totals.roundOff !== 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderBottom: '1px solid #f3f4f6' }}><span>Round Off</span><strong>{totals.roundOff > 0 ? '+' : '−'}{curSymbol}{fmt(Math.abs(totals.roundOff))}</strong></div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', background: headerColor, color: '#fff' }}>
                      <span style={{ fontWeight: 600 }}>{commission > 0 || (features.showTDS && tdsAmount > 0) ? 'Net Amount Payable' : 'Total'}</span>
                      <strong style={{ fontSize: 14 }}>{curSymbol}{fmt(totals.netPayable)}</strong>
                    </div>
                  </div>
                </div>

                {/* Amount in Words */}
                {features.showAmountWords && (
                  <div style={{ marginTop: 6, padding: '5px 10px', background: `${headerColor}0d`, border: `1px solid ${headerColor}28`, borderRadius: 4, fontSize: 10 }}>
                    <span style={{ fontWeight: 700, color: headerColor }}>Amount in Words: </span>
                    <em style={{ color: '#222' }}>{numToWords(totals.netPayable)}</em>
                  </div>
                )}

                {/* Bank Details */}
                {features.showBankDetails && (
                  <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'hidden', fontSize: 10 }}>
                    <div style={{ background: headerColor, color: '#fff', padding: '4px 8px', fontWeight: 700, fontSize: 9, letterSpacing: 0.5 }}>BANK DETAILS — NEFT / RTGS / IMPS</div>
                    <div style={{ padding: '5px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 20px' }}>
                      {bankName && <div><span style={{ color: '#9ca3af', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>Bank: </span><strong>{bankName}</strong></div>}
                      {bankAccName && <div><span style={{ color: '#9ca3af', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>Account Name: </span><strong>{bankAccName}</strong></div>}
                      {bankAccNum && <div><span style={{ color: '#9ca3af', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>Account No: </span><strong style={{ letterSpacing: 1.5 }}>{bankAccNum}</strong></div>}
                      {bankAccType && <div><span style={{ color: '#9ca3af', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>Type: </span>{bankAccType}</div>}
                      {bankIFSC && <div><span style={{ color: '#9ca3af', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>IFSC: </span><strong style={{ letterSpacing: 1 }}>{bankIFSC}</strong></div>}
                      {bankBranch && <div><span style={{ color: '#9ca3af', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>Branch: </span>{bankBranch}</div>}
                      {bankUPI && <div style={{ gridColumn: '1/-1' }}><span style={{ color: '#9ca3af', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>UPI ID: </span><strong>{bankUPI}</strong></div>}
                      {bankSWIFT && <div><span style={{ color: '#9ca3af', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>SWIFT: </span><strong>{bankSWIFT}</strong></div>}
                    </div>
                  </div>
                )}

                {/* Terms & Signature */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginTop: 10, alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>Terms &amp; Conditions</div>
                    <ul style={{ paddingLeft: 12, margin: 0, fontSize: 9, color: '#555', lineHeight: 1.6 }}>
                      {terms.map((t, i) => <li key={`${t}-${i}`}>{t}</li>)}
                    </ul>
                  </div>
                  {features.showSignature && (
                    <div style={{ textAlign: 'right', minWidth: 160 }}>
                      <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 1 }}>For</div>
                      <div style={{ fontWeight: 700, fontSize: 11 }}>{companyName}</div>
                      <div style={{ width: 160, borderBottom: `1px solid ${headerColor}`, marginTop: 26, marginLeft: 'auto' }} />
                      <div style={{ fontWeight: 700, fontSize: 10, marginTop: 3 }}>{signatoryName}</div>
                      <div style={{ fontSize: 9, color: '#6b7280' }}>{signatoryDesignation}</div>
                      <div style={{ fontSize: 8, color: '#9ca3af', marginTop: 1 }}>Authorised Signatory</div>
                    </div>
                  )}
                </div>

                {/* Footer Bar */}
                <div style={{ marginTop: 8, background: headerColor, color: 'rgba(255,255,255,0.75)', padding: '5px 10px', fontSize: 9, borderRadius: 2, lineHeight: 1.4 }}>
                  {footerNote}
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Status selector — persists to DB */}
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as typeof status)}
              style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, border: '1px solid var(--n-200)', background: statusMeta[status].bg, color: statusMeta[status].color, cursor: 'pointer' }}
            >
              <option value="draft">Draft</option>
              <option value="pending">Sent</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
            {/* Quick "Mark as Paid" shortcut */}
            {(status === 'pending' || status === 'overdue') && (
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => handleStatusChange('paid')}
                style={{ fontSize: 11, background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}
              >
                ✓ Mark Paid
              </button>
            )}
            {/* Save to DB button (if already saved, shows manual save) */}
            {!activeInvoiceId && invoiceNumber && (
              <button className="btn btn-sm" type="button" onClick={() => saveInvoice()} style={{ fontSize: 11 }}>
                💾 Save
              </button>
            )}
            <button className="btn btn-primary btn-sm" type="button" onClick={downloadPdf} disabled={isDownloadingPdf} style={{ marginLeft: 'auto' }}>
              {isDownloadingPdf ? '⏳ Generating PDF…' : '⬇ Download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Invoices;
