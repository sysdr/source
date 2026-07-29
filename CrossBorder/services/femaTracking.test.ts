import { describe, expect, it } from 'vitest';
import type { OdiProfile, RemittanceRecord, Transaction } from '../types';
import {
  buildFemaTrackingReport,
  buildFircStatusReport,
  buildOdiStatusReport,
  deriveFircStatus,
  suggestFircMatches,
} from './femaTracking';

function rem(partial: Partial<RemittanceRecord> & Pick<RemittanceRecord, 'id' | 'direction' | 'amount' | 'date'>): RemittanceRecord {
  return {
    currency: 'USD',
    purpose: 'Export',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function tx(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'amount'>): Transaction {
  return {
    description: 'Wire credit',
    currency: 'INR',
    source: 'IndianBank',
    category: 'Revenue',
    status: 'Completed',
    type: 'Income',
    ...partial,
  } as Transaction;
}

describe('femaTracking (REQ-018 / REQ-019 / REQ-039 / T-031)', () => {
  it('derives Pending FIRC until number or match exists', () => {
    expect(deriveFircStatus(rem({ id: 'r1', direction: 'Inward', amount: 1000, date: '2026-01-10' }))).toBe('Pending');
    expect(deriveFircStatus(rem({
      id: 'r2', direction: 'Inward', amount: 1000, date: '2026-01-10', fircNumber: 'FIRC-1',
    }))).toBe('Received');
    expect(deriveFircStatus(rem({ id: 'r3', direction: 'Outward', amount: 500, date: '2026-01-10' }))).toBe('NotRequired');
  });

  it('suggests bank credit match within amount/date tolerance', () => {
    const remittances = [rem({ id: 'r1', direction: 'Inward', amount: 10000, date: '2026-03-01' })];
    const transactions = [
      tx({ id: 't1', date: '2026-03-05', amount: 10050, originalAmount: 10050 }),
      tx({ id: 't2', date: '2026-03-20', amount: 5000 }),
    ];
    const matches = suggestFircMatches(remittances, transactions);
    expect(matches).toHaveLength(1);
    expect(matches[0].transactionId).toBe('t1');
    expect(matches[0].score).toBeGreaterThan(0.5);
  });

  it('builds FIRC report with pending + unmatched credits', () => {
    const report = buildFircStatusReport({
      remittances: [
        rem({ id: 'r1', direction: 'Inward', amount: 2000, date: '2026-02-01' }),
        rem({ id: 'r2', direction: 'Inward', amount: 3000, date: '2026-02-10', fircNumber: 'F-9', fircStatus: 'Received' }),
      ],
      transactions: [tx({ id: 'orphan', date: '2026-02-15', amount: 999 })],
    });
    expect(report.summary.inwardTotal).toBe(2);
    expect(report.summary.pendingFirc).toBe(1);
    expect(report.summary.receivedFirc).toBeGreaterThanOrEqual(1);
    expect(report.unmatchedCredits.some((c) => c.transactionId === 'orphan')).toBe(true);
  });

  it('flags ODI APR overdue from profile due date', () => {
    const profile: OdiProfile = {
      uin: 'UIN123456',
      nextAprDueDate: '2026-01-15',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const odi = buildOdiStatusReport({ profile, filingTasks: [], asOfDate: '2026-03-01' });
    expect(odi.uinConfigured).toBe(true);
    expect(odi.aprStatus).toBe('overdue');
    expect(odi.message).toMatch(/overdue/i);
  });

  it('combines FIRC + ODI into FEMA tracking report', () => {
    const report = buildFemaTrackingReport({
      remittances: [rem({ id: 'r1', direction: 'Inward', amount: 100, date: '2026-01-01' })],
      transactions: [],
      odiProfile: { uin: 'U1', nextAprDueDate: '2026-12-31', updatedAt: '' },
      filingTasks: [],
      asOfDate: '2026-06-01',
    });
    expect(report.firc.summary.inwardTotal).toBe(1);
    expect(report.odi.uinConfigured).toBe(true);
    expect(report.odi.aprStatus).toBe('unknown');
  });
});
