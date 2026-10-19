import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerPage, MirrorAccount, MirrorCustomer } from '../../services/stripeMirrorClient';

const accounts: MirrorAccount[] = [
  { accountId: 'acct_AAA111', name: 'Acme Inc', kind: 'organisation', parentAccountId: null, lastSyncedAt: '2026-01-01T10:00:00.000Z', lastStatus: 'ok', lastError: null, counts: { customers: 2, subscriptions: 2, schedules: 0, charges: 3, products: 0 } },
  { accountId: 'acct_BBB222', name: 'Beta LLC', kind: 'organisation', parentAccountId: null, lastSyncedAt: null, lastStatus: 'failed', lastError: 'no access', counts: { customers: 0, subscriptions: 0, schedules: 0, charges: 0, products: 0 } },
];
const customer = (over: Partial<MirrorCustomer>): MirrorCustomer => ({
  accountId: 'acct_AAA111', accountName: 'Acme Inc', customerId: 'cus_1', name: 'Ada', email: 'ada@x.io', created: 1700000000,
  lifecycle: 'current', subscriptionStatuses: ['active'], scheduleStatuses: [], paymentCount: 2, paid: { usd: 6500 }, ...over,
});
const pageOf = (customers: MirrorCustomer[]): CustomerPage => ({
  customers, total: customers.length, lifecycleCounts: { all: customers.length, current: 1, future: 1, past: 0, none: 0 },
});

const api = vi.hoisted(() => ({
  accounts: vi.fn(), runs: vi.fn(), customers: vi.fn(), payments: vi.fn(), discover: vi.fn(), sync: vi.fn(), people: vi.fn(), person: vi.fn(),
}));
vi.mock('../../services/stripeMirrorClient', () => ({ stripeMirrorApi: api }));
vi.mock('../../services/apiClient', () => ({ getAccessRole: () => 'owner' }));
vi.mock('../../services/storageService', () => ({ getActiveOrgId: () => 'org-test' }));

import StripeMirrorDashboard from './index';

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.accounts.mockResolvedValue(accounts);
  api.runs.mockResolvedValue({ running: false, runs: [] });
  api.customers.mockResolvedValue(pageOf([customer({}), customer({ customerId: 'cus_2', name: 'Bo', email: 'bo@x.io', lifecycle: 'future', subscriptionStatuses: ['trialing'], paid: {}, paymentCount: 0 })]));
  api.payments.mockResolvedValue({
    payments: [{ id: 'ch_1', created: 1700000200, amount: 5000, amountRefunded: 500, currency: 'usd', status: 'succeeded', refunded: false, description: 'Pro plan', invoiceId: null, paymentMethodType: 'card', receiptUrl: null, failureMessage: null }],
    netPaid: { usd: 4500 },
  });
});

