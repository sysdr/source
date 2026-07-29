/**
 * Cross-jurisdiction retention policy (REQ-068).
 * Longest applicable period wins for purge decisions.
 */
export const RETENTION_YEARS = {
  india_gst_cgst36: 8,
  india_it_sec128: 6,
  us_irs_form5472: 7,
} as const;

/** Years from end of relevant tax year before purge may be considered. */
export function requiredRetentionYears(): number {
  return Math.max(...Object.values(RETENTION_YEARS));
}

/**
 * Whether a financial record may be purged.
 * `taxYearEnd` and `asOf` are ISO dates (YYYY-MM-DD).
 */
export function evaluatePurgeRisk(taxYearEnd: string, asOf: string): {
  allowed: boolean;
  yearsHeld: number;
  requiredYears: number;
  warning?: string;
} {
  const requiredYears = requiredRetentionYears();
  const end = new Date(`${taxYearEnd}T00:00:00`).getTime();
  const now = new Date(`${asOf}T00:00:00`).getTime();
  const yearsHeld = Math.floor((now - end) / (365.25 * 86_400_000));
  if (yearsHeld < requiredYears) {
    return {
      allowed: false,
      yearsHeld,
      requiredYears,
      warning: `Deletion blocked: retain ${requiredYears} years (India GST / US IRS). Held ${yearsHeld}y.`,
    };
  }
  return {
    allowed: true,
    yearsHeld,
    requiredYears,
    warning: 'Past retention floor — confirm archive exists before purge.',
  };
}
