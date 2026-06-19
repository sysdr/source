# CrossBorder – ERP Perspective Analysis

**Scope:** Whole product from an ERP standpoint; Finance module; integration with Payroll & HR and other modules; Agentic Enterprise Architecture and workflows.  
**Outcome:** Gaps, must-haves, and incomplete areas.

---

## 1. Executive Summary

CrossBorder (Project Suez) is a **cross-border financial OS** for Indian founders with US subsidiaries: single SPA (Vite + React), **no backend** – all state in browser via `storageService` (localStorage + in-memory, org-scoped). From an **ERP perspective** it covers:

- **Finance & Accounting:** Unified ledger, balance sheet, GST center, P&E by entity.
- **Payroll & HR:** Directory, payroll run, statutory exports (24Q, PF ECR, ESI, PT, Form 16, bank file), leaves, attendance.
- **Revenue:** Stripe sync, OIDAR/export classification, merge into ledger.
- **Transfer pricing:** Calculator + post to ledger.
- **Tax:** Partner remuneration (40b), TDS 194T.
- **Agentic MAS:** Orchestrator, personas (operations, sales, hr, procurement, expense, finance, tax, compliance), tools with RBAC, audit trail.

**Critical gaps:** No formal P&L/period reporting, no edit-transaction, no AP/AR or chart of accounts, no multi-step workflows (P2P, O2C), no backend/API/auth, Compliance Hub reports are generic placeholders, and several agent tools are read-only with no write/approval flows.

---

## 2. Current Finance Module – What Exists

### 2.1 Accounting (Cloud Financial Books) – `components/Accounting.tsx`

| Capability | Status | Notes |
|------------|--------|-------|
| General Ledger | ✅ | CRUD: add, delete (soft-archive). **No edit.** |
| Balance Sheet | ✅ | Assets, liabilities, equity from ledger categories |
| GST Center | ✅ | GSTR-1 (Table 6A), GSTR-3B, ITC, export CSV |
| Ledger metrics | ✅ | Gross/net revenue, purchases & opex, gross profit, total ITC |
| CSV export | ✅ | Ledger/P&L/GST style report (single generic format) |
| Base currency | ✅ | INR/USD from profile; FX via `currencyService` |
| Dual-currency display | ✅ | `formatAmountDual`, `getAmountInBase` |

**Data:** `getTransactions`, `setTransactions`, `removeTransaction`, `getBaseCurrency`, `getUIState`/`setUIState`. Listens to `suez_data_updated`.

### 2.2 Finance (P&E) – `components/Finance.tsx`

| Capability | Status | Notes |
|------------|--------|-------|
| Purchase & Expense by entity | ✅ | Parent vs Subsidiary; manual entries |
| Add/delete entries | ✅ | Writes to same ledger via `addTransaction`/`removeTransaction` |
| Entity-scoped totals | ✅ | Parent total, Subsidiary total |
| Categories | ✅ | Fixed list (SaaS, Travel, Payroll, etc.) |

**Data:** Same `getTransactions`/`addTransaction`/`removeTransaction`; `getCompanyProfile`; `getBaseCurrency`, `getAmountInBase`. Listens to `suez_data_updated`.

### 2.3 Supporting Services

- **`currencyService.ts`:** Base currency, FX, `getAmountInBase`, `getGstImpactInBase`, `convertToBaseSync`. Manual USD/INR rate or fetched rate.
- **`types.ts`:** `Transaction`, `AccountingConfig`, `CompanyProfile`, `EntityType`, etc.

---

## 3. Finance ↔ Other Modules – Integration Today

### 3.1 Shared State (`storageService`)

Single source of truth: **OrganisationRecord** holds profile, transactions, employees, revenueData, transferPricing, taxEngine, payrollRuns, leaveRequests, leavePolicies, attendance, stripeOrgConfig, platformRules, modulePermissions, vault. All modules use exported getters/setters (e.g. `getTransactions`, `addTransaction`, `getEmployees`, `addPayrollRun`). **No REST API** – in-process only.

### 3.2 Data Flows

| From | To | How |
|------|-----|-----|
| Revenue Ingestion / Stripe Sync | Ledger | `mergeRevenueIntoTransactions(revenueTxns)` → `setTransactions` |
| Payroll Run | Ledger | `addTransaction(salaryTx)` + `addTransaction(statutoryTx)` per run |
| Transfer Pricing | Ledger | "Post to Ledger" builds intercompany tx → `setTransactions([newTx, ...])` |
| Agents | All modules | Tools call same `storageService` APIs (read-only plus `stripe_sync`) |

### 3.3 Events

- **`suez_data_updated`:** Global refresh. Fired by: RevenueIngestion, Payroll, AdminPanel, storageService (setCompanyProfile, setTransactions, addTransaction, setStripeOrgConfig, setActiveOrgId, importConfig), stripeSyncService. Listened by: Dashboard, BalanceOverview, SyncDataScreen, Finance, Accounting, ComplianceHub, InvestorPitch, App.
- **`suez_storage_updated`:** Granular key updates for `useStorageListener`.