describe('StripeMirrorDashboard', () => {
  it('shows accounts, customers with lifecycle labels and per-lifecycle counts', async () => {
    render(<StripeMirrorDashboard />);
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getAllByText('Acme Inc').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta LLC').length).toBeGreaterThan(0);
    expect(screen.getByText('no access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /future \/ trial \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText('$65.00')).toBeInTheDocument();
  });

  it('filters by account id typed into the account filter', async () => {
    render(<StripeMirrorDashboard />);
    await screen.findByText('Ada');
    fireEvent.change(screen.getByLabelText('Filter by account id or name'), { target: { value: 'acct_BBB' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ account: 'acct_BBB' })));
  });

  it('filters by lifecycle tab', async () => {
    render(<StripeMirrorDashboard />);
    await screen.findByText('Ada');
    fireEvent.click(screen.getByRole('button', { name: /future \/ trial/i }));
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ lifecycle: 'future', offset: 0 })));
  });

  it('opens the payments panel for a customer with net-of-refund total', async () => {
    render(<StripeMirrorDashboard />);
    fireEvent.click(await screen.findByText('Ada'));
    expect(await screen.findByText('Pro plan')).toBeInTheDocument();
    expect(api.payments).toHaveBeenCalledWith('org-test', 'acct_AAA111', 'cus_1');
    expect(screen.getByText('−$5.00 refunded')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Close payments').parentElement as HTMLElement).getByText('$45.00')).toBeInTheDocument();
  });

  it('shows the discover prompt when no accounts exist and runs discovery', async () => {
    api.accounts.mockResolvedValue([]);
    api.customers.mockResolvedValue(pageOf([]));
    api.discover.mockResolvedValue({ discovered: 21, added: 21 });
    render(<StripeMirrorDashboard />);
    expect(await screen.findByText(/No accounts registered yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discover accounts' }));
    expect(await screen.findByText(/Discovered 21 accounts/)).toBeInTheDocument();
  });

  it('surfaces API errors', async () => {
    api.customers.mockRejectedValue(new Error('Stripe mirror disabled'));
    render(<StripeMirrorDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Stripe mirror disabled');
  });

  describe('customer profiles', () => {
    const person = { key: 'ada@x.io', email: 'ada@x.io', name: 'Ada', lifecycle: 'current' as const, accountCount: 2, liveSubscriptions: 1, paymentCount: 2, paid: { usd: 1500, eur: 800 } };
    const profile = {
      person,
      customers: [customer({}), customer({ accountId: 'acct_BBB222', accountName: 'Beta LLC', customerId: 'cus_b1' })],
      subscriptions: [
        { id: 'sub_b', accountId: 'acct_BBB222', accountName: 'Beta LLC', customerId: 'cus_b1', status: 'canceled', created: 200, trialEnd: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelAt: null, canceledAt: 300, endedAt: 300, items: [] },
        { id: 'sub_a', accountId: 'acct_AAA111', accountName: 'Acme Inc', customerId: 'cus_1', status: 'active', created: 100, trialEnd: null, currentPeriodEnd: 1700500000, cancelAtPeriodEnd: true, cancelAt: null, canceledAt: null, endedAt: null,
          items: [{ productName: 'Pro Course', nickname: null, unitAmount: 1500, currency: 'usd', interval: 'month', intervalCount: 1, quantity: 2 }] },
      ],
      payments: [
        { id: 'ch_b', accountId: 'acct_BBB222', accountName: 'Beta LLC', customerId: 'cus_b1', created: 1700000250, amount: 900, amountRefunded: 100, currency: 'eur', status: 'succeeded', refunded: false, description: 'Course B', invoiceId: null, paymentMethodType: 'card', receiptUrl: null, failureMessage: null },
        { id: 'ch_a', accountId: 'acct_AAA111', accountName: 'Acme Inc', customerId: 'cus_1', created: 1700000150, amount: 1500, amountRefunded: 0, currency: 'usd', status: 'succeeded', refunded: false, description: 'Course A', invoiceId: null, paymentMethodType: 'card', receiptUrl: null, failureMessage: null },
      ],
    };

    beforeEach(() => {
      api.people.mockResolvedValue({ people: [person], total: 1 });
      api.person.mockResolvedValue(profile);
    });

    it('shows all subscriptions and payments across accounts for a selected person', async () => {
      render(<StripeMirrorDashboard />);
      fireEvent.click(await screen.findByRole('button', { name: 'CUSTOMER PROFILES' }));
      fireEvent.click(await screen.findByText('Ada'));
      expect(await screen.findByText('Pro Course — $15.00 / month × 2')).toBeInTheDocument();
      expect(screen.getByText('cancels 2023-11-20')).toBeInTheDocument();
      expect(screen.getByText(/ended 1970-01-01/)).toBeInTheDocument();
      expect(screen.getByText('Course A')).toBeInTheDocument();
      expect(screen.getByText('Course B')).toBeInTheDocument();
      expect(api.person).toHaveBeenCalledWith('org-test', { email: 'ada@x.io' });
    });

    it('opens the profile from a customer row via Full profile', async () => {
      render(<StripeMirrorDashboard />);
      fireEvent.click(await screen.findByText('Ada'));
      fireEvent.click(await screen.findByRole('button', { name: 'Full profile' }));
      await waitFor(() => expect(api.person).toHaveBeenCalledWith('org-test', { email: 'ada@x.io' }));
      expect(await screen.findByText('Payment history (2)')).toBeInTheDocument();
    });

    it('searches profiles', async () => {
      render(<StripeMirrorDashboard />);
      fireEvent.click(await screen.findByRole('button', { name: 'CUSTOMER PROFILES' }));
      fireEvent.change(await screen.findByLabelText('Search customer profiles'), { target: { value: 'cus_b1' } });
      await waitFor(() => expect(api.people).toHaveBeenLastCalledWith('org-test', 'cus_b1', 50, 0));
    });
  });
});
