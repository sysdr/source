import { CompanyProfile, Employee, Transaction, PayrollRun, StripeConnectedAccount, type StripeAccountScope, LeaveRequest, LeavePolicy, LeaveBalance, AttendanceRecord, VaultDocument, PendingTransaction, type GLAccount, Invoice, Vendor, Bill, PaymentRun, JournalEntry, PeriodClose, WithholdingPayment, ForeignIncomeRecord, TaxTreaty, TaxComputation, AdvanceTaxInstallment, USTaxDraft, Contractor1099, FilingTask, RemittanceRecord } from '../types';
import { setIfChanged, remove as persistentRemove, clearHashes } from './persistentStorage';
import { dbSet, dbDelete, dbClear } from './dbSync';
import { api } from './apiClient';

/** Fire-and-forget API sync — never throws, never blocks the UI */
export function syncToApi(fn: () => Promise<unknown>): void {
  fn().catch(() => { /* server unreachable — localStorage is source of truth */ });
}

/** Options for {@link storage.set} and revenue/org writes that must bypass hash deduplication. */
export interface StorageSetOptions {
  /** When true, always write to localStorage and SQLite KV (skips change-detection short-circuit). */
  force?: boolean;
}

export enum StorageKeys {
  COMPANY_PROFILE = 'suez_company_profile',
  ONBOARDED = 'suez_onboarded',
  ENV_MODE = 'suez_env_mode',
  TRANSACTIONS = 'suez_transactions',
  STRIPE_API_KEY = 'stripe_api_key',
  STRIPE_ACCOUNT_ID = 'stripe_account_id',
  EMPLOYEES = 'suez_employees',
  TRANSFER_PRICING = 'suez_transfer_pricing',
  TAX_ENGINE = 'suez_tax_engine',
  REVENUE_DATA = 'suez_revenue_data',
  AI_QUERIES = 'suez_ai_queries',
  PAYROLL_RUNS = 'suez_payroll_runs',
  PLATFORM_RULES = 'suez_platform_rules',
  MODULE_PERMISSIONS = 'suez_module_permissions',
  ONBOARDING_DRAFT = 'suez_onboarding_draft',
  STRIPE_ORG_CONFIG = 'suez_stripe_org_config',
  ORGANISATIONS = 'suez_organisations',
  ACTIVE_ORG_ID = 'suez_active_org_id',
  SYNC_SCHEDULE = 'suez_stripe_sync_schedule',
  STRIPE_SYNC_CURSORS = 'suez_stripe_sync_cursors',
  MANUAL_USD_INR_RATE = 'suez_manual_usd_inr_rate',
  LEAVE_REQUESTS = 'suez_leave_requests',
  LEAVE_POLICIES = 'suez_leave_policies',
  ATTENDANCE = 'suez_attendance',
  VAULT = 'suez_vault',
  PENDING_TRANSACTIONS = 'suez_pending_transactions',
  UI_ACTIVE_TAB = 'suez_ui_active_tab',
  UI_DASHBOARD_TREND_PERIOD = 'suez_ui_dashboard_trend_period',
  UI_DASHBOARD_TREND_ACCOUNT = 'suez_ui_dashboard_trend_account',
  UI_PAYROLL_TAB = 'suez_ui_payroll_tab',
  UI_PAYROLL_MONTH = 'suez_ui_payroll_month',
  UI_PAYROLL_YEAR = 'suez_ui_payroll_year',
  UI_PAYROLL_FORMAT = 'suez_ui_payroll_format',
  UI_PAYROLL_QUARTER = 'suez_ui_payroll_quarter',
  UI_PAYROLL_FY = 'suez_ui_payroll_fy',
  UI_ACCOUNTING_VIEW = 'suez_ui_accounting_view',
  UI_FINANCE_ENTITY = 'suez_ui_finance_entity',
  UI_REVENUE_ACCOUNT_FILTER = 'suez_ui_revenue_account_filter',
  UI_SYNC_TAB = 'suez_ui_sync_tab',
  UI_SYNC_REVENUE_PERIOD = 'suez_ui_sync_revenue_period',
  UI_ADMIN_TAB = 'suez_ui_admin_tab',
  UI_ADMIN_DOC_DRAFT = 'suez_ui_admin_doc_draft',
  UI_ONBOARDING_STEP = 'suez_ui_onboarding_step',
  UI_DISPLAY_CURRENCY = 'suez_ui_display_currency',
  INVOICES = 'suez_invoices',
  INVOICE_COMPANY_PROFILES = 'invoice_company_profiles',
  INVOICE_CLIENT_PROFILES = 'invoice_client_profiles',
  INVOICE_ACTIVE_COMPANY = 'invoice_active_company',
  VENDORS = 'suez_vendors',
  BILLS = 'suez_bills',
  PAYMENT_RUNS = 'suez_payment_runs',
  JOURNAL_ENTRIES = 'suez_journal_entries',
  PERIOD_CLOSES = 'suez_period_closes',
  WITHHOLDING_PAYMENTS = 'suez_withholding_payments',
  FOREIGN_INCOME_RECORDS = 'suez_foreign_income_records',
  TAX_TREATIES = 'suez_tax_treaties',
  TAX_COMPUTATIONS = 'suez_tax_computations',
  ADVANCE_TAX = 'suez_advance_tax',
  US_TAX_DRAFTS = 'suez_us_tax_drafts',
  CONTRACTOR_1099 = 'suez_contractor_1099',
  FILING_TASKS = 'suez_filing_tasks',
  REMITTANCE_RECORDS = 'suez_remittance_records',
  MERCURY_CONFIG = 'suez_mercury_config',
  MERCURY_CURSORS = 'suez_mercury_cursors',
}

export interface OrganisationRecord {
  id: string;
  name: string;
  profile: CompanyProfile;
  createdAt: string;
  employees: Employee[];
  transactions: Transaction[];
  revenueData: RevenueData;
  transferPricing: TransferPricingData;
  taxEngine: TaxEngineData;
  payrollRuns: PayrollRun[];
  leaveRequests: LeaveRequest[];
  leavePolicies: LeavePolicy[];
  attendance: AttendanceRecord[];
  stripeOrgConfig: StripeOrgConfig;
  platformRules: PlatformRules;
  modulePermissions: ModulePermission[];
  pendingTransactions: PendingTransaction[];
  invoices?: Invoice[];
  vendors?: Vendor[];
  bills?: Bill[];
  paymentRuns?: PaymentRun[];
  journalEntries?: JournalEntry[];
  periodCloses?: PeriodClose[];
  withholdingPayments?: WithholdingPayment[];
  foreignIncomeRecords?: ForeignIncomeRecord[];
  taxTreaties?: TaxTreaty[];
  taxComputations?: TaxComputation[];
  advanceTaxInstallments?: AdvanceTaxInstallment[];
  ustaxDrafts?: USTaxDraft[];
  contractor1099s?: Contractor1099[];
  filingTasks?: FilingTask[];
  remittanceRecords?: RemittanceRecord[];
  archived?: boolean;
  archivedAt?: string;
}

export interface OrganisationsState {
  activeOrgId: string | null;
  organisations: Record<string, OrganisationRecord>;
}

