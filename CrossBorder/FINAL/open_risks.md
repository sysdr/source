# Open risks (Gate 3 package)

Gate 3 **confirmed**. Local deploy is live; public cloud publish was not performed.

| ID | Risk | Status | Owner |
| --- | --- | --- | --- |
| RW-009b | People-scoped Stryker ≥80% | **done** (96.03%) | test-engineer |
| RW-009c | Payroll/TDS/disclaimer Stryker ≥80% | **done** (82.94%) | test-engineer |
| RW-009d | Expand Stryker to filings generators (GSTR/24Q/26Q/ECR schemas) | open / optional | test-engineer |
| F-013b | VoiceOver recording of full owner shell | open / optional | accessibility-engineer |
| RW-010 residual | External ZAP on dedicated staging | open / optional | security-auditor |
| STRIPE-deferred | Secrets manager (no browser `sk_*`); Connect OAuth; payout-object recon (REQ-058) | open / optional | integration-engineer |

**Stripe ADR-003 follow-ups done:** signed webhooks, claim/retry, canonical ids, legacy `ch_*`→`stripe_ch_*` migration, shared API version, `ff_stripe_server_sync` UI gate.

## Payroll-scoped Stryker (2026-07-30, RW-009c)

| File | Mutation score |
| --- | --- |
| `disclaimer.ts` | 100% |
| `tdsRules.ts` | 87.65% |
| `payrollCalculator.ts` | 80.67% |
| **All (payroll slice)** | **82.94%** |

Evidence: `mutation_report_payroll.json`. Config: `stryker.payroll.config.mjs`.
