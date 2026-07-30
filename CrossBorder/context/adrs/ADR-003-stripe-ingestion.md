# ADR-003: Stripe ingestion hardening

**Status:** accepted
**Date:** 2026-07-30
**Deciders:** system-architect, security-architect, human (Gate 3 context)
**Requirements:** REQ-044, REQ-078, REQ-077, REQ-066, REQ-006

## Context

Project Suez had a dual Stripe path (browser pull + server sqlite-sync + unauthenticated JSON webhook shim). Secrets lived in the browser; webhook events were forgeable; browser ledger ids (`ch_*`) diverged from server/webhook ids (`stripe_ch_*`); failed normalize after event insert created poison events.

## Decision

1. **Ingestion:** Server-signed webhooks for incremental updates; server pull (`/api/stripe/sqlite-sync`) for backfill. Browser pull retained for local UX but writes **canonical** `stripe_<chargeId>` ids.
2. **Authenticity:** When `STRIPE_WEBHOOK_SECRET` is set, require `Stripe-Signature` HMAC (timing-safe). Legacy JSON `{orgId,event}` shim requires `X-API-Key` when `SUEZ_API_KEY` is set; otherwise local/non-production only.
3. **Idempotency:** Claim event with `processed_at=NULL`; mark processed only after successful ledger upsert; failed normalize leaves retryable state (`process_error`).
4. **Events (REQ-078):** `payment_intent.succeeded`, `charge.succeeded`, `charge.refunded`, `customer.subscription.updated` (metadata-only ack if no charge ref).
5. **Flags:** `FF_STRIPE_WEBHOOK_INGEST` / client `ff_stripe_webhook_ingest`; `ff_stripe_server_sync`.

## Alternatives Considered

| Option | Why not |
| --- | --- |
| Browser-only pull | Secrets in client; no real-time |
| Webhooks only | Backfill gaps |
| Keep dual ledger ids | Permanent reconciliation bugs |
| Mark processed on insert | Poison events (observed) |
| Stripe Node SDK required | Adds dependency; HMAC without SDK is sufficient for verify |

## Consequences

Positive: forge-resistant webhooks, convergent ids, retryable failures, REQ-078 coverage.
Negative: operators must configure `STRIPE_WEBHOOK_SECRET`; legacy tests need API key when `SUEZ_API_KEY` set.
Deferred: secrets manager (no browser `sk_*`), Connect OAuth, payout-object reconciliation (REQ-058).

## Verification

- Unit: `server/stripeWebhookCrypto.test.ts`
- Integration: signed webhook + legacy auth + subscription ack in `server/index.test.ts`
- Signal of wrong: unsigned forged event accepted when secret configured; duplicate poison blocks retry