const DEFAULT_LEAVE_POLICIES: LeavePolicy[] = [
  { type: 'CL', name: 'Casual Leave', annualQuota: 12, carryForward: false, maxCarryForward: 0 },
  { type: 'SL', name: 'Sick Leave', annualQuota: 12, carryForward: false, maxCarryForward: 0 },
  { type: 'EL', name: 'Earned Leave', annualQuota: 15, carryForward: true, maxCarryForward: 30 },
  { type: 'ML', name: 'Maternity Leave', annualQuota: 182, carryForward: false, maxCarryForward: 0 },
  { type: 'PL', name: 'Paternity Leave', annualQuota: 15, carryForward: false, maxCarryForward: 0 },
  { type: 'CO', name: 'Comp Off', annualQuota: 0, carryForward: false, maxCarryForward: 0 },
];

const DEFAULT_ORG_DATA = (profile: CompanyProfile): Omit<OrganisationRecord, 'id' | 'name' | 'profile' | 'createdAt'> => ({
  employees: [],
  transactions: [],
  revenueData: { transactions: [], lastSyncDate: null, startDate: '2025-04-01', endDate: '2026-01-31' },
  transferPricing: { usRevenue: 0, usExpenses: 0, margin: 0 },
  taxEngine: { bookProfit: 0 },
  payrollRuns: [],
  leaveRequests: [],
  leavePolicies: DEFAULT_LEAVE_POLICIES,
  attendance: [],
  stripeOrgConfig: { apiKey: '', accounts: [], lastSavedAt: new Date().toISOString() },
  platformRules: { fxMarkup: 2.5, auditRiskThreshold: 500000 },
  modulePermissions: [
    { id: 'tp', name: 'Transfer Pricing Engine', desc: 'Auto-invoice generation between entities', enabled: true },
    { id: 'stripe', name: 'Live Stripe Ingestion', desc: 'Sync real-time data from Stripe API', enabled: true },
    { id: 'ai', name: 'Suez AI Assistant', desc: 'Legal & tax advice via Gemini', enabled: true },
    { id: 'filing', name: 'Statutory Filing Utility', desc: 'JSON/CSV export for GSTR & 24Q', enabled: true },
  ],
  pendingTransactions: [],
  invoices: [],
  vendors: [],
  bills: [],
  paymentRuns: [],
  journalEntries: [],
  periodCloses: [],
  withholdingPayments: [],
  foreignIncomeRecords: [],
  taxTreaties: [],
  taxComputations: [],
  advanceTaxInstallments: [],
  ustaxDrafts: [],
  contractor1099s: [],
  filingTasks: [],
  remittanceRecords: [],
});

export interface StripeOrgConfig {
  apiKey: string;
  accounts: StripeConnectedAccount[];
  lastSavedAt: string;
  accountsSource?: 'connect' | 'standard'; // connect = from /v1/accounts, standard = from /v1/account fallback
  stripeContextAccountId?: string; // Required for Organization API keys - target account for Stripe-Context header
}

export interface PlatformRules {
  fxMarkup: number;
  auditRiskThreshold: number;
}

export interface ModulePermission {
  id: string;
  name: string;
  desc: string;
  enabled: boolean;
}

// Type definitions for stored data
import type { ExportInvoiceConfig } from './exportInvoiceService';

export interface TransferPricingData {
  usRevenue: number;
  usExpenses: number;
  margin: number;
  exportInvoice?: ExportInvoiceConfig;
}

export interface TaxEngineData {
  bookProfit: number;
}

export interface RevenueData {
  transactions: Transaction[];
  lastSyncDate: string | null;
  startDate: string;
  endDate: string;
}

export interface AIQuery {
  id: string;
  query: string;
  response: string;
  timestamp: string;
}

// Generic storage functions — use persistent storage so we only write when value has changed
export const storage = {
  get<T>(key: StorageKeys): T | null {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.error(`Error reading ${key} from storage:`, error);
      return null;
    }
  },

  set<T>(key: StorageKeys, value: T, options?: StorageSetOptions): void {
    try {
      const written = setIfChanged(key, value, { force: options?.force ?? false });
      if (written) {
        dbSet(key, value);
        window.dispatchEvent(new CustomEvent('suez_storage_updated', { detail: { key } }));
      }
    } catch (error) {
      console.error(`Error writing ${key} to storage:`, error);
    }
  },

  remove(key: StorageKeys): void {
    try {
      persistentRemove(key);
      dbDelete(key);
      window.dispatchEvent(new CustomEvent('suez_storage_updated', { detail: { key } }));
    } catch (error) {
      console.error(`Error removing ${key} from storage:`, error);
    }
  },

  clear(): void {
    Object.values(StorageKeys).forEach(key => {
      localStorage.removeItem(key);
    });
    clearHashes();
    dbClear();
  },
};

function getOrganisationsState(): OrganisationsState {
  const state = storage.get<OrganisationsState>(StorageKeys.ORGANISATIONS);
  if (state) return state;
  const legacyProfile = storage.get<CompanyProfile>(StorageKeys.COMPANY_PROFILE);
  const activeId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID);
  if (legacyProfile && !state) {
    const id = activeId || `org-${Date.now()}`;
    const org: OrganisationRecord = {
      id,
      name: legacyProfile.projectName || 'Organisation',
      profile: legacyProfile,
      createdAt: new Date().toISOString(),
      employees: storage.get<Employee[]>(StorageKeys.EMPLOYEES) || [],
      transactions: storage.get<Transaction[]>(StorageKeys.TRANSACTIONS) || [],
      revenueData: storage.get<RevenueData>(StorageKeys.REVENUE_DATA) || DEFAULT_ORG_DATA(legacyProfile).revenueData,
      transferPricing: storage.get<TransferPricingData>(StorageKeys.TRANSFER_PRICING) || DEFAULT_ORG_DATA(legacyProfile).transferPricing,
      taxEngine: storage.get<TaxEngineData>(StorageKeys.TAX_ENGINE) || DEFAULT_ORG_DATA(legacyProfile).taxEngine,
      payrollRuns: storage.get<PayrollRun[]>(StorageKeys.PAYROLL_RUNS) || [],
      leaveRequests: storage.get<LeaveRequest[]>(StorageKeys.LEAVE_REQUESTS) || [],
      leavePolicies: storage.get<LeavePolicy[]>(StorageKeys.LEAVE_POLICIES) || DEFAULT_LEAVE_POLICIES,
      attendance: storage.get<AttendanceRecord[]>(StorageKeys.ATTENDANCE) || [],
      stripeOrgConfig: storage.get<StripeOrgConfig>(StorageKeys.STRIPE_ORG_CONFIG) || DEFAULT_ORG_DATA(legacyProfile).stripeOrgConfig,
      platformRules: storage.get<PlatformRules>(StorageKeys.PLATFORM_RULES) || DEFAULT_ORG_DATA(legacyProfile).platformRules,
      modulePermissions: storage.get<ModulePermission[]>(StorageKeys.MODULE_PERMISSIONS) || DEFAULT_ORG_DATA(legacyProfile).modulePermissions,
      pendingTransactions: storage.get<PendingTransaction[]>(StorageKeys.PENDING_TRANSACTIONS) || [],
      invoices: [],
      vendors: [],
      bills: [],
      paymentRuns: [],
      journalEntries: [],
      periodCloses: [],
      withholdingPayments: [],
      foreignIncomeRecords: [],
      taxTreaties: [],
      taxComputations: [],
      advanceTaxInstallments: [],
      ustaxDrafts: [],
      contractor1099s: [],
      filingTasks: [],
      remittanceRecords: [],
    };
    const newState: OrganisationsState = { activeOrgId: id, organisations: { [id]: org } };
    storage.set(StorageKeys.ORGANISATIONS, newState);
    localStorage.setItem(StorageKeys.ACTIVE_ORG_ID, id);
    return newState;
  }
  return { activeOrgId: null, organisations: {} };
}

