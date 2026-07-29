import { describe, expect, it, beforeEach } from 'vitest';
import {
  _resetSloSamplesForTests,
  classifyHttpPath,
  recordSloSample,
  summarizeSlo,
  timeSloOperation,
} from './sloMetrics';
import { buildFilingReminderEmail, selectFilingReminders } from './filingReminders';
import { analyzeInvoiceWithFallback, heuristicInvoiceAnalysis } from './aiFallback';
import type { FilingTask } from '../types';

describe('sloMetrics (REQ-066 / T-036)', () => {
  beforeEach(() => _resetSloSamplesForTests());

  it('records samples and computes p95 vs target', async () => {
    for (let i = 0; i < 20; i++) {
      recordSloSample({ operation: 'ledger_query', durationMs: 100 + i * 10, ok: true });
    }
    const [summary] = summarizeSlo('ledger_query');
    expect(summary.count).toBe(20);
    expect(summary.p95Ms).toBeGreaterThan(0);
    expect(summary.targetMs).toBe(500);
  });

  it('times async operations', async () => {
    const result = await timeSloOperation('payroll_batch', async () => 42);
    expect(result).toBe(42);
    expect(summarizeSlo('payroll_batch')[0].count).toBe(1);
  });

  it('classifies HTTP paths to SLO buckets', () => {
    expect(classifyHttpPath('/api/transactions')).toBe('ledger_query');
    expect(classifyHttpPath('/api/payroll/run')).toBe('payroll_batch');
    expect(classifyHttpPath('/api/stripe/sqlite-sync')).toBe('stripe_sync');
  });
});

describe('filingReminders (REQ-051 / T-039)', () => {
  const task = (partial: Partial<FilingTask> & Pick<FilingTask, 'id' | 'type' | 'dueDate' | 'status'>): FilingTask => ({
    period: '2026-01',
    createdAt: '',
    updatedAt: '',
    ...partial,
  });

  it('selects overdue and due-soon filings', () => {
    const candidates = selectFilingReminders([
      task({ id: '1', type: 'GSTR-1', dueDate: '2026-01-01', status: 'Pending' }),
      task({ id: '2', type: 'GSTR-3B', dueDate: '2026-07-30', status: 'Pending' }),
      task({ id: '3', type: '24Q', dueDate: '2026-08-31', status: 'Filed', filedDate: '2026-08-01' }),
    ], '2026-07-28', 7);
    expect(candidates.some((c) => c.urgency === 'overdue')).toBe(true);
    expect(candidates.some((c) => c.task.id === '3')).toBe(false);
  });

  it('builds reminder email', () => {
    const candidates = selectFilingReminders([
      task({ id: '1', type: 'GSTR-1', dueDate: '2026-01-01', status: 'Pending' }),
    ], '2026-07-28');
    const mail = buildFilingReminderEmail({ orgName: 'Acme LLP', candidates });
    expect(mail?.subject).toMatch(/overdue/i);
    expect(mail?.text).toContain('GSTR-1');
  });
});

describe('aiFallback (REQ-052 / REQ-043 / T-040)', () => {
  it('heuristic detects missing GSTIN on foreign invoice', () => {
    const r = heuristicInvoiceAnalysis('Invoice for USD 500 consulting services to US client');
    expect(r.provider).toBe('heuristic');
    expect(r.missingElements?.length).toBeGreaterThan(0);
  });

  it('falls back gemini → claude → heuristic', async () => {
    const result = await analyzeInvoiceWithFallback('Simple domestic GST invoice GSTIN 27AAAAA0000A1Z5 INV-1', {
      gemini: async () => { throw new Error('gemini down'); },
      claude: async () => { throw new Error('claude down'); },
    });
    expect(result.provider).toBe('heuristic');
  });

  it('uses gemini when available', async () => {
    const result = await analyzeInvoiceWithFallback('text', {
      gemini: async () => ({ isCompliant: true, suggestedRemedy: 'ok', missingElements: [] }),
    });
    expect(result.provider).toBe('gemini');
    expect(result.isCompliant).toBe(true);
  });
});