### 3.4 Finance ↔ Payroll & HR

- **Payroll → Finance:** On "Run Payroll", Payroll creates:
  - One **salary** transaction per employee (net pay, category Payroll, source IndianBank).
  - One **statutory** transaction (EPF/ESI/PT/TDS total).
  Then `addPayrollRun(payrollRun)` and `suez_data_updated`. Accounting/Finance show these via `getTransactions()`.
- **HR (same Payroll.tsx):** Leaves, attendance, directory. No direct write into Finance; only payroll run does. Agents can `read_employees`, `read_payroll_runs`, `read_leave_*` – no tool to create payroll or post to ledger.

**Gap:** No reverse flow: Finance does not push budgets or cost centers into Payroll. No chart of accounts or GL codes; payroll posts to high-level categories only (Payroll, Statutory).

---

## 4. Agentic Enterprise Architecture – Current vs Needed

### 4.1 What Exists (from `AGENTIC_ARCHITECTURE.md` and code)

| Layer | Implementation |
|-------|----------------|
| **Orchestration** | `agents/orchestrator.ts` – single `runOrchestrator()`: user message → Gemini route → selected agents + optional tool → tool run (RBAC) → reply. One-shot, no graph. |
| **Memory** | Session turns (`session.ts`), org context (`context.ts`), audit log (`auditLog.ts` – last 50 runs in localStorage). |
| **Tools** | `definitions.ts` + `impl.ts`. Read-only: company_profile, transactions, employees, revenue_data, payroll_runs, transfer_pricing, tax_engine, platform_rules, vault_summary, leave_requests, leave_balances. Actions: `stripe_sync`, `fx_rate`, `tax_calculate` (stub), `compliance_advice`, `analyze_invoice`. |
| **Personas** | operations, sales, hr, procurement, expense, finance, tax, compliance. Orchestrator routes and runs tools on their behalf. |
| **RBAC** | Each tool has `allowedAgents`; only orchestrator + selected agents can call a tool. |
| **Audit** | `AuditStep[]` per run (agent, timestamp, summary, tool calls); persisted in audit log. |
| **HITL** | Doc says financial transfers / tax filings require human approval; `requiresHumanApproval` mentioned but **no workflow or UI** implementing it. |

### 4.2 Workflows – Documented vs Implemented

- **Documented:** Architecture says orchestrator can be extended with "graph-based, non-linear workflows (e.g. LangGraph-style)" and "Procure-to-Pay: HR → Finance → Procurement → Tax → Finance" using same tools and audit shape.
- **Implemented:** **None.** Flow is strictly: User → Orchestrator → Routing → (optional) one tool → Response. No DAG, no state machine, no multi-step P2P/O2C, no approval nodes.

### 4.3 Agent Tools vs ERP Needs

| Need | Tool / behaviour | Gap |
|------|-------------------|-----|
| Read ledger | `read_transactions` | ✅ |
| Read payroll | `read_payroll_runs`, `read_employees` | ✅ |
| Sync revenue | `stripe_sync` | ✅ |
| Tax calculation | `tax_calculate` | Stub only; no Avalara/Vertex |
| Add transaction | — | **Missing** – no tool to post to ledger |
| Run payroll | — | **Missing** – no tool to trigger payroll run |
| Approve expense/leave | — | **Missing** – no approval tools or HITL steps |
| Form 24Q / GSTR export | — | **Missing** – no tool to generate statutory files (UI only in Payroll/Accounting) |
| Budget check (Procurement) | — | **Missing** – no budget or COA; procurement persona has no real tool |

---

## 5. What’s Missing / Incomplete / Must-Have (ERP View)

### 5.1 Finance Module

| Item | Priority | Notes |
|------|----------|-------|
| **Edit transaction** | High | Ledger has add + delete (soft-archive); no in-place edit. Required for corrections and audit trail (e.g. reversal + new entry). |
| **Chart of accounts (COA) / GL codes** | High | No account hierarchy; categories are flat strings. Needed for proper P&L, balance sheet, and reporting. |
| **Formal P&L (Income Statement)** | High | Accounting shows gross revenue, purchases, gross profit in cards but no dedicated P&L report with period filter (month/quarter/year) or standard layout. |
| **Period closing / reporting periods** | Medium | No concept of period lock or FY/month close. All time is open. |
| **Accounts Payable (AP) / Receivable (AR)** | High | No vendor/customer ledgers, open invoices, or payment tracking. P&E and revenue are flat transactions only. |
| **Bank reconciliation** | Medium | No bank statement import (e.g. MT940) or matching to ledger. |
| **Multi-entity consolidation** | Medium | Parent/subsidiary exist in profile and P&E entity filter; no consolidation rules or elimination entries. |
| **Audit trail for ledger changes** | Medium | Soft-delete (archive) exists; no full history of who changed what and when (no backend/user identity). |

### 5.2 Payroll & HR Integration

