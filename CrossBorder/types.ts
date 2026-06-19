
export enum ComplianceStatus {
  COMPLIANT = 'compliant',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

export enum RevenueCategory {
  EXPORT = 'Export Revenue (GST 0%)',
  DOMESTIC_MOR = 'Domestic Revenue (Tax Handled by MoR)',
  OIDAR_RISK = 'OIDAR GST Risk (18% Liability)'
}

export interface EntityProfile {
  name: string;
  type: string;
  taxId: string; // GSTIN or EIN
  pan?: string;
  tan?: string;
  llpin?: string;
  incorporationDate?: string;
  address?: string;
  city?: string;
  pin?: string;
  state: string;
  /** Two-digit GST state code (e.g. '27' for Maharashtra). Alias for state when numeric code is needed. */
  stateCode?: string;
  country?: 'IN' | 'US'; // Registration country for base currency
}

export interface PayrollConfig {
  pfEnabled: boolean;
  esiEnabled: boolean;
  ptState: string;
  standardWorkingDays: number;
}

export interface AccountingConfig {
  expenseCategories: string[];
  revenueChannels: string[];
  glAccounts?: GLAccount[];
}

export interface GLAccount {
  code: string;
  name: string;
  type: 'Income' | 'Expense' | 'Purchase' | 'Asset' | 'Liability' | 'Equity';
}

export interface CompanyProfile {
  projectName: string;
  baseCurrency: 'INR' | 'USD';
  parent: EntityProfile;
  subsidiary: EntityProfile;
  payroll: PayrollConfig;
  accounting: AccountingConfig;
}

export interface Employee {
  id: string;
  name: string;
  designation: string;
  ctc: number;
  doj: string;
  status: 'Active' | 'Inactive' | 'Onboarding' | 'Notice' | 'Exited' | 'Archived';
  email: string;
  documents: {
    pan: boolean;
    aadhaar: boolean;
    contract: boolean;
  };
  panNumber?: string;
  aadhaarNumber?: string;
  uan?: string;
  esiNumber?: string;
  bankAccountNumber?: string;
  bankIFSC?: string;
  bankName?: string;
  dateOfBirth?: string;
  gender?: 'Male' | 'Female' | 'Other';
  phone?: string;
  address?: string;
  fatherOrSpouseName?: string;
  employeeType?: 'Full-time' | 'Part-time' | 'Contract' | 'Intern';
  department?: string;
  reportingManager?: string;
  probationEndDate?: string;
  noticePeriodDays?: number;
  taxRegime?: 'new' | 'old';
  section80C?: number;
  section80D?: number;
  hraExemptionRent?: number;
  salaryRevisions?: SalaryRevision[];
}

export interface SalaryRevision {
  effectiveDate: string;
  previousCTC: number;
  newCTC: number;
  reason: string;
}

export interface SalarySlip {
  employeeId: string;
  month: string;
  year: number;
  basic: number;
  hra: number;
  allowance: number;
  epf: number;
  pt: number;
  tds: number;
  netPay: number;
  esiEmployee?: number;
  esiEmployer?: number;
  epfEmployer?: number;
  epsEmployer?: number;
  edliEmployer?: number;
  grossEarnings?: number;
  totalDeductions?: number;
  totalEmployerCost?: number;
  lopDays?: number;
  lopDeduction?: number;
  bonus?: number;
  reimbursements?: number;
  workingDays?: number;
  paidDays?: number;
}

export interface LeavePolicy {
  type: string;
  name: string;
  annualQuota: number;
  carryForward: boolean;
  maxCarryForward: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  appliedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface LeaveBalance {
  employeeId: string;
  year: number;
  balances: Record<string, { total: number; used: number; remaining: number }>;
}

export interface AttendanceRecord {
  employeeId: string;
  date: string;
  status: 'Present' | 'Absent' | 'Half-day' | 'WFH' | 'Holiday' | 'Leave';
  checkIn?: string;
  checkOut?: string;
  notes?: string;
}

export type EntityType = 'parent' | 'subsidiary';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number; // Always in base currency
  currency: 'USD' | 'INR'; // Base currency for this org
  source: 'Stripe' | 'LemonSqueezy' | 'Mercury' | 'IndianBank' | 'Manual' | 'Substack';
  category: string;
  classification?: RevenueCategory;
  status: 'Pending' | 'Completed' | 'Flagged' | 'Failed' | 'Refunded';
  type: 'Income' | 'Expense' | 'Purchase';
  entity?: EntityType; // Parent or subsidiary company
  gstImpact?: number;
  customerLocation?: string;
  /** Foreign income: customer country (ISO) */
  customerCountry?: string;
  /** Foreign income type for tax/reporting */
  incomeType?: ForeignIncomeType;
  /** Sourcing: IN or US for apportionment */
  sourcingCountry?: 'IN' | 'US';
  stripeAccountId?: string;
  stripeChargeId?: string;
  lastSyncedAt?: string;
  originalAmount?: number; // Original amount before FX conversion (net of refunds)
  originalCurrency?: string; // USD, INR, EUR, GBP, etc.
  fxRate?: number;
  fxRateDate?: string;
  /** Stripe/processor fee (commission) in base currency */
  feeAmount?: number;
  /** Net revenue after fees in base currency */
  netAmount?: number;
  archived?: boolean;
  archivedAt?: string;
  // ── Indian compliance fields ─────────────────────────────────────────────
  /** GST rate applied: 0 | 5 | 12 | 18 | 28 */
  gstRate?: number;
  /** false = Sec 17(5) blocked credit (ineligible ITC) */
  itcEligible?: boolean;
  /** Recipient GSTIN — used for GSTR-1 B2B routing (Table 4A) */
  recipientGstin?: string;
  /** TDS applicable on this expense/purchase */
  tdsApplicable?: boolean;
  /** TDS section e.g. '194C', '194J', '194H', '194I(a)', '194I(b)' */
  tdsSection?: string;
  /** TDS rate % */
  tdsRate?: number;
  /** TDS amount deducted */
  tdsAmount?: number;
  /** Free-text narration / business purpose (required for audit under Rule 6F) */
  narration?: string;
  // ── Soft delete / audit trail ────────────────────────────────────────────
  deleted?: boolean;
  deletedAt?: string;
  deletedReason?: string;
}

/** Fixed asset for depreciation tracking (IT Act §32 / Companies Act Schedule II) */
export interface FixedAsset {
  id: string;
  name: string;
  /** Computer | Furniture | Vehicle | PlantMachinery | Intangible | Other */
  category: string;
  purchaseDate: string;
  cost: number;
  /** IT Act WDV depreciation rate % */
  depreciationRate: number;
  /** Accumulated depreciation to date */
  accumulated: number;
  entity?: 'parent' | 'subsidiary';
  createdAt: string;
}

export interface PendingTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: 'USD' | 'INR';
  type: 'Income' | 'Expense' | 'Purchase';
  category: string;
  entity?: EntityType;
  requestedAt: string;
  source: 'Manual' | 'Agent';
}

