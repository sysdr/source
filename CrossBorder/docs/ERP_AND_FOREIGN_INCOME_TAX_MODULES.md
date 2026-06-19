# CrossBorder ERP & Foreign Income / Tax – Module Analysis & Plan

This document analyses the current CrossBorder (Project Suez) codebase and outlines the **required modules for a complete ERP process** with **foreign income** and **tax** coverage.

---

## 1. Current State Summary

| Area | What Exists | Gaps |
|------|-------------|------|
| **Data** | localStorage, multi-org, `OrganisationRecord` | No real DB; no audit trail, no multi-user |
| **Revenue** | Stripe sync, FX (USD/INR), `RevenueCategory` (Export, Domestic MoR, OIDAR) | No LemonSqueezy/Mercury sync; no full invoice → revenue flow |
| **Accounting** | GL, Balance Sheet, P&L, entity-level P&E, manual transactions | No AR/AP, no proper journal entries, no period close |
| **Tax (India)** | GST (GSTR-1/3B drafts), TDS (24Q, 194T), Tax Engine (book profit, Sec 40(b)) | No TDS 26Q/27Q for non-salary; no advance tax; no income tax return prep |
| **Tax (US)** | Transfer pricing (US revenue/expenses/margin), 21% estimate, Form 5472 draft | No US income tax calc, no state tax, no 1120/1065 prep |
| **Payroll** | India: EPF, ESI, PT, TDS, slips, 24Q, ECR, ESI, PT, Form 16 | No US payroll; no contractor/1099 flow |
| **Compliance** | 5472 draft, GSTR-1 export, Tax Audit 44AB draft, bank file | No FEMA, no withholding on foreign payments, no DTAA tracking |
| **Invoicing** | AI "analyze invoice" for compliance | No full invoicing module (create, send, track, link to revenue) |

---

## 2. Required Modules for Complete ERP

A full ERP for cross-border (India–US) operations should cover **order-to-cash**, **procure-to-pay**, **record-to-report**, **foreign income & tax**, and **compliance**. Below is the module breakdown.

---

### 2.1 Core ERP Process Modules

| # | Module | Purpose | Current | Required Work |
|---|--------|---------|---------|----------------|
| **M1** | **Order-to-Cash (O2C)** | Quote → Order → Invoice → Payment → Revenue recognition | Partial (Stripe charges → revenue) | Add: Sales quotes/orders, **Invoicing** (create/send/track), payment application, revenue recognition rules (e.g. subscription vs one-time), linkage to GL and tax |
| **M2** | **Procure-to-Pay (P2P)** | Requisition → PO → Receipt → Vendor invoice → Payment | None | Add: Vendors, POs, goods/services receipt, **AP** (bills, payment runs), TDS on payments (194Q/194A/194J/194T), GST ITC tracking, linkage to GL |
| **M3** | **Record-to-Report (R2R)** | Ledger, journals, period close, reporting | Ledger + P&L + BS + entity P&E | Add: Proper **journal entries** (debit/credit), **AR/AP subledgers**, **period close** (lock dates), **trial balance**, **reconciliation** (bank, intercompany), multi-currency reval |
| **M4** | **Fixed Assets** | Acquisition, depreciation, disposal | None | Optional for MVP; add if you need asset register and depreciation in P&L |
| **M5** | **Inventory** | Stock, COGS, valuation | None | Optional for product businesses; skip for pure services |

For a **complete ERP process**, the critical additions are: **Invoicing**, **AP + vendors**, **Journal entries & period close**, and **reconciliation**.

---

### 2.2 Foreign Income Module

Foreign income is revenue from non-residents / foreign customers and must be classified for **tax** and **compliance** (GST export/OIDAR, US sourcing, withholding).

| # | Sub-module | Purpose | Current | Required Work |
|---|------------|---------|---------|----------------|
| **FI-1** | **Foreign income classification** | Tag income by source (country), type (service/goods/OIDAR), and customer residency | `RevenueCategory` + `customerLocation` on transactions | Extend: Explicit **foreign income** flag, **country of customer**, **income type** (export of services, OIDAR, royalty, interest, etc.), **sourcing rules** (US vs India) for each line |
| **FI-2** | **Withholding tax (WHT) on foreign payments** | Deduct and report withholding on payments to non-residents (India: 195/194E/194LB etc.; US: 1441/1442) | None | Add: **Payments to non-residents** (vendor/contractor), **WHT rate** by payment type & DTAA, **deposit & certificate** tracking, **26Q/27Q** for non-salary TDS including WHT |
| **FI-3** | **DTAA / treaty relief** | Apply treaty rates and document relief (e.g. TRC, Form 10F) | None | Add: **Treaty database** (country, article, rate), **TRC/Form 10F** storage, **WHT calculation** using treaty when applicable |
| **FI-4** | **Foreign currency & FX** | Consistent FX for income, expenses, and revaluation | Stripe sync + manual USD/INR rate, `originalAmount`/`originalCurrency`/`fxRate` | Extend: **FX rate source** (RBI, custom, daily), **realised vs unrealised** gain/loss, **multi-currency ledger** and period-end revaluation |
| **FI-5** | **Foreign income reporting** | Reports for tax and compliance | Export register (GSTR-1), 5472 draft | Add: **Foreign income schedule** (India ITR), **OIDAR summary**, **Form 5472** fully populated from transactions, **sourcing report** (US/state) |