| Item | Priority | Notes |
|------|----------|-------|
| **Cost center / GL code from Payroll** | Medium | Payroll posts to "Payroll" and "Statutory" only; no mapping to COA or cost center. |
| **Leave deduction in payroll** | Medium | LOP/attendance used in payroll calc; leave balance and payroll run are not fully reconciled in one workflow. |
| **Agent-triggered payroll run** | Low | No tool to run payroll or generate statutory files from assistant. |
| **Onboarding workflow** | Low | Personas mention "onboarding triggers"; no concrete workflow or tool. |

### 5.3 Compliance & Reporting

| Item | Priority | Notes |
|------|----------|-------|
| **Compliance Hub → real reports** | High | Compliance Hub "Statutory Reports" download **generic TXT** for all items. Form 24Q, PF ECR, Form 16, etc. are implemented in **Payroll** (Statutory tab); Compliance Hub should either call those or link to them, not placeholder TXT. |
| **GSTR JSON / GST offline utility** | High | Accounting exports CSV; GST portal needs schema-specific JSON. Not implemented. |
| **Form 5472** | High | Referenced in AI and dashboard; no form generation or transaction mapping. |
| **Form 26Q** | High | Tax Engine "Generate Form 26Q Data" has no handler. |
| **Dynamic compliance status** | Medium | GST LUT, Form 5472, ODI, FIRC on dashboard are hardcoded; should derive from data. |
| **FIRC / wire matching** | Medium | "4 Wires pending" is static; no wire-to-invoice matching. |
| **ODI register** | Medium | "UIN Active & APR Filed" is static; no ODI tracking. |

### 5.4 Integrations & Data

| Item | Priority | Notes |
|------|----------|-------|
| **LemonSqueezy** | Medium | MoR for Indian subscribers; source type exists, no API sync. |
| **Mercury / Indian Bank** | Medium | Source types exist; no bank feed or MT940. |
| **Multi-source revenue** | Medium | Only Stripe implemented for live sync. |
| **Dynamic FX** | Medium | Hardcoded/default rate; no date-specific or multi-currency rate source. |
| **Auth & multi-user** | High | No login; single-user, browser-only. Required for audit and RBAC in production. |
| **Backend API** | High | All logic and secrets in frontend; no server-side audit persistence or API-layer RBAC. |

### 5.5 Agentic & Workflows

| Item | Priority | Notes |
|------|----------|-------|
| **Multi-step workflows** | High | No P2P, O2C, or approval flows. Architecture doc describes them; none implemented. |
| **Write tools for Finance** | High | No `add_transaction`, `post_payroll`, or similar; agents cannot act on behalf of user. |
| **HITL / approval UI** | High | "Click to Approve" and `requiresHumanApproval` are not wired to any workflow or UI. |
| **Tax tool (real API)** | High | `tax_calculate` is stub; production needs Avalara/Vertex (or equivalent). |
| **Graph-based orchestrator** | Medium | LangGraph-style cycles and branching are not built; single-shot only. |
| **Invoice analysis in UI** | Low | `analyzeInvoice()` in geminiService exists but is not called from UI; only via agent tool. |

### 5.6 Admin & Config

| Item | Priority | Notes |
|------|----------|-------|
| **Platform rules persistence** | Medium | FX markup and audit threshold in Admin Panel don’t persist (buttons/handlers missing or not saving). |
| **Module permissions** | Low | Toggles are decorative; not persisted or enforced. |
| **Onboarding: Add Channel/Category** | Low | "+ Add Channel" and "+ Add Expense Category" have no `onClick`. |

---

## 6. Must-Have Summary (ERP)

1. **Finance:** Edit transaction; Chart of accounts / GL; formal P&L with period; AP/AR or clear path to them.  
2. **Integration:** Payroll → Finance is one-way (payroll posts to ledger); add COA/cost center mapping and ensure Compliance Hub uses real statutory outputs.  
3. **Compliance:** Replace Compliance Hub generic downloads with form-specific reports (or deep links to Payroll/Accounting); implement Form 5472 and Form 26Q; GST JSON for portal.  
4. **Agentic:** Add write tools (e.g. add_transaction, run_payroll) and at least one multi-step workflow with HITL; implement tax_calculate via real API.  
5. **Platform:** Auth, backend API, and server-side orchestrator/audit for security and compliance.

---

## 7. File Reference

| Area | Key files |
|------|-----------|
| Finance & Accounting | `components/Accounting.tsx`, `components/Finance.tsx`, `services/currencyService.ts`, `services/storageService.ts` |
| Payroll & HR | `components/Payroll.tsx`, `services/payrollCalculator.ts`, `services/statutoryReports.ts` |
| Agents & workflows | `AGENTIC_ARCHITECTURE.md`, `agents/orchestrator.ts`, `agents/personas.ts`, `agents/tools/definitions.ts`, `agents/tools/impl.ts`, `agents/memory/*` |
| Integration & storage | `services/storageService.ts`, `services/stripeSyncService.ts`, `App.tsx` (suez_data_updated) |
| Compliance | `components/ComplianceHub.tsx`, `components/Payroll.tsx` (Statutory tab), `components/Accounting.tsx` (GST) |

---

*Analysis generated from codebase exploration and existing AGENTIC_ARCHITECTURE.md and FEATURE_REPORT.md.*