function saveOrganisationsState(state: OrganisationsState, storageOpts?: StorageSetOptions): void {
  storage.set(StorageKeys.ORGANISATIONS, state, storageOpts);
  if (state.activeOrgId) localStorage.setItem(StorageKeys.ACTIVE_ORG_ID, state.activeOrgId);
  window.dispatchEvent(new Event('suez_data_updated'));
}

function getActiveOrg(): OrganisationRecord | null {
  const state = getOrganisationsState();
  if (!state.activeOrgId) return null;
  return state.organisations[state.activeOrgId] || null;
}

function updateActiveOrg(
  updater: (org: OrganisationRecord) => OrganisationRecord,
  storageOpts?: StorageSetOptions,
): void {
  const state = getOrganisationsState();
  if (!state.activeOrgId) return;
  const org = state.organisations[state.activeOrgId];
  if (org) {
    state.organisations[state.activeOrgId] = updater(org);
    saveOrganisationsState(state, storageOpts);
  }
}

export const getOrganisationsList = (): OrganisationRecord[] => {
  const state = getOrganisationsState();
  return Object.values(state.organisations).filter((o) => !o.archived);
};

export const getActiveOrgId = (): string | null => getOrganisationsState().activeOrgId;

export const setActiveOrgId = (id: string | null): void => {
  const state = getOrganisationsState();
  state.activeOrgId = id;
  saveOrganisationsState(state);
};

export const addOrganisation = (profile: CompanyProfile): string => {
  const state = getOrganisationsState();
  const id = `org-${Date.now()}`;
  const org: OrganisationRecord = {
    id,
    name: profile.projectName || 'New Organisation',
    profile,
    createdAt: new Date().toISOString(),
    ...DEFAULT_ORG_DATA(profile),
  };
  state.organisations[id] = org;
  state.activeOrgId = id;
  saveOrganisationsState(state);
  setOnboarded(true);
  return id;
};

export const updateOrganisation = (id: string, updates: Partial<Pick<OrganisationRecord, 'name' | 'profile'>>): void => {
  const state = getOrganisationsState();
  const org = state.organisations[id];
  if (!org) return;
  if (updates.name) org.name = updates.name;
  if (updates.profile) org.profile = updates.profile;
  saveOrganisationsState(state);
};

export const deleteOrganisation = (id: string): void => {
  const state = getOrganisationsState();
  const org = state.organisations[id];
  if (org) {
    state.organisations[id] = { ...org, archived: true, archivedAt: new Date().toISOString() };
  }
  if (state.activeOrgId === id) {
    const remaining = Object.keys(state.organisations).filter(
      (k) => !state.organisations[k].archived
    );
    state.activeOrgId = remaining[0] || null;
  }
  saveOrganisationsState(state);
};

export const getCompanyProfile = (): CompanyProfile | null => {
  const org = getActiveOrg();
  return org?.profile ?? storage.get<CompanyProfile>(StorageKeys.COMPANY_PROFILE);
};

export const setCompanyProfile = (profile: CompanyProfile): void => {
  updateActiveOrg((org) => ({ ...org, profile }));
  storage.set(StorageKeys.COMPANY_PROFILE, profile);
  window.dispatchEvent(new Event('suez_data_updated'));
  const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) ?? 'default';
  syncToApi(() => api.setOrgData(orgId, StorageKeys.COMPANY_PROFILE, profile));
};

export const isOnboarded = (): boolean => {
  return localStorage.getItem(StorageKeys.ONBOARDED) === 'true';
};

export const setOnboarded = (value: boolean): void => {
  localStorage.setItem(StorageKeys.ONBOARDED, value ? 'true' : 'false');
};

export const getEnvMode = (): 'mock' | 'live' => {
  return (localStorage.getItem(StorageKeys.ENV_MODE) as 'mock' | 'live') || 'mock';
};

export const setEnvMode = (mode: 'mock' | 'live'): void => {
  localStorage.setItem(StorageKeys.ENV_MODE, mode);
};

export interface LiveModeDataStatus {
  isLiveMode: boolean;
  hasData: boolean;
  orgCount: number;
  totalTransactions: number;
  totalRevenueTransactions: number;
  vaultDocCount: number;
}

/** Check if currently in live mode and whether any stored data exists */
export const getLiveModeDataStatus = (): LiveModeDataStatus => {
  const isLiveMode = getEnvMode() === 'live';
  const state = getOrganisationsState();
  const orgList = Object.values(state.organisations);
  let totalTransactions = 0;
  let totalRevenueTransactions = 0;
  orgList.forEach((org) => {
    totalTransactions += org.transactions?.length ?? 0;
    totalRevenueTransactions += org.revenueData?.transactions?.length ?? 0;
  });
  const vaultDocCount = (storage.get<unknown[]>(StorageKeys.VAULT) || []).length;
  const hasData = orgList.length > 0 || totalTransactions > 0 || totalRevenueTransactions > 0 || vaultDocCount > 0 ||
    !!storage.get(StorageKeys.COMPANY_PROFILE) || !!storage.get(StorageKeys.TRANSACTIONS);
  return {
    isLiveMode,
    hasData,
    orgCount: orgList.length,
    totalTransactions,
    totalRevenueTransactions,
    vaultDocCount,
  };
};

/** If currently in live mode, remove all stored data and reset to clean state */
export const clearAllDataInLiveMode = (): boolean => {
  if (getEnvMode() !== 'live') return false;
  clearAllOrganisationData();
  return true;
};

const getAllTransactionsIncludingArchived = (): Transaction[] => {
  const org = getActiveOrg();
  if (org) return org.transactions;
  return storage.get<Transaction[]>(StorageKeys.TRANSACTIONS) || [];
};

/** Chunk size for SQLite POST /api/transactions — avoids oversized bodies on large Stripe backfills. */
const SQLITE_TXN_UPSERT_CHUNK = 400;

const setTransactionsRaw = (transactions: Transaction[]): void => {
  updateActiveOrg((org) => ({ ...org, transactions }));
  storage.set(StorageKeys.TRANSACTIONS, transactions);
  window.dispatchEvent(new Event('suez_data_updated'));
  // Dual-write to SQLite domain table (fire-and-forget; chunked for large ledgers)
  const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) ?? 'default';
  syncToApi(async () => {
    for (let i = 0; i < transactions.length; i += SQLITE_TXN_UPSERT_CHUNK) {
      const chunk = transactions.slice(i, i + SQLITE_TXN_UPSERT_CHUNK);
      await api.upsertTransactions(orgId, chunk);
    }
  });
};

export const getTransactions = (): Transaction[] => {
  return getAllTransactionsIncludingArchived().filter((t) => !t.archived);
};

export const setTransactions = (transactions: Transaction[]): void => {
  const archived = getAllTransactionsIncludingArchived().filter((t) => t.archived);
  setTransactionsRaw([...transactions, ...archived]);
};

export const addTransaction = (transaction: Transaction): void => {
  const all = getAllTransactionsIncludingArchived();
  setTransactionsRaw([transaction, ...all]);
};

