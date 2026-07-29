import { describe, expect, it } from 'vitest';
import type { GLAccount, JournalEntry } from '../types';
import {
  TALLY_VOUCHER_HEADERS,
  buildTallyVoucherRows,
  generateTallyExport,
} from './tallyExport';

const chart: GLAccount[] = [
  { code: '1000', name: 'Bank/Cash', type: 'Asset' },
  { code: '4000', name: 'Revenue', type: 'Income' },
];

describe('tallyExport (REQ-081 / T-027)', () => {
  it('emits voucher CSV with required headers and ledger names', () => {
    const entries: JournalEntry[] = [{
      id: 'je-1',
      number: 'JE-25-0001',
      date: '2025-06-15',
      period: '2025-06',
      description: 'Sales receipt',
      status: 'Posted',
      createdAt: '2025-06-15T00:00:00.000Z',
      postedAt: '2025-06-15T00:00:00.000Z',
      lines: [
        { id: 'l1', glAccountCode: '1000', debit: 1000, credit: 0, currency: 'INR' },
        { id: 'l2', glAccountCode: '4000', debit: 0, credit: 1000, currency: 'INR' },
      ],
    }];

    const exportResult = generateTallyExport({ entries, chart, period: '2025-06' });
    expect(exportResult.voucherRowCount).toBe(2);
    expect(exportResult.vouchersCsv.split('\n')[0]).toBe(TALLY_VOUCHER_HEADERS.join(','));
    expect(exportResult.vouchersCsv).toContain('Bank/Cash');
    expect(exportResult.vouchersCsv).toContain('Revenue');
    expect(exportResult.trialBalanceCsv).toContain('Ledger Name');
    expect(exportResult.trialBalanceCsv).toContain('Bank/Cash');

    const rows = buildTallyVoucherRows(entries, chart);
    expect(rows[0].voucherType).toBe('Receipt');
  });
});
