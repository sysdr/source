/** REQ-055 — mandatory disclaimer on every filing-ready export */
export const FILING_DISCLAIMER =
  'This data is generated for review purposes. The user is solely responsible for verifying accuracy before submission to any regulatory authority.';

export const FILING_DISCLAIMER_META_KEY = 'disclaimer';

export function withDisclaimerMeta<T extends Record<string, unknown>>(payload: T): T & {
  meta: { disclaimer: string; generatedAt: string; forReviewOnly: true };
} {
  return {
    ...payload,
    meta: {
      disclaimer: FILING_DISCLAIMER,
      generatedAt: new Date().toISOString(),
      forReviewOnly: true,
    },
  };
}

export function disclaimerCommentLines(): string[] {
  return [`# DISCLAIMER: ${FILING_DISCLAIMER}`];
}