export const removeTransaction = (id: string): void => {
  const current = getAllTransactionsIncludingArchived();
  const now = new Date().toISOString();
  const transactions = current.map((t) =>
    t.id === id ? { ...t, archived: true, archivedAt: now } : t
  );
  setTransactionsRaw(transactions);
  const target = current.find((t) => t.id === id);
  if (target?.stripeChargeId || target?.source === 'Stripe') {
    const revenue = getRevenueDataRaw();
    const updated = revenue.transactions.map((t) =>
      (t.id === id || t.stripeChargeId === target?.stripeChargeId)
        ? { ...t, archived: true, archivedAt: now }
        : t
    );
    if (updated.some((t, i) => t.archived !== revenue.transactions[i]?.archived)) {
      setRevenueData({ ...revenue, transactions: updated });
      window.dispatchEvent(new Event('suez_data_updated'));
    }
  }
};

/** Update an existing transaction by id. Only updates non-Stripe manual/source transactions in place; others are unchanged. */
export const updateTransaction = (id: string, updates: Partial<Omit<Transaction, 'id'>>): void => {
  const current = getAllTransactionsIncludingArchived();
  const index = current.findIndex((t) => t.id === id);
  if (index === -1) return;
  const existing = current[index];
  if (existing.source === 'Stripe' || existing.stripeChargeId) return; // Do not edit Stripe-synced transactions
  const updated = { ...existing, ...updates };
  const next = current.slice();
  next[index] = updated;
  setTransactionsRaw(next);
};

const getAllEmployeesIncludingArchived = (): Employee[] => {
  const org = getActiveOrg();
  if (org) return org.employees;
  const saved = storage.get<Employee[]>(StorageKeys.EMPLOYEES);
  if (saved) return saved;
  return [];
};

const setEmployeesRaw = (employees: Employee[]): void => {
  updateActiveOrg((org) => ({ ...org, employees }));
  storage.set(StorageKeys.EMPLOYEES, employees);
  const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) ?? 'default';
  syncToApi(() => api.upsertEmployees(orgId, employees));
};

export const getEmployees = (): Employee[] => {
  return getAllEmployeesIncludingArchived().filter((e) => e.status !== 'Archived');
};

export const setEmployees = (employees: Employee[]): void => {
  const archived = getAllEmployeesIncludingArchived().filter((e) => e.status === 'Archived');
  setEmployeesRaw([...employees, ...archived]);
};

export const addEmployee = (employee: Employee): void => {
  const all = getAllEmployeesIncludingArchived();
  setEmployeesRaw([...all, employee]);
};

export const updateEmployee = (id: string, updates: Partial<Employee>): void => {
  const all = getAllEmployeesIncludingArchived();
  const index = all.findIndex(e => e.id === id);
  if (index !== -1) {
    all[index] = { ...all[index], ...updates };
    setEmployeesRaw(all);
  }
};

export const getTransferPricingData = (): TransferPricingData => {
  const org = getActiveOrg();
  if (org) return org.transferPricing;
  return storage.get<TransferPricingData>(StorageKeys.TRANSFER_PRICING) || { usRevenue: 0, usExpenses: 0, margin: 0 };
};

export const setTransferPricingData = (data: TransferPricingData): void => {
  updateActiveOrg((org) => ({ ...org, transferPricing: data }));
  storage.set(StorageKeys.TRANSFER_PRICING, data);
};

export const getTaxEngineData = (): TaxEngineData => {
  const org = getActiveOrg();
  if (org) return org.taxEngine;
  return storage.get<TaxEngineData>(StorageKeys.TAX_ENGINE) || { bookProfit: 0 };
};

export const setTaxEngineData = (data: TaxEngineData): void => {
  updateActiveOrg((org) => ({ ...org, taxEngine: data }));
  storage.set(StorageKeys.TAX_ENGINE, data);
};

const getRevenueDataRaw = (): RevenueData => {
  const org = getActiveOrg();
  if (org) return org.revenueData;
  // endDate defaults to today so newly-configured accounts always sync up to the current date
  const today = new Date().toISOString().split('T')[0];
  return storage.get<RevenueData>(StorageKeys.REVENUE_DATA) || { transactions: [], lastSyncDate: null, startDate: '2025-04-01', endDate: today };
};

export const getRevenueData = (): RevenueData => {
  const raw = getRevenueDataRaw();
  return { ...raw, transactions: raw.transactions.filter((t) => !t.archived) };
};

export const setRevenueData = (data: RevenueData, options?: StorageSetOptions): void => {
  const rawExisting = getRevenueDataRaw();
  const archived = rawExisting.transactions.filter((t) => t.archived);
  const merged = { ...data, transactions: [...data.transactions, ...archived] };
  updateActiveOrg((org) => ({ ...org, revenueData: merged }), options);
  storage.set(StorageKeys.REVENUE_DATA, merged, options);
  const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) ?? 'default';
  syncToApi(() => api.setOrgData(orgId, StorageKeys.REVENUE_DATA, merged));
};

export const getStripeCredentials = (): { apiKey: string; accountId: string } => {
  const org = getActiveOrg();
  if (org?.stripeOrgConfig?.apiKey) return { apiKey: org.stripeOrgConfig.apiKey, accountId: org.stripeOrgConfig.accounts[0]?.id || '' };
  return { apiKey: localStorage.getItem(StorageKeys.STRIPE_API_KEY) || '', accountId: localStorage.getItem(StorageKeys.STRIPE_ACCOUNT_ID) || '' };
};

export const setStripeCredentials = (apiKey: string, accountId: string): void => {
  const config = getStripeOrgConfig();
  config.apiKey = apiKey;
  if (accountId && !config.accounts.some(a => a.id === accountId)) config.accounts = [{ id: accountId, name: 'Primary', addedAt: new Date().toISOString() }, ...config.accounts];
  setStripeOrgConfig(config);
};

export const getStripeOrgConfig = (): StripeOrgConfig => {
  const org = getActiveOrg();
  const raw = org?.stripeOrgConfig
    || storage.get<StripeOrgConfig>(StorageKeys.STRIPE_ORG_CONFIG)
    || null;
  if (raw) {
    return { ...raw, accounts: raw.accounts.filter(a => !a.archived) };
  }
  const creds = getStripeCredentials();
  const accountId = creds.accountId;
  return { apiKey: creds.apiKey, accounts: accountId ? [{ id: accountId, name: 'Primary', addedAt: new Date().toISOString() }] : [], lastSavedAt: new Date().toISOString() };
};

const getStripeOrgConfigRaw = (): StripeOrgConfig | null => {
  const org = getActiveOrg();
  return org?.stripeOrgConfig
    || storage.get<StripeOrgConfig>(StorageKeys.STRIPE_ORG_CONFIG)
    || null;
};

export const setStripeOrgConfig = (config: StripeOrgConfig): void => {
  const raw = getStripeOrgConfigRaw();
  const archivedAccounts = raw?.accounts.filter(a => a.archived) || [];
  const merged = { ...config, accounts: [...config.accounts, ...archivedAccounts] };
  updateActiveOrg((org) => ({ ...org, stripeOrgConfig: merged }));
  storage.set(StorageKeys.STRIPE_ORG_CONFIG, merged);
  localStorage.setItem(StorageKeys.STRIPE_API_KEY, config.apiKey);
  window.dispatchEvent(new Event('suez_data_updated'));
  const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) ?? 'default';
  syncToApi(() => api.setOrgData(orgId, StorageKeys.STRIPE_ORG_CONFIG, merged));
};

export const addStripeAccount = (accountId: string, name?: string, scope?: StripeAccountScope): void => {
  const config = getStripeOrgConfig();
  if (config.accounts.some(a => a.id === accountId)) return;
  config.accounts.push({
    id: accountId,
    name: name || accountId.slice(0, 12) + '...',
    addedAt: new Date().toISOString(),
    scope: scope ?? 'standalone',
  });
  config.lastSavedAt = new Date().toISOString();
  setStripeOrgConfig(config);
};

