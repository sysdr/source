import { describe, expect, it } from 'vitest';
import {
  applyFilingAcknowledgement,
  getPortalLinkForFiling,
  validateFilingAcknowledgement,
} from './filingAcknowledgement';
import type { FilingTask } from '../types';

describe('filingAcknowledgement (REQ-080 / T-030)', () => {
  it('returns GSTN deep-link for GSTR filings', () => {
    const link = getPortalLinkForFiling('GSTR-1');
    expect(link?.url).toContain('gst.gov.in');
    expect(link?.label).toMatch(/GSTN/i);
  });

  it('requires acknowledgement number for GSTR when marking Filed', () => {
    const v = validateFilingAcknowledgement('GSTR-1', { filedDate: '2026-02-12' });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/Acknowledgement/i);
  });

  it('applies acknowledgement + evidence on valid input', () => {
    const task = {
      id: 't1',
      type: 'GSTR-3B',
      period: '2026-01',
      dueDate: '2026-02-20',
      status: 'Pending',
      createdAt: '',
      updatedAt: '',
    } as FilingTask;
    const { task: updated, validation } = applyFilingAcknowledgement(task, {
      acknowledgementNumber: 'AA270226123456A',
      filedDate: '2026-02-18',
      evidenceLinks: ['https://example.com/receipt.pdf'],
    });
    expect(validation.ok).toBe(true);
    expect(updated.status).toBe('Filed');
    expect(updated.acknowledgementNumber).toBe('AA270226123456A');
    expect(updated.evidenceLinks).toEqual(['https://example.com/receipt.pdf']);
  });

  it('allows Form 1120 without hard ack requirement but warns on missing evidence', () => {
    const v = validateFilingAcknowledgement('Form 1120', { filedDate: '2026-04-10' });
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w) => /evidence/i.test(w))).toBe(true);
  });
});
