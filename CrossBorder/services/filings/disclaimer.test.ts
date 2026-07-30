/** REQ-055 — filing disclaimer mutation coverage (RW-009c) */
import { describe, expect, it } from 'vitest';
import {
  FILING_DISCLAIMER,
  FILING_DISCLAIMER_META_KEY,
  disclaimerCommentLines,
  withDisclaimerMeta,
} from './disclaimer';

describe('filing disclaimer', () => {
  it('embeds the mandatory disclaimer text and review-only flag', () => {
    expect(FILING_DISCLAIMER.length).toBeGreaterThan(20);
    expect(FILING_DISCLAIMER_META_KEY).toBe('disclaimer');
    const wrapped = withDisclaimerMeta({ form: '24Q' });
    expect(wrapped.meta.disclaimer).toBe(FILING_DISCLAIMER);
    expect(wrapped.meta.forReviewOnly).toBe(true);
    expect(wrapped.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(wrapped.form).toBe('24Q');
  });

  it('formats comment lines for text exports', () => {
    const lines = disclaimerCommentLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`# DISCLAIMER: ${FILING_DISCLAIMER}`);
  });
});