export const removeStripeAccount = (accountId: string): void => {
  const config = getStripeOrgConfig();
  const now = new Date().toISOString();
  config.accounts = config.accounts.map(a =>
    a.id === accountId ? { ...a, archived: true, archivedAt: now } : a
  );
  config.lastSavedAt = now;
  setStripeOrgConfig(config);
};

export const updateStripeAccountName = (accountId: string, name: string): void => {
  const config = getStripeOrgConfig();
  const acc = config.accounts.find(a => a.id === accountId);
  if (acc) {
    acc.name = name.trim() || acc.id.slice(0, 12) + '...';
    config.lastSavedAt = new Date().toISOString();
    setStripeOrgConfig(config);
  }
};

export const updateStripeAccountScope = (accountId: string, scope: StripeAccountScope): void => {
  const config = getStripeOrgConfig();
  const acc = config.accounts.find(a => a.id === accountId);
  if (acc) {
    acc.scope = scope;
    config.lastSavedAt = new Date().toISOString();
    setStripeOrgConfig(config);
  }
};

export const syncStripeAccountsFromApi = (accounts: { id: string; name?: string }[], source?: 'connect' | 'standard'): void => {
  const config = getStripeOrgConfig();
  const now = new Date().toISOString();
  const scope: StripeAccountScope = source === 'connect' ? 'organisation' : 'standalone';
  config.accounts = accounts.map((a) => ({
    id: a.id,
    name: a.name || a.id.slice(0, 12) + '...',
    addedAt: now,
    scope,
  }));
  config.accountsSource = source;
  config.lastSavedAt = now;
  setStripeOrgConfig(config);
};

/** Merge fetched accounts as organisation-scoped only; keeps existing standalone accounts. */
export const mergeStripeOrganisationAccountsFromApi = (accounts: { id: string; name?: string }[]): void => {
  const config = getStripeOrgConfig();
  const now = new Date().toISOString();
  const standalone = config.accounts.filter((a) => (a.scope ?? 'standalone') === 'standalone');
  config.accounts = [
    ...accounts.map((a) => ({
      id: a.id,
      name: a.name || a.id.slice(0, 12) + '...',
      addedAt: now,
      scope: 'organisation' as const,
    })),
    ...standalone,
  ];
  config.accountsSource = config.accounts.some((a) => (a.scope ?? 'standalone') === 'organisation') ? 'connect' : config.accountsSource;
  config.lastSavedAt = now;
  setStripeOrgConfig(config);
};

/** Add or update a single account as standalone; keeps existing organisation accounts. */
export const mergeStripeStandaloneAccountFromApi = (account: { id: string; name?: string }): void => {
  const config = getStripeOrgConfig();
  const now = new Date().toISOString();
  const orgAccounts = config.accounts.filter((a) => (a.scope ?? 'standalone') === 'organisation');
  const existing = config.accounts.find((a) => a.id === account.id);
  const rest = config.accounts.filter((a) => a.id !== account.id && (a.scope ?? 'standalone') === 'standalone');
  config.accounts = [
    ...orgAccounts,
    {
      id: account.id,
      name: account.name || account.id.slice(0, 12) + '...',
      addedAt: existing?.addedAt ?? now,
      scope: 'standalone' as const,
    },
    ...rest,
  ];
  if (!config.accountsSource || config.accounts.filter((a) => (a.scope ?? 'standalone') === 'standalone').length > 0) {
    config.accountsSource = orgAccounts.length > 0 ? 'connect' : 'standard';
  }
  config.lastSavedAt = now;
  setStripeOrgConfig(config);
};

/** Ledger merge key: Stripe rows dedupe on charge id; imported/manual rows use transaction id. */
function ledgerMergeKey(t: Pick<Transaction, 'id' | 'stripeChargeId'>): string {
  return t.stripeChargeId ? String(t.stripeChargeId) : t.id;
}

export const mergeRevenueIntoTransactions = (revenueTxns: Transaction[]): void => {
  const existing = getTransactions();
  const existingKeys = new Set(existing.map((t) => ledgerMergeKey(t)));
  const statusOk = (t: Transaction) =>
    t.status === 'Completed' || t.status === 'Refunded' || t.status === 'Pending' || t.status === 'Failed';
  // Stripe (stripeChargeId) + CSV/manual revenue (e.g. Substack) — all persist via setTransactions → SQLite
  const toMerge = revenueTxns.filter(
    (t) => statusOk(t) && !existingKeys.has(ledgerMergeKey(t)),
  );
  if (toMerge.length > 0) {
    setTransactions([...toMerge, ...existing]);
  }
};

// ── Pending transactions (HITL) ─────────────────────────────────────────────

function getPendingTransactionsRaw(): PendingTransaction[] {
  const org = getActiveOrg();
  if (org?.pendingTransactions) return org.pendingTransactions;
  return storage.get<PendingTransaction[]>(StorageKeys.PENDING_TRANSACTIONS) || [];
}

function setPendingTransactionsRaw(list: PendingTransaction[]): void {
  updateActiveOrg((o) => ({ ...o, pendingTransactions: list }));
  storage.set(StorageKeys.PENDING_TRANSACTIONS, list);
  window.dispatchEvent(new Event('suez_data_updated'));
}

export const getPendingTransactions = (): PendingTransaction[] => getPendingTransactionsRaw();

export const addPendingTransaction = (pending: PendingTransaction): void => {
  setPendingTransactionsRaw([pending, ...getPendingTransactionsRaw()]);
};

export const removePendingTransaction = (id: string): void => {
  setPendingTransactionsRaw(getPendingTransactionsRaw().filter((p) => p.id !== id));
};

export const approvePendingTransaction = (id: string): void => {
  const list = getPendingTransactionsRaw();
  const found = list.find((p) => p.id === id);
  if (!found) return;
  const tx: Transaction = {
    id: found.id,
    date: found.date,
    description: found.description,
    amount: found.amount,
    currency: found.currency,
    source: 'Manual',
    category: found.category,
    status: 'Completed',
    type: found.type,
    entity: found.entity,
    gstImpact: found.type === 'Purchase' ? found.amount * 0.18 : 0,
  };
  addTransaction(tx);
  setPendingTransactionsRaw(list.filter((p) => p.id !== id));
};

// ── Chart of accounts ───────────────────────────────────────────────────────

const DEFAULT_GL_ACCOUNTS: GLAccount[] = [
  { code: '4000', name: 'Revenue', type: 'Income' },
  { code: '4100', name: 'Other Income', type: 'Income' },
  { code: '5000', name: 'Cost of Sales', type: 'Purchase' },
  { code: '6100', name: 'SaaS & Hosting', type: 'Expense' },
  { code: '6200', name: 'Payroll', type: 'Expense' },
  { code: '6300', name: 'Marketing', type: 'Expense' },
  { code: '6400', name: 'Rent & Utilities', type: 'Expense' },
  { code: '6500', name: 'Professional Services', type: 'Expense' },
  { code: '6600', name: 'Transfer Pricing', type: 'Expense' },
  { code: '6900', name: 'Other Expenses', type: 'Expense' },
  { code: '1000', name: 'Bank/Cash', type: 'Asset' },
  { code: '1500', name: 'Fixed Assets', type: 'Asset' },
  { code: '2000', name: 'Payables', type: 'Liability' },
  { code: '3000', name: 'Equity', type: 'Equity' },
];

