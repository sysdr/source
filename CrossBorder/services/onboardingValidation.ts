/**
 * Onboarding identifier validators (REQ-076).
 */
export type IdentifierKind = 'GSTIN' | 'PAN' | 'TAN' | 'EIN' | 'LLPIN';

export interface IdentifierValidation {
  ok: boolean;
  kind: IdentifierKind;
  message?: string;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/i;
const EIN_RE = /^\d{2}-\d{7}$/;
const LLPIN_RE = /^[A-Z]{3}-[0-9]{4}$/i;

export function validateIdentifier(kind: IdentifierKind, value: string): IdentifierValidation {
  const v = value.trim();
  if (!v) {
    return { ok: false, kind, message: `${kind} is required` };
  }
  switch (kind) {
    case 'GSTIN':
      return GSTIN_RE.test(v)
        ? { ok: true, kind }
        : { ok: false, kind, message: 'GSTIN must be 15 characters (state+PAN+entity+Z+check)' };
    case 'PAN':
      return PAN_RE.test(v)
        ? { ok: true, kind }
        : { ok: false, kind, message: 'PAN must match AAAAA9999A' };
    case 'TAN':
      return TAN_RE.test(v)
        ? { ok: true, kind }
        : { ok: false, kind, message: 'TAN must match AAAA99999A' };
    case 'EIN':
      return EIN_RE.test(v)
        ? { ok: true, kind }
        : { ok: false, kind, message: 'EIN must match XX-XXXXXXX' };
    case 'LLPIN':
      return LLPIN_RE.test(v)
        ? { ok: true, kind }
        : { ok: false, kind, message: 'LLPIN must match AAA-NNNN' };
    default:
      return { ok: false, kind, message: 'Unknown identifier kind' };
  }
}

export function canAdvanceOnboardingStep(fields: Partial<Record<IdentifierKind, string>>): {
  ok: boolean;
  errors: IdentifierValidation[];
} {
  const errors: IdentifierValidation[] = [];
  for (const [kind, value] of Object.entries(fields) as [IdentifierKind, string | undefined][]) {
    if (value === undefined) continue;
    const result = validateIdentifier(kind, value);
    if (!result.ok) errors.push(result);
  }
  return { ok: errors.length === 0, errors };
}
