# Project Suez - Cross-Border Financial OS
## Feature & Compliance Analysis Report

**Report Date:** February 1, 2026  
**Scope:** Complete codebase analysis of features, completeness, and compliance coverage

---

## Executive Summary

Project Suez is a financial operating system for Indian founders with US subsidiaries. The application has a solid foundational architecture with **8 primary modules**. Core revenue ingestion, accounting, and transfer pricing flows are functional. Several UI elements are non-functional placeholders, and key compliance exports produce generic placeholders rather than schema-compliant outputs.

---

## 1. COMPLETE FEATURES

| Module | Feature | Status | Notes |
|--------|---------|--------|-------|
| **Onboarding** | 5-step wizard | ✅ Complete | Project name, entities, payroll config, accounting config |
| **Onboarding** | Company profile persistence | ✅ Complete | Saved to localStorage |
| **Dashboard** | Global Wealth metrics | ✅ Complete | Income, expense, net wealth from transactions |
| **Dashboard** | Net Assets chart | ✅ Complete | Recharts AreaChart with mock progression |
| **Dashboard** | Compliance traffic lights | ✅ Complete | GST LUT, Form 5472, ODI, FIRC (hardcoded statuses) |
| **Revenue Ingestion** | Stripe API sync | ✅ Complete | Live mode with pagination, customer expansion |
| **Revenue Ingestion** | OIDAR/Export classification | ✅ Complete | Country-based classification (IN = OIDAR risk) |
| **Revenue Ingestion** | Mock data mode | ✅ Complete | Simulated transactions |
| **Revenue Ingestion** | Date range filter | ✅ Complete | Persisted |
| **Accounting** | General Ledger | ✅ Complete | Full CRUD for manual entries |
| **Accounting** | Balance Sheet view | ✅ Complete | Assets, liabilities, equity derived from ledger |
| **Accounting** | GST Center (GSTR-1, GSTR-3B) | ✅ Complete | ITC calculation, export buttons |
| **Accounting** | CSV export | ✅ Complete | Ledger, P&L, GST reports |
| **Payroll** | Employee directory | ✅ Complete | Add employees, persistent storage |
| **Payroll** | Salary slip download | ✅ Complete | Text file with Sec 194T logic |
| **Payroll** | EPF/TDS calculations | ✅ Complete | Slab-based TDS, PF on basic |
| **Transfer Pricing** | Calculator | ✅ Complete | US revenue, expenses, margin % |
| **Transfer Pricing** | Post to Ledger | ✅ Complete | Creates intercompany transaction |
| **Tax Engine** | Partner remuneration (Sec 40b) | ✅ Complete | 90%/60% formula, persisted |
| **Tax Engine** | TDS 194T display | ✅ Complete | 10% on partner payments |
| **Compliance Hub** | Digital Vault | ✅ Complete | Stores Admin-issued documents |
| **Compliance Hub** | Report download | ✅ Complete | Generates placeholder TXT (not form-specific) |
| **Admin Panel** | Document Issuer | ✅ Complete | Offer/Appointment/Experience/Relieving letters |
| **Admin Panel** | Document archiving | ✅ Complete | Saves to vault, downloadable |
| **AI Assistant** | Gemini compliance advice | ✅ Complete | Form 5472, GST, cross-border context |
| **AI Assistant** | Query history | ✅ Complete | Last 50 queries persisted |
| **Storage** | Persistent inputs | ✅ Complete | All modules save/restore state |

---

## 2. INCOMPLETE FEATURES

| Module | Feature | Gap | Priority |
|--------|---------|-----|----------|
| **Transfer Pricing** | Export PDF | Button has no `onClick` handler | Medium |
| **Payroll** | Run Payroll | Button does nothing; no batch processing | High |
| **Tax Engine** | Generate Form 26Q Data | Button has no `onClick` handler | High |
| **Payroll** | Form 24Q Export CSV | Button has no `onClick` handler | High |
| **Payroll** | PF ECR JSON Build | Disabled when PF off; no logic when on | Medium |
| **Admin Panel** | Update Platform Rules | Button has no handler; FX markup, audit threshold inputs don't persist | Medium |
| **Admin Panel** | Module Permissions | Toggle switches are decorative; no persistence or enforcement | Low |
| **Onboarding** | Add Revenue Channel | "+ Add Channel" has no `onClick` | Low |
| **Onboarding** | Add Expense Category | "+ Add Category" has no `onClick` | Low |
| **Compliance Hub** | Statutory Reports | Downloads generic TXT; not form-specific (24Q, 5472, GSTR) | High |
| **Compliance Hub** | Invite Accountant | Button has no `onClick` | Low |
| **Dashboard** | Compliance items | GST LUT, Form 5472, ODI, FIRC are hardcoded; no dynamic status | Medium |