export const getChartOfAccounts = (): GLAccount[] => {
  const profile = getCompanyProfile();
  const accounts = profile?.accounting?.glAccounts;
  if (accounts && accounts.length > 0) return accounts;
  return DEFAULT_GL_ACCOUNTS;
};

export const setChartOfAccounts = (accounts: GLAccount[]): void => {
  const profile = getCompanyProfile();
  if (!profile) return;
  const updated = { ...profile, accounting: { ...profile.accounting, glAccounts: accounts } };
  setCompanyProfile(updated);
};

export const getAIQueries = (): AIQuery[] => {
  return storage.get<AIQuery[]>(StorageKeys.AI_QUERIES) || [];
};

export const addAIQuery = (query: string, response: string): void => {
  const queries = getAIQueries();
  const newQuery: AIQuery = {
    id: `ai-${Date.now()}`,
    query,
    response,
    timestamp: new Date().toISOString(),
  };
  storage.set(StorageKeys.AI_QUERIES, [newQuery, ...queries]);
};

export const getPayrollRuns = (): PayrollRun[] => {
  const org = getActiveOrg();
  if (org) return org.payrollRuns;
  return storage.get<PayrollRun[]>(StorageKeys.PAYROLL_RUNS) || [];
};

export const addPayrollRun = (run: PayrollRun): void => {
  const org = getActiveOrg();
  const runs = org ? [run, ...org.payrollRuns] : [run];
  updateActiveOrg((o) => ({ ...o, payrollRuns: runs }));
  storage.set(StorageKeys.PAYROLL_RUNS, runs);
  const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) ?? 'default';
  syncToApi(() => api.upsertPayrollRun(orgId, run));
};

export const getPayrollRunForCycle = (month: string, year: number): PayrollRun | null => {
  return getPayrollRuns().find(r => r.month === month && r.year === year) || null;
};

// ── ERP: Invoices, Vendors, Bills, Payments, Journals, WHT, Filing, FEMA ─────

function getOrgArray<K extends keyof OrganisationRecord>(key: K): OrganisationRecord[K] extends unknown[] ? OrganisationRecord[K] : never {
  const org = getActiveOrg();
  if (!org) return [] as OrganisationRecord[K] extends unknown[] ? OrganisationRecord[K] : never;
  const val = org[key];
  return (Array.isArray(val) ? val : []) as OrganisationRecord[K] extends unknown[] ? OrganisationRecord[K] : never;
}

function setOrgArray<K extends keyof OrganisationRecord>(key: K, value: OrganisationRecord[K]): void {
  updateActiveOrg((org) => ({ ...org, [key]: value }));
  window.dispatchEvent(new Event('suez_data_updated'));
}

export const getInvoices = (): Invoice[] => getOrgArray('invoices');
export const setInvoices = (list: Invoice[]): void => {
  setOrgArray('invoices', list);
  const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) ?? 'default';
  syncToApi(async () => { for (const inv of list) await api.upsertInvoice(orgId, inv); });
};
export const addInvoice = (inv: Invoice): void => {
  setInvoices([inv, ...getInvoices()]);
  const orgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID) ?? 'default';
  syncToApi(() => api.upsertInvoice(orgId, inv));
};
export const updateInvoice = (id: string, updates: Partial<Invoice>): void => {
  const list = getInvoices().map((i) => (i.id === id ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i));
  setInvoices(list);
};
export const deleteInvoice = (id: string): void => {
  const list = getInvoices().filter((i) => i.id !== id);
  setInvoices(list);
};

export const getVendors = (): Vendor[] => (getOrgArray('vendors') as Vendor[]).filter((v) => !v.archived);
export const setVendors = (list: Vendor[]): void => setOrgArray('vendors', list);
export const addVendor = (v: Vendor): void => setVendors([...getOrgArray('vendors') as Vendor[], v]);
export const updateVendor = (id: string, updates: Partial<Vendor>): void => {
  const list = (getOrgArray('vendors') as Vendor[]).map((i) => (i.id === id ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i));
  setOrgArray('vendors', list);
};

export const getBills = (): Bill[] => getOrgArray('bills');
export const setBills = (list: Bill[]): void => setOrgArray('bills', list);
export const addBill = (b: Bill): void => setBills([b, ...getBills()]);
export const updateBill = (id: string, updates: Partial<Bill>): void => {
  const list = getBills().map((i) => (i.id === id ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i));
  setBills(list);
};

export const getPaymentRuns = (): PaymentRun[] => getOrgArray('paymentRuns');
export const setPaymentRuns = (list: PaymentRun[]): void => setOrgArray('paymentRuns', list);
export const addPaymentRun = (pr: PaymentRun): void => setPaymentRuns([pr, ...getPaymentRuns()]);

export const getJournalEntries = (): JournalEntry[] => getOrgArray('journalEntries');
export const setJournalEntries = (list: JournalEntry[]): void => setOrgArray('journalEntries', list);
export const addJournalEntry = (je: JournalEntry): void => setJournalEntries([je, ...getJournalEntries()]);
export const updateJournalEntry = (id: string, updates: Partial<JournalEntry>): void => {
  const list = getJournalEntries().map((i) => (i.id === id ? { ...i, ...updates } : i));
  setJournalEntries(list);
};

export const getPeriodCloses = (): PeriodClose[] => getOrgArray('periodCloses');
export const setPeriodCloses = (list: PeriodClose[]): void => setOrgArray('periodCloses', list);
export const addPeriodClose = (pc: PeriodClose): void => setPeriodCloses([...getPeriodCloses(), pc]);

export const getWithholdingPayments = (): WithholdingPayment[] => getOrgArray('withholdingPayments');
export const setWithholdingPayments = (list: WithholdingPayment[]): void => setOrgArray('withholdingPayments', list);
export const addWithholdingPayment = (w: WithholdingPayment): void => setWithholdingPayments([w, ...getWithholdingPayments()]);

export const getForeignIncomeRecords = (): ForeignIncomeRecord[] => getOrgArray('foreignIncomeRecords');
export const setForeignIncomeRecords = (list: ForeignIncomeRecord[]): void => setOrgArray('foreignIncomeRecords', list);
export const addForeignIncomeRecord = (r: ForeignIncomeRecord): void => setForeignIncomeRecords([r, ...getForeignIncomeRecords()]);

export const getTaxTreaties = (): TaxTreaty[] => getOrgArray('taxTreaties');
export const setTaxTreaties = (list: TaxTreaty[]): void => setOrgArray('taxTreaties', list);
export const addTaxTreaty = (t: TaxTreaty): void => setTaxTreaties([...getTaxTreaties(), t]);

export const getTaxComputations = (): TaxComputation[] => getOrgArray('taxComputations');
export const setTaxComputations = (list: TaxComputation[]): void => setOrgArray('taxComputations', list);
export const addTaxComputation = (c: TaxComputation): void => setTaxComputations([...getTaxComputations(), c]);

export const getAdvanceTaxInstallments = (): AdvanceTaxInstallment[] => getOrgArray('advanceTaxInstallments');
export const setAdvanceTaxInstallments = (list: AdvanceTaxInstallment[]): void => setOrgArray('advanceTaxInstallments', list);
export const addAdvanceTaxInstallment = (a: AdvanceTaxInstallment): void => setAdvanceTaxInstallments([...getAdvanceTaxInstallments(), a]);

