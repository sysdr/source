/**
 * Stripe webhook ingest pipeline (REQ-078).
 * Claim → normalize → upsert → mark processed (poison-event safe).
 */
import {
  claimStripeEvent,
  markStripeEventFailed,
  markStripeEventProcessed,
  upsertTransaction,
} from './db.js';
import { normalizeStripeObject } from './normalizeTransaction.js';
import { canonicalStripeTransactionId } from './stripeWebhookCrypto.js';

export const STRIPE_INGESTABLE_EVENTS = new Set([
  'charge.succeeded',
  'payment_intent.succeeded',
  'charge.refunded',
  'customer.subscription.updated',
]);

export type StripeWebhookEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
  account?: string;
};

export interface ProcessStripeWebhookResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

function subscriptionChargeRef(obj: Record<string, unknown>): Record<string, unknown> | null {
  // Prefer latest_invoice.charge / payment_intent when expanded; otherwise metadata-only ack.
  const latestInvoice = obj.latest_invoice;
  if (typeof latestInvoice === 'object' && latestInvoice) {
    const inv = latestInvoice as Record<string, unknown>;
    if (typeof inv.charge === 'string' || typeof inv.charge === 'object') {
      const charge = typeof inv.charge === 'object' ? (inv.charge as Record<string, unknown>) : { id: inv.charge };
      return { ...charge, customer: obj.customer ?? charge.customer, metadata: obj.metadata };
    }
    if (typeof inv.payment_intent === 'object' && inv.payment_intent) {
      return inv.payment_intent as Record<string, unknown>;
    }
  }
  if (typeof obj.id === 'string' && obj.id.startsWith('ch_')) return obj;
  return null;
}

export function processStripeWebhookEvent(params: {
  orgId: string;
  event: StripeWebhookEvent;
  idempotencyKey?: string | null;
  baseCurrency?: 'INR' | 'USD';
  accountId?: string | null;
}): ProcessStripeWebhookResult {
  const eventId = typeof params.event.id === 'string' ? params.event.id : '';
  const eventType = typeof params.event.type === 'string' ? params.event.type : '';
  if (!eventId || !eventType) {
    return { ok: false, status: 400, body: { error: 'event.id and event.type required' } };
  }

  const claim = claimStripeEvent({
    eventId,
    orgId: params.orgId,
    eventType,
    idempotencyKey: params.idempotencyKey,
    payload: params.event,
  });

  if (claim.status === 'duplicate') {
    return {
      ok: true,
      status: 200,
      body: { ok: true, duplicate: true, eventId },
    };
  }

  const ingestable = STRIPE_INGESTABLE_EVENTS.has(eventType);
  let normalizedId: string | undefined;
  let subscriptionAck = false;

  try {
    if (ingestable) {
      const obj = (params.event.data?.object || {}) as Record<string, unknown>;
      let target = obj;

      if (eventType === 'customer.subscription.updated') {
        const chargeLike = subscriptionChargeRef(obj);
        if (!chargeLike) {
          markStripeEventProcessed(eventId);
          return {
            ok: true,
            status: 200,
            body: {
              ok: true,
              duplicate: false,
              eventId,
              ingested: true,
              ledgerPosted: false,
              reason: 'subscription_metadata_only',
            },
          };
        }
        target = chargeLike;
        subscriptionAck = true;
      }

      const normalized = normalizeStripeObject(target, {
        webhookEventId: eventId,
        eventType,
        baseCurrency: params.baseCurrency === 'USD' ? 'USD' : 'INR',
        accountId: params.accountId || (typeof params.event.account === 'string' ? params.event.account : null),
      });
      if (!normalized.ok) {
        markStripeEventFailed(eventId, normalized.error);
        return {
          ok: false,
          status: 422,
          body: { error: normalized.error, eventId, eventType, retryable: true },
        };
      }
      const tx = {
        ...normalized.transaction,
        id: canonicalStripeTransactionId(String(normalized.transaction.stripeChargeId || normalized.transaction.id)),
      };
      upsertTransaction(params.orgId, tx);
      normalizedId = String(tx.id);
    }

    markStripeEventProcessed(eventId);
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        duplicate: false,
        eventId,
        ingested: ingestable,
        transactionId: normalizedId,
        subscriptionAck,
      },
    };
  } catch (err) {
    markStripeEventFailed(eventId, (err as Error).message);
    return {
      ok: false,
      status: 500,
      body: { error: (err as Error).message, eventId, retryable: true },
    };
  }
}
