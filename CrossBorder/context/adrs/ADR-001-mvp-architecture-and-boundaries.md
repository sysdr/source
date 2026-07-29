# ADR-001: MVP Architecture and Boundaries

## Status
Accepted (Reworked)

## Context
Requirements now include all previously open gaps (`REQ-001` to `REQ-081`) and define explicit MVP scope: single-organization mode, high compliance correctness, and traceable exports.

## Decision
1. Keep MVP in single-organization mode with explicit UI disclosure.
2. Use `SQLite` as source of record and keep browser storage as cache only.
3. Use explicit modules aligned to requirement ownership:
   `Core`, `Onboarding`, `Dashboard`, `RevenueIngestion`, `Accounting`, `Payroll`,
   `TaxEngine`, `ComplianceHub`, `AP`, `Invoicing`, `TransferPricing`,
   `ForeignIncome`, `Auth`, `AIAssistant`, `Notifications`, `PlatformUX`, `DevOps`.
4. Prioritize filing correctness wave first: GSTR-1/3B, Form 24Q, Form 5472, then EPF ECR.
5. Defer direct GSTN API and direct Indian bank API; use manual acknowledgement + bank CSV upload in MVP.
6. Interpret "single-user MVP" as **single active write session**; allow read-only accountant sessions via invite link.

## Consequences
- Positive: clear requirement-to-module traceability and fewer orphan implementations.
- Positive: explicit write/read session policy unblocks auth + accountant collaboration design.
- Negative: no full automation for filings and no real-time India banking in MVP.
- Negative: manual filing acknowledgement creates operational burden.
- Follow-up: add requirement amendment clarifying `REQ-070` wording to match single-writer policy.
- Follow-up: revisit deferred integrations in a post-MVP ADR once auth + multi-user baseline is stable.
