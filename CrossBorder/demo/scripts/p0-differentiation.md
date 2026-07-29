# P0 Differentiation Demo Script (REQ-001 / REQ-005 / T-042)

Demonstrates the three Gate-review differentiators vs Zoho Books + CA:

1. **Cross-entity consolidated view** in one screen  
2. **Auto-classification** of OIDAR / export / domestic from Stripe metadata  
3. **Filing-ready** GSTN/Traces-schema exports (not manual reformatting)

## Prerequisites

```bash
npm run seed:db
npm run server   # :3001
npm run dev      # :5173
```

Open the seeded org. Use viewports 1280 / 768 / 375.

---

## Flow A — Consolidated dashboard (differentiator a)

| Step | Action | Expected | REQ |
|------|--------|----------|-----|
| A1 | Open **Dashboard** | Parent LLP + US entity names visible; KPIs (cash/revenue/net wealth) in one view | REQ-001 / REQ-053 |
| A2 | Check compliance traffic lights | GST LUT / Form 5472 / ODI·FEMA / Pending derived from data (not hardcoded green) | REQ-002 / REQ-041 |
| A3 | Resize to 375px | Mobile notice; KPIs stack; nav via hamburger | REQ-074 |
| A4 | Confirm Net Wealth subtitle | Shows combined US & India assets | REQ-001 |

**Pass if:** one screen shows both entities + live compliance statuses.

---

## Flow B — OIDAR / Export classification (differentiator b)

| Step | Action | Expected | REQ |
|------|--------|----------|-----|
| B1 | Open **Data Sync** / revenue after Stripe seed | Transactions show classification Export / OIDAR / Domestic | REQ-006 / REQ-044 |
| B2 | Open **Foreign Income → Remittances** | FIRC pending/matched counts from bank match engine | REQ-018 |
| B3 | Note a foreign-currency income row | Original currency + base amount present | REQ-061 / REQ-034 |

**Pass if:** at least one Export and one Domestic (or OIDAR) class appears without manual tagging.

---

## Flow C — Filing-ready export (differentiator c)

| Step | Action | Expected | REQ |
|------|--------|----------|-----|
| C1 | Open **Compliance Hub** | Due/ready/blocked filings visible; acknowledge disclaimer | REQ-004 / REQ-036 / REQ-055 |
| C2 | Download **GSTR-1** (or 24Q / 26Q / 5472) | JSON/CSV downloads; schema-validated | REQ-007 / REQ-008 / REQ-009 / REQ-010 / REQ-014 / REQ-029 / REQ-038 |
| C3 | Open **Filing Calendar** → mark Filed | ARN required for GSTR; GSTN portal deep-link shown | REQ-080 |
| C4 | (Optional) **Check invoice compliance (AI)** | Gemini→Claude→heuristic analysis returns structured result | REQ-043 / REQ-052 |

**Pass if:** export opens in a text editor as portal-shaped data; ack flow blocks Filed without ARN.

---

## Flow D — Payroll + access (P0 ops)

| Step | Action | Expected | REQ |
|------|--------|----------|-----|
| D1 | **Payroll → Run** on desktop | Pre-validation; outputs bundle (payslips / 24Q / PF / NEFT) | REQ-011 / REQ-035 |
| D2 | Invite accountant (72h link) | Read-only banner; writes return 403 | REQ-072 / REQ-073 |
| D3 | Onboarding Legal step with bad GSTIN | Inline error; Continue blocked until fixed | REQ-076 |

---

## Flow E — Security & ledger foundations (P0 infra)

| Step | Action | Expected | REQ |
|------|--------|----------|-----|
| E1 | Create/edit employee with PAN/Aadhaar | Stored encrypted; list shows masked last-4 unless reveal | REQ-026 / REQ-027 |
| E2 | Mutate a transaction | Audit log entry with actor + timestamp | REQ-005 / REQ-030 |
| E3 | Restart app / rehydrate | Ledger matches SQLite SoR (not only browser cache) | REQ-028 |
| E4 | Open **Journal** → post balanced entry | Double-entry; period lock blocks posts when closed | REQ-015 / REQ-059 / REQ-060 |
| E5 | Note single-writer / single-org banner | Concurrent writer conflict or accountant read-only | REQ-053 / REQ-070 |
| E6 | CI / `npm run audit:deps` | High CVEs fail the build | REQ-071 |
| E7 | Filing export meta | Schema tables labeled (GSTR/24Q formats) | REQ-048 / REQ-049 |
| E8 | Deferred filings cards | Explicit Coming Soon (not silent empty) | REQ-054 |

---

## Failure-path spot checks

| Path | Expected | REQ |
|------|----------|-----|
| Mobile payroll **Run** | Desktop-only notice; list still readable | REQ-074 |
| Stripe sync error | Banner with remediation (no stack trace) | REQ-075 |
| Accountant invite link | Read-only banner; writes return 403 | REQ-072 |
| Purge / clear financial data | Retention warning references 8-year floor | REQ-068 |

---

## Recording checklist

- [ ] Flow A screenshots @ 1280 and 375  
- [ ] Flow B classification evidence  
- [ ] Flow C export file + filing ack UI  
- [ ] Flow D payroll + accountant invite  
- [ ] Time-to-complete each flow noted in `demo/demo_report.json` after run  