---

### 2.3 Tax Modules (India + US)

| # | Sub-module | Purpose | Current | Required Work |
|---|------------|---------|---------|----------------|
| **TX-IN-1** | **GST** | Returns, ITC, export/OIDAR handling | GSTR-1/3B drafts, LUT/OIDAR in dashboard | Add: **GSTR-2B** reconciliation, **ITC reversal** logic, **OIDAR** 18% calc and return, **annual return** (GSTR-9/9C) draft |
| **TX-IN-2** | **TDS/TCS** | Deduction, deposit, certificates, returns | 24Q (salary), 194T (partner), Tax Engine | Add: **26Q** (non-salary), **27Q** (non-resident), **194Q/194A/194J** etc., **TDS certificate** generation, **TDS reconciliation** to books |
| **TX-IN-3** | **Income tax (company/LLP)** | Book profit, 40(b), advance tax, return prep | Tax Engine (book profit), 40(b)/194T in taxService | Add: **P&L to tax computation** (add-backs, 40A(3), 43B, etc.), **advance tax** schedule, **ITR-6/ITR-5** draft, **tax provisioning** |
| **TX-US-1** | **US federal & state** | Estimate and reporting | 21% on US profit (transfer pricing), 5472 draft | Add: **1120/1065** draft data, **state apportionment**, **estimated tax** (quarterly), **1099** for contractors |
| **TX-US-2** | **Transfer pricing** | Documentation and related-party reporting | US revenue/expenses/margin, 5472 CSV | Add: **TP documentation** (master file, local file), **intercompany invoicing** linked to P&L, **benchmarking** inputs |

---

### 2.4 Compliance & Regulatory

| # | Sub-module | Purpose | Current | Required Work |
|---|------------|---------|---------|----------------|
| **CO-1** | **FEMA / RBI** | Compliance for cross-border receipts/payments | None | Add: **Export declaration** (e.g. SOFTEX), **inward remittance** tracking, **outward remittance** (vendor/TP) documentation, **annual return** (if applicable) |
| **CO-2** | **Statutory filing orchestration** | Single place for due dates and status | Dashboard + Compliance Hub | Add: **Filing calendar** (GSTR, TDS, ITR, 5472, etc.), **status** (filed/pending), **document vault** per return |
| **CO-3** | **Audit & tax audit** | 44AB, tax audit report, lead schedule | 44AB draft mention | Add: **Lead schedules** from GL, **44AB** format, **audit trail** for adjustments |

---

## 3. Data Model Additions (High Level)

To support the above, the following **types/storage** additions are recommended:

- **Invoicing**: `Invoice`, `InvoiceLine`, `InvoiceStatus`, link to `Transaction` and customer.
- **Vendors & AP**: `Vendor`, `Bill` (vendor invoice), `PaymentRun`, link to `Transaction` and TDS/WHT.
- **Journal**: `JournalEntry`, `JournalEntryLine` (account, debit, credit, currency), period, status.
- **Foreign income / WHT**: Extend `Transaction` or add `ForeignIncomeRecord` with `customerCountry`, `incomeType`, `withholdingAmount`, `taxTreatyUsed`; add `WithholdingPayment` for deposits/certs.
- **Tax**: Extend `TaxEngineData` with `taxComputation`, `advanceTaxSchedule`, `provision`.
- **Compliance**: `FilingTask` (type, period, dueDate, status, documentIds).

---

## 4. Implementation Priority (Suggested)

**Phase 1 – Foundation (ERP core)**  
1. **Invoicing** (create, number, send, link to revenue).  
2. **Journal entries** and **period close** (lock dates, trial balance).  
3. **Vendors & AP** (bills, payment, TDS on payment).

**Phase 2 – Foreign income & WHT**  
4. **Foreign income classification** (customer country, income type, sourcing).  
5. **Withholding tax** on foreign payments (rates, DTAA, 26Q/27Q).  
6. **FX** (rate source, revaluation, realised/unrealised).

**Phase 3 – Tax & compliance**  
7. **TDS expansion** (26Q, 27Q, certificates, reconciliation).  
8. **Income tax** (tax computation, advance tax, ITR draft).  
9. **US tax** (1120/1065 draft, state, 1099).  
10. **FEMA/RBI** (export/import documentation, remittance tracking).  
11. **Filing calendar** and **compliance dashboard**.

---

## 5. Summary

- **Complete ERP process** needs: **O2C** (with full **invoicing**), **P2P** (vendors, AP, TDS), and **R2R** (journals, close, reconciliation).  
- **Foreign income** needs: classification, **withholding tax**, **DTAA**, **FX**, and **reporting** (ITR schedule, 5472, OIDAR).  
- **Tax** needs: extended **GST** (incl. OIDAR), full **TDS/TCS** (26Q/27Q, certs), **income tax** (computation, advance tax, ITR), **US** (1120/1065, state, 1099), and **TP** documentation.  
- **Compliance** needs: **FEMA/RBI** and a **filing calendar** with status and vault.

Implementing **Phase 1** first gives a solid ERP base; **Phase 2** makes foreign income and tax handling robust; **Phase 3** completes tax and compliance for India–US operations.
