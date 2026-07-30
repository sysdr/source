/**
 * Client-side display masking for PII (REQ-027 / RW-P-002).
 * Does not decrypt — only formats strings already held in memory.
 */

export function maskDisplayValue(value?: string | null): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (!trimmed) return '—';
  if (trimmed.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}
