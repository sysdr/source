import type { CustomerLifecycle } from './types.js';

/** Subscription states in which the customer is a live subscriber. */
const CURRENT_STATUSES = new Set(['active', 'past_due', 'unpaid', 'paused']);
/** Subscription states proving the customer once subscribed but no longer does. */
const ENDED_STATUSES = new Set(['canceled', 'incomplete_expired']);
const TRIAL_STATUS = 'trialing';
const SCHEDULE_NOT_STARTED = 'not_started';

export interface LifecycleInput {
  subscriptionStatuses: string[];
  scheduleStatuses: string[];
  hasSucceededCharge: boolean;
}

/**
 * current — has a live subscription.
 * future  — no live subscription, but a trial is running or a schedule has not started yet.
 * past    — neither, but previously subscribed or paid.
 * none    — no billing activity at all.
 * Precedence is current > future > past > none.
 */
export function classifyCustomer(input: LifecycleInput): CustomerLifecycle {
  const subs = input.subscriptionStatuses;
  if (subs.some((s) => CURRENT_STATUSES.has(s))) return 'current';
  if (subs.includes(TRIAL_STATUS) || input.scheduleStatuses.includes(SCHEDULE_NOT_STARTED)) return 'future';
  if (subs.some((s) => ENDED_STATUSES.has(s)) || input.hasSucceededCharge) return 'past';
  return 'none';
}