/** When 'organisation', use Organisation API key + Stripe-Context. When 'standalone', use Stripe-Account header only (outside org). */
export type StripeAccountScope = 'organisation' | 'standalone';

export interface StripeConnectedAccount {
  id: string;
  name?: string;
  addedAt: string;
  /** How to authenticate when fetching this account: organisation (Stripe-Context) or standalone (Stripe-Account only). */
  scope?: StripeAccountScope;
  archived?: boolean;
  archivedAt?: string;
}

export interface VaultDocument {
  id: string;
  date: string;
  title: string;
  type: string;
  candidateName?: string;
  content: string;
}

export interface GSTReport {
  period: string;
  totalSales: number;
  totalItc: number;
  netLiability: number;
}

export interface PayrollRun {
  id: string;
  month: string;
  year: number;
  runAt: string;
  employeeCount: number;
  totalGross: number;
  totalStatutory: number;
  totalNet: number;
  totalEmployerCost: number;
  employeeSlips: PayrollRunSlip[];
}

export interface PayrollRunSlip {
  employeeId: string;
  employeeName: string;
  basic: number;
  hra: number;
  allowance: number;
  grossEarnings: number;
  epf: number;
  esiEmployee: number;
  pt: number;
  tds: number;
  totalDeductions: number;
  netPay: number;
  epfEmployer: number;
  epsEmployer: number;
  esiEmployer: number;
  lopDays: number;
  paidDays: number;
  workingDays: number;
}