---

## 3. MISSING FEATURES

| Category | Feature | Description |
|----------|---------|-------------|
| **Integrations** | LemonSqueezy | MoR mentioned for Indian subscribers; no API sync |
| **Integrations** | Mercury Bank | Source type exists; no bank feed or MT940 import |
| **Integrations** | Indian Bank | Source type exists; no integration |
| **Integrations** | Multi-source revenue | Only Stripe implemented for live sync |
| **FX** | Dynamic FX rates | Hardcoded 83.5; no rate source or date-specific rates |
| **Auth** | User authentication | No login; single-user, browser-only |
| **Documents** | E-sign / digital signature | Documents are plain text; no PKI/signing |
| **AI** | Invoice compliance analysis | `analyzeInvoice()` exists in `geminiService`; never called from UI |
| **Data** | Edit/delete transactions | Ledger is append-only; no edit/delete |
| **Data** | Edit/delete employees | Add only; no edit or deactivate |
| **Form 5472** | Filing preparation | No Form 5472 schema or transaction mapping |
| **FIRC** | Wire matching | "4 Wires pending" is static; no FIRC/wire matching logic |
| **ODI** | ODI tracking | "UIN Active & APR Filed" is static; no ODI register |

---

## 4. COMPLIANCE COVERAGE

### 4.1 India (CBDT / GST / Labour)

| Compliance | Coverage | Implementation |
|------------|----------|----------------|
| **GST LUT** | ✅ Referenced | Dashboard/compliance display; expiry hardcoded |
| **GSTR-1 (Export)** | ⚠️ Partial | Accounting shows Table 6A; export is generic CSV |
| **GSTR-3B** | ⚠️ Partial | ITC computed; "Generate Draft" produces generic CSV |
| **GST Offline Utility** | ❌ Missing | "Download Offline Utility JSON" exports CSV, not GST schema |
| **Form 24Q (TDS Salary)** | ⚠️ UI only | Button present; no CSV generation |
| **Sec 40(b) Partner Remuneration** | ✅ Implemented | Tax Engine calculates max deductible salary |
| **Sec 194T (Partner TDS)** | ✅ Implemented | 10% TDS logic in Payroll & Tax Engine |
| **EPF / PF ECR** | ⚠️ Partial | PF in salary calc; ECR JSON build not implemented |
| **ESI** | ⚠️ Config only | Payroll config supports it; no ESI calculation |
| **Professional Tax** | ✅ Implemented | PT by state in salary slip |

### 4.2 United States (IRS / FinCEN)

| Compliance | Coverage | Implementation |
|------------|----------|----------------|
| **Form 5472** | ⚠️ Referenced | AI context, Dashboard; no form generation |
| **Transfer Pricing (Arm's Length)** | ✅ Implemented | Calculator + intercompany invoice flow |

### 4.3 Cross-Border

| Compliance | Coverage | Implementation |
|------------|----------|----------------|
| **OIDAR GST** | ✅ Implemented | Revenue classification by customer location |
| **Export Revenue (0% GST)** | ✅ Implemented | Non-India customers classified as export |
| **ODI Reporting** | ⚠️ Display only | Hardcoded status; no UIN/APR logic |
| **FIRC Tracking** | ⚠️ Display only | "4 Wires pending" static; no wire matching |

---

## 5. PRIORITY RECOMMENDATIONS

### High Priority
1. **Form 24Q / Form 26Q CSV export** – Map employee TDS data to CSV for e-filing.
2. **Run Payroll** – Implement batch payroll run and update employee records.
3. **Compliance report generation** – Replace generic TXT with form-specific outputs (GSTR JSON, 24Q CSV, 5472 draft).

### Medium Priority
4. **Transfer Pricing Export PDF** – Generate intercompany invoice PDF.
5. **Admin Platform Rules persistence** – Save FX markup and audit threshold.
6. **Dynamic compliance status** – Derive GST LUT, Form 5472, FIRC status from data.

### Low Priority
7. **Onboarding Add Channel/Category** – Wire up add/remove for revenue channels and expense categories.
8. **Module Permissions** – Persist and enforce toggles.
9. **Invite Accountant** – Implement invite flow or remove.

---

## 6. TECHNICAL NOTES

- **Storage:** All primary inputs persist via `storageService.ts` (localStorage).
- **API Key:** Gemini uses `process.env.API_KEY`; ensure `.env.local` has `GEMINI_API_KEY` or equivalent.
- **Stripe:** Live mode requires `sk_live_` or `sk_test_` key; optional `acct_` for org context.
- **Unused code:** `analyzeInvoice()` in `geminiService.ts` is defined but not used.

---

*Report generated from static analysis of the CrossBorder codebase.*
