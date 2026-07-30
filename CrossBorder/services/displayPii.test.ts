/** REQ: REQ-027 / RW-P-002 */
import { describe, expect, it } from 'vitest';
import { maskDisplayValue } from './displayPii';

describe('maskDisplayValue', () => {
  it('masks long identifiers keeping last 4', () => {
    expect(maskDisplayValue('ABCDE1234F')).toBe(`${'•'.repeat(6)}234F`);
    expect(maskDisplayValue('123456789012')).toBe(`${'•'.repeat(8)}9012`);
  });

  it('handles empty and short values', () => {
    expect(maskDisplayValue('')).toBe('—');
    expect(maskDisplayValue(null)).toBe('—');
    expect(maskDisplayValue('AB')).toBe('••••');
  });
});