export const getUSTaxDrafts = (): USTaxDraft[] => getOrgArray('ustaxDrafts');
export const setUSTaxDrafts = (list: USTaxDraft[]): void => setOrgArray('ustaxDrafts', list);
export const addUSTaxDraft = (u: USTaxDraft): void => setUSTaxDrafts([u, ...getUSTaxDrafts()]);

export const getContractor1099s = (): Contractor1099[] => getOrgArray('contractor1099s');
export const setContractor1099s = (list: Contractor1099[]): void => setOrgArray('contractor1099s', list);
export const addContractor1099 = (c: Contractor1099): void => setContractor1099s([c, ...getContractor1099s()]);

export const getFilingTasks = (): FilingTask[] => getOrgArray('filingTasks');
export const setFilingTasks = (list: FilingTask[]): void => setOrgArray('filingTasks', list);
export const addFilingTask = (f: FilingTask): void => setFilingTasks([f, ...getFilingTasks()]);
export const updateFilingTask = (id: string, updates: Partial<FilingTask>): void => {
  const list = getFilingTasks().map((i) => (i.id === id ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i));
  setFilingTasks(list);
};

export const getRemittanceRecords = (): RemittanceRecord[] => getOrgArray('remittanceRecords');
export const setRemittanceRecords = (list: RemittanceRecord[]): void => setOrgArray('remittanceRecords', list);
export const addRemittanceRecord = (r: RemittanceRecord): void => setRemittanceRecords([r, ...getRemittanceRecords()]);

export const deleteEmployee = (id: string): void => {
  const all = getAllEmployeesIncludingArchived();
  const updated = all.map(e => e.id === id ? { ...e, status: 'Archived' as const } : e);
  setEmployeesRaw(updated);
};

// ── Leave Management ────────────────────────────────────────────────────────

export const getLeavePolicies = (): LeavePolicy[] => {
  const org = getActiveOrg();
  if (org?.leavePolicies) return org.leavePolicies;
  return storage.get<LeavePolicy[]>(StorageKeys.LEAVE_POLICIES) || DEFAULT_LEAVE_POLICIES;
};

export const setLeavePolicies = (policies: LeavePolicy[]): void => {
  updateActiveOrg((org) => ({ ...org, leavePolicies: policies }));
  storage.set(StorageKeys.LEAVE_POLICIES, policies);
};

export const getLeaveRequests = (): LeaveRequest[] => {
  const org = getActiveOrg();
  if (org?.leaveRequests) return org.leaveRequests;
  return storage.get<LeaveRequest[]>(StorageKeys.LEAVE_REQUESTS) || [];
};

export const addLeaveRequest = (request: LeaveRequest): void => {
  const requests = getLeaveRequests();
  updateActiveOrg((org) => ({ ...org, leaveRequests: [request, ...org.leaveRequests || []] }));
  storage.set(StorageKeys.LEAVE_REQUESTS, [request, ...requests]);
};

export const updateLeaveRequest = (id: string, updates: Partial<LeaveRequest>): void => {
  const requests = getLeaveRequests();
  const idx = requests.findIndex(r => r.id === id);
  if (idx !== -1) {
    requests[idx] = { ...requests[idx], ...updates };
    updateActiveOrg((org) => ({ ...org, leaveRequests: requests }));
    storage.set(StorageKeys.LEAVE_REQUESTS, requests);
  }
};

export const getLeaveBalance = (employeeId: string, year: number): LeaveBalance => {
  const policies = getLeavePolicies();
  const requests = getLeaveRequests().filter(
    r => r.employeeId === employeeId && r.status === 'Approved' && new Date(r.fromDate).getFullYear() === year,
  );
  const balances: Record<string, { total: number; used: number; remaining: number }> = {};
  for (const policy of policies) {
    const used = requests.filter(r => r.type === policy.type).reduce((a, r) => a + r.days, 0);
    balances[policy.type] = { total: policy.annualQuota, used, remaining: Math.max(0, policy.annualQuota - used) };
  }
  return { employeeId, year, balances };
};

// ── Attendance ──────────────────────────────────────────────────────────────

export const getAttendanceRecords = (employeeId?: string, month?: string, year?: number): AttendanceRecord[] => {
  const org = getActiveOrg();
  let records = org?.attendance || storage.get<AttendanceRecord[]>(StorageKeys.ATTENDANCE) || [];
  if (employeeId) records = records.filter(r => r.employeeId === employeeId);
  if (month && year) {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthIdx = MONTHS.indexOf(month);
    records = records.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === monthIdx && d.getFullYear() === year;
    });
  }
  return records;
};

export const addAttendanceRecord = (record: AttendanceRecord): void => {
  const records = getAttendanceRecords();
  const existing = records.findIndex(r => r.employeeId === record.employeeId && r.date === record.date);
  if (existing !== -1) {
    records[existing] = record;
  } else {
    records.push(record);
  }
  updateActiveOrg((org) => ({ ...org, attendance: records }));
  storage.set(StorageKeys.ATTENDANCE, records);
};

export const bulkAddAttendance = (newRecords: AttendanceRecord[]): void => {
  const records = getAttendanceRecords();
  for (const rec of newRecords) {
    const existing = records.findIndex(r => r.employeeId === rec.employeeId && r.date === rec.date);
    if (existing !== -1) records[existing] = rec;
    else records.push(rec);
  }
  updateActiveOrg((org) => ({ ...org, attendance: records }));
  storage.set(StorageKeys.ATTENDANCE, records);
};

export const getPlatformRules = (): PlatformRules => {
  const org = getActiveOrg();
  if (org) return org.platformRules;
  return storage.get<PlatformRules>(StorageKeys.PLATFORM_RULES) || { fxMarkup: 2.5, auditRiskThreshold: 500000 };
};

export const setPlatformRules = (rules: PlatformRules): void => {
  updateActiveOrg((org) => ({ ...org, platformRules: rules }));
  storage.set(StorageKeys.PLATFORM_RULES, rules);
};

const DEFAULT_MODULES: ModulePermission[] = [
  { id: 'tp', name: 'Transfer Pricing Engine', desc: 'Auto-invoice generation between entities', enabled: true },
  { id: 'stripe', name: 'Live Stripe Ingestion', desc: 'Sync real-time data from Stripe API', enabled: true },
  { id: 'ai', name: 'Suez AI Assistant', desc: 'Legal & tax advice via Gemini', enabled: true },
  { id: 'filing', name: 'Statutory Filing Utility', desc: 'JSON/CSV export for GSTR & 24Q', enabled: true },
];

export const getModulePermissions = (): ModulePermission[] => {
  const org = getActiveOrg();
  if (org) return org.modulePermissions;
  return storage.get<ModulePermission[]>(StorageKeys.MODULE_PERMISSIONS) || DEFAULT_MODULES;
};

export const setModulePermissions = (perms: ModulePermission[]): void => {
  updateActiveOrg((org) => ({ ...org, modulePermissions: perms }));
  storage.set(StorageKeys.MODULE_PERMISSIONS, perms);
};

export const toggleModulePermission = (id: string, enabled: boolean): void => {
  const perms = getModulePermissions();
  const idx = perms.findIndex(p => p.id === id);
  if (idx !== -1) {
    perms[idx] = { ...perms[idx], enabled };
    setModulePermissions(perms);
  }
};

/** Check if there is existing organisation data (previously created/onboarded) */
export const hasExistingOrganisation = (): boolean => {
  const state = getOrganisationsState();
  const activeOrgs = Object.values(state.organisations).filter((o) => !o.archived);
  return activeOrgs.length > 0 || (isOnboarded() && !!getCompanyProfile());
};