// ─── Invoicing (O2C) ────────────────────────────────────────────────────────

export type InvoiceStatus = 'Draft' | 'Sent' | 'Viewed' | 'PartiallyPaid' | 'Paid' | 'Overdue' | 'Cancelled';

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  discountPct?: number;
  amount: number;
  currency: 'USD' | 'INR';
  taxRate?: number;
  taxAmount?: number;
  glAccountCode?: string;
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  customerCountry?: string;
  customerGstin?: string;
  shipToName?: string;
  shipToAddress?: string;
  shipToGstin?: string;
  placeOfSupply?: string;
  status: InvoiceStatus;
  currency: 'USD' | 'INR';
  subtotal: number;
  taxTotal: number;
  total: number;
  lines: InvoiceLine[];
  entity?: EntityType;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  paidAt?: string;
  transactionIds?: string[];
  isForeignIncome?: boolean;
  incomeType?: ForeignIncomeType;
  classification?: RevenueCategory;
}

export type ForeignIncomeType =
  | 'export_of_services'
  | 'export_of_goods'
  | 'oidar'
  | 'royalty'
  | 'interest'
  | 'fees_for_technical_services'
  | 'other';

// ─── Vendors & AP (P2P) ─────────────────────────────────────────────────────

export interface Vendor {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  country: string;
  gstin?: string;
  pan?: string;
  isNonResident: boolean;
  bankAccount?: string;
  bankIfsc?: string;
  bankName?: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

export type BillStatus = 'Draft' | 'Pending' | 'PartiallyPaid' | 'Paid' | 'Overdue' | 'Cancelled';

export interface BillLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  gstRate?: number;
  gstAmount?: number;
  glAccountCode?: string;
}

export interface Bill {
  id: string;
  vendorId: string;
  number: string;
  date: string;
  dueDate: string;
  status: BillStatus;
  currency: 'USD' | 'INR';
  subtotal: number;
  taxTotal: number;
  total: number;
  lines: BillLine[];
  entity?: EntityType;
  tdsSection?: string;
  tdsRate?: number;
  tdsAmount?: number;
  netPayable?: number;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  paymentRunId?: string;
  transactionId?: string;
}

export interface PaymentRunLine {
  billId: string;
  amountPaid: number;
  tdsDeducted: number;
  netAmount: number;
}

export interface PaymentRun {
  id: string;
  date: string;
  vendorId: string;
  currency: 'USD' | 'INR';
  lines: PaymentRunLine[];
  totalAmount: number;
  totalTds: number;
  totalNet: number;
  status: 'Draft' | 'Processed';
  transactionId?: string;
  createdAt: string;
}

// ─── Journal & R2R ──────────────────────────────────────────────────────────

export type JournalEntryStatus = 'Draft' | 'Posted' | 'Reversed';

export interface JournalEntryLine {
  id: string;
  glAccountCode: string;
  description?: string;
  debit: number;
  credit: number;
  currency: 'USD' | 'INR';
  entity?: EntityType;
}

