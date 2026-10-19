# ADR-004: Stripe mirror (accounts, customers, payments)

**Status:** proposed — not Gate-reviewed
**Date:** 2026-10-19
**Deciders:** human (request), implementing agent
**Requirements:** none assigned yet (no REQ-NNN exists for this feature — see Open items)

## Context

Admins need one dashboard over every Stripe account in the organisation: all accounts, all customers (past, current, future/trial), each customer's payments, filterable by account id. `ADR-003` ingestion maps charges to ledger transactions (converted currency, derived status) and its default sync purges `source='Stripe'` rows before fetching, so it is neither a faithful mirror nor safe to re-run.

## Decision

1. **Separate, additive store.** Tables, in their own git-ignored file `data/stripe-mirror.db` (customer PII must not enter the tracked `data/suez.db` snapshot): `stripe_mirror_objects` (verbatim Stripe JSON in `raw`, plus index columns), `stripe_mirror_accounts`, `stripe_mirror_runs`. The ledger (`transactions`) is untouched.
2. **Mirror = list-and-reconcile.** Per account and resource (customers, subscriptions with `status=all`, subscription schedules, charges) list the complete set, upsert, then tombstone (`deleted_at`) rows not returned. Tombstoning only runs after a complete listing; any Stripe error aborts that account with no deletions.
3. **Verification, not assertion.** Each resource sync checks stored-live count equals unique fetched count (charges also the amount sum); mismatches mark the account `failed`.
4. **Lifecycle is derived, not stored** (`lifecycle.ts`): current > future (trialing or `not_started` schedule) > past (ended subscription or succeeded charge) > none.
5. **Server-side credentials only.** The org key is read from `suez_stripe_org_config`; it never goes to the browser. Mirror GETs are blocked for `employee`; POSTs are owner-only.
6. **Flag:** `FF_STRIPE_MIRROR` (server; on unless `'false'`).

## Alternatives Considered

| Option | Why not |
| --- | --- |
| Extend `syncStripeToSqlite` / `transactions` | Lossy (FX-converted, derived status), no customers/subscriptions, purge-before-fetch can lose data. |
| Webhook-only mirror | Cannot backfill history or detect deletions; webhooks can be missed. Planned as an incremental layer on top, not a replacement. |
| Live-proxy Stripe per page view | Slow across 21+ accounts, rate-limited, no historical/offline view. |

## Consequences / known limits

- Objects created while a listing runs may be missed until the next sync; webhook-driven incremental updates are not implemented (follow-up).
- Customers deleted in Stripe are detected only by absence from the next full listing.
- Lifecycle rules (current > future > past > none; `paused` counts as current, `incomplete` is ignored) were confirmed by the user on 2026-10-19 after the first full sync (25 accounts, 1,336 customers).
- Discovery for org keys falls back to previously known accounts if the Sigma probe fails; it does not report that it fell back.
- Charges only: PaymentIntents without a charge, and standalone refunds/disputes, are not mirrored.

## Open items (Rule 15)

Needs a REQ id and a flag artifact in `context/feature_flags/`. Lifecycle definitions: resolved (see above).