/** Archive all organisation data for "Start Fresh" - marks everything as archived but preserves data */
export const clearAllOrganisationData = (): void => {
  const state = getOrganisationsState();
  const now = new Date().toISOString();
  for (const id of Object.keys(state.organisations)) {
    state.organisations[id] = { ...state.organisations[id], archived: true, archivedAt: now };
  }
  state.activeOrgId = null;
  saveOrganisationsState(state);
  localStorage.removeItem(StorageKeys.ACTIVE_ORG_ID);
  window.dispatchEvent(new Event('suez_data_updated'));
};

export const getManualUsdToInrRate = (): number | null => {
  const v = storage.get<number>(StorageKeys.MANUAL_USD_INR_RATE);
  return typeof v === 'number' && v > 0 ? v : null; 
};

export const setManualUsdToInrRate = (rate: number | null): void => {
  storage.set(StorageKeys.MANUAL_USD_INR_RATE, rate !== null && rate > 0 ? rate : 0);
  window.dispatchEvent(new Event('suez_data_updated'));
};

export const getOnboardingDraft = (): CompanyProfile | null => {
  return storage.get<CompanyProfile>(StorageKeys.ONBOARDING_DRAFT);
};

export const setOnboardingDraft = (profile: CompanyProfile | null): void => {
  storage.set(StorageKeys.ONBOARDING_DRAFT, profile);
};

/** Export configuration payload - includes all settings, company details, orgs, Stripe, IDs, etc. */
export interface ConfigExportPayload {
  version: number;
  exportedAt: string;
  data: Record<string, unknown>;
}

/** Export all configurations: company details, orgs, IDs, Stripe accounts, employees, transactions, etc. */
export const exportConfig = (): ConfigExportPayload => {
  const data: Record<string, unknown> = {};
  const keys = Object.values(StorageKeys);
  keys.forEach((key) => {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        data[key] = JSON.parse(raw);
      } catch {
        data[key] = raw;
      }
    }
  });
  const activeOrgId = localStorage.getItem(StorageKeys.ACTIVE_ORG_ID);
  if (activeOrgId) data[StorageKeys.ACTIVE_ORG_ID] = activeOrgId;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
};

/** Import configuration from a previously exported payload. Returns success/error. */
/** After bulk import, push org-scoped domain rows to SQLite (transactions, employees, org_data). */
function syncImportedActiveOrgToSqlite(): void {
  const state = getOrganisationsState();
  const orgId = state.activeOrgId ?? 'default';
  const org = state.organisations[orgId];
  if (!org) return;

  syncToApi(async () => {
    const txns = org.transactions ?? [];
    for (let i = 0; i < txns.length; i += SQLITE_TXN_UPSERT_CHUNK) {
      await api.upsertTransactions(orgId, txns.slice(i, i + SQLITE_TXN_UPSERT_CHUNK));
    }
    await api.upsertEmployees(orgId, org.employees ?? []);
    for (const run of org.payrollRuns ?? []) {
      await api.upsertPayrollRun(orgId, run);
    }
    await api.setOrgData(orgId, StorageKeys.REVENUE_DATA, org.revenueData);
    await api.setOrgData(orgId, StorageKeys.STRIPE_ORG_CONFIG, org.stripeOrgConfig);
    await api.setOrgData(orgId, StorageKeys.COMPANY_PROFILE, org.profile);
    await api.setOrgData(orgId, StorageKeys.TRANSFER_PRICING, org.transferPricing);
    await api.setOrgData(orgId, StorageKeys.TAX_ENGINE, org.taxEngine);
  });
}

export const importConfig = (payload: ConfigExportPayload): { success: boolean; error?: string } => {
  try {
    if (!payload || typeof payload !== 'object' || !payload.data) {
      return { success: false, error: 'Invalid export file: missing data' };
    }
    const { data } = payload;
    const keys = Object.values(StorageKeys) as string[];
    keys.forEach((key) => {
      const val = data[key];
      if (val !== undefined && val !== null) {
        storage.set(key as StorageKeys, val as never, { force: true });
      }
    });
    // Legacy vault migration
    const legacyVault = data.suez_vault;
    if (legacyVault !== undefined && legacyVault !== null && !data[StorageKeys.VAULT]) {
      storage.set(StorageKeys.VAULT, legacyVault as VaultDocument[], { force: true });
    }
    window.dispatchEvent(new Event('suez_data_updated'));
    syncImportedActiveOrgToSqlite();
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
};

// ── Vault Management ────────────────────────────────────────────────────────

export const getVaultDocuments = (): VaultDocument[] => {
  return storage.get<VaultDocument[]>(StorageKeys.VAULT) || [];
};

export const addVaultDocument = (doc: VaultDocument): void => {
  const vault = getVaultDocuments();
  storage.set(StorageKeys.VAULT, [doc, ...vault]);
};

export const setVaultDocuments = (docs: VaultDocument[]): void => {
  storage.set(StorageKeys.VAULT, docs);
};

// ── UI State Persistence ────────────────────────────────────────────────────

export const getUIState = <T>(key: StorageKeys, defaultValue: T): T => {
  const saved = storage.get<T>(key);
  return saved !== null ? saved : defaultValue;
};

export const setUIState = <T>(key: StorageKeys, value: T): void => {
  storage.set(key, value);
};

// ── Server SQLite reconciliation ────────────────────────────────────────────

/**
 * Replace in-browser ledger + revenue store with rows from GET /api/transactions (SQLite).
 * Call after a server-side Stripe import so the UI matches the database.
 */
export async function reloadLedgerFromSqlite(orgId?: string): Promise<boolean> {
  const oid = orgId ?? getActiveOrgId() ?? 'default';
  const page = await api.getTransactions({ orgId: oid, limit: 10000 });
  if (!page?.transactions) return false;
  setTransactions(page.transactions);
  // Revenue panel: Stripe + imported streams (e.g. Substack CSV / manual), not Stripe-only
  const revenueRelevant = page.transactions.filter(
    (t) => t.source === 'Stripe' || t.source === 'Substack',
  );
  const dates = revenueRelevant.map((t) => t.date);
  const oldest = dates.length
    ? dates.reduce((a, b) => (a < b ? a : b))
    : new Date().toISOString().split('T')[0];
  const end = new Date().toISOString().split('T')[0];
  setRevenueData(
    {
      transactions: revenueRelevant,
      lastSyncDate: new Date().toISOString(),
      startDate: oldest,
      endDate: end,
    },
    { force: true },
  );
  window.dispatchEvent(new Event('suez_data_updated'));
  return true;
}

/**
 * Nuclear option: empty localStorage, sessionStorage, FX hash cache, and server kv_store.
 * Domain tables (transactions in SQLite) are unchanged. Reload the app after calling.
 */
export function wipeAllBrowserStorageAndRemoteKv(): void {
  try {
    localStorage.clear();
  } catch { /* noop */ }
  try {
    sessionStorage.clear();
  } catch { /* noop */ }
  clearHashes();
  dbClear();
}

// Hook helper for React components to subscribe to storage changes
export const useStorageListener = (callback: (key: string) => void) => {
  const handleStorageUpdate = (event: CustomEvent<{ key: string }>) => {
    callback(event.detail.key);
  };

  return {
    subscribe: () => {
      window.addEventListener('suez_storage_updated', handleStorageUpdate as EventListener);
    },
    unsubscribe: () => {
      window.removeEventListener('suez_storage_updated', handleStorageUpdate as EventListener);
    },
  };
};