export interface JournalEntry {
  id: string;
  number: string;
  date: string;
  period: string;
  description: string;
  lines: JournalEntryLine[];
  status: JournalEntryStatus;
  createdAt: string;
  createdBy?: string;
  postedAt?: string;
  reversedAt?: string;
  reversalOfId?: string;
}

export interface PeriodClose {
  id: string;
  period: string;
  closedAt: string;
  closedBy?: string;
  locked: boolean;
}

// ─── Foreign income & WHT ──────────────────────────────────────────────────

export interface TaxTreaty {
  id: string;
  countryCode: string;
  countryName: string;
  article: string;
  description: string;
  rate: number;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface WithholdingPayment {
  id: string;
  date: string;
  payeeId: string;
  payeeName: string;
  payeeCountry: string;
  amount: number;
  currency: 'USD' | 'INR';
  section: string;
  rate: number;
  withheldAmount: number;
  treatyUsed?: string;
  trcReference?: string;
  depositDate?: string;
  certificateNumber?: string;
  quarter?: string;
  financialYear?: string;
  createdAt: string;
}

export interface ForeignIncomeRecord {
  id: string;
  transactionId?: string;
  invoiceId?: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  customerCountry: string;
  incomeType: ForeignIncomeType;
  classification: RevenueCategory;
  sourcingCountry?: 'IN' | 'US';
  createdAt: string;
}

// ─── Tax computation (India) ────────────────────────────────────────────────

export interface TaxComputationLine {
  description: string;
  amount: number;
  addBack: boolean;
}

export interface TaxComputation {
  id: string;
  financialYear: string;
  bookProfit: number;
  lines: TaxComputationLine[];
  taxableIncome: number;
  taxRate: number;
  taxAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdvanceTaxInstallment {
  id: string;
  financialYear: string;
  installment: 1 | 2 | 3 | 4;
  dueDate: string;
  amount: number;
  paidAmount?: number;
  paidDate?: string;
}

// ─── US tax ────────────────────────────────────────────────────────────────

export interface USTaxDraft {
  id: string;
  formType: '1120' | '1065';
  taxYear: number;
  usRevenue: number;
  usExpenses: number;
  taxableIncome: number;
  federalRate: number;
  federalTax: number;
  stateName?: string;
  stateRate?: number;
  stateTax?: number;
  totalTax: number;
  createdAt: string;
}

export interface Contractor1099 {
  id: string;
  contractorName: string;
  tin?: string;
  address?: string;
  amount: number;
  taxYear: number;
  formType: '1099-NEC' | '1099-MISC';
  createdAt: string;
}

// ─── Compliance & filing ────────────────────────────────────────────────────

export type FilingTaskType =
  | 'GSTR-1' | 'GSTR-3B' | 'GSTR-9' | 'GSTR-9C'
  | '24Q' | '26Q' | '27Q'
  | 'ITR-5' | 'ITR-6' | 'ITR-7'
  | 'Form 5472' | 'Form 1120' | 'Form 1065'
  | 'Advance Tax' | 'FEMA'
  | 'GST LUT';

export type FilingTaskStatus = 'Pending' | 'InProgress' | 'Filed' | 'Overdue' | 'NotApplicable';

export interface FilingTask {
  id: string;
  type: FilingTaskType;
  period: string;
  dueDate: string;
  status: FilingTaskStatus;
  filedDate?: string;
  documentIds?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── FEMA / Remittance ─────────────────────────────────────────────────────

export type RemittanceDirection = 'Inward' | 'Outward';
export type RemittancePurpose = 'Export' | 'Software' | 'Royalty' | 'TransferPricing' | 'Dividend' | 'Other';

export interface RemittanceRecord {
  id: string;
  direction: RemittanceDirection;
  date: string;
  amount: number;
  currency: string;
  purpose: RemittancePurpose;
  reference?: string;
  customerOrVendorId?: string;
  softExNumber?: string;
  documentIds?: string[];
  createdAt: string;
}
