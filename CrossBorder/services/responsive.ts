/**
 * Viewport helpers for responsive UX (REQ-074 / T-034).
 * Interactive data entry is desktop-only (≥768px); mobile is read-only.
 */

export const MOBILE_MAX_WIDTH = 767;
export const TABLET_MAX_WIDTH = 1024;

export type ViewportBand = 'mobile' | 'tablet' | 'desktop';

export function classifyViewportWidth(width: number): ViewportBand {
  if (width <= MOBILE_MAX_WIDTH) return 'mobile';
  if (width <= TABLET_MAX_WIDTH) return 'tablet';
  return 'desktop';
}

/** Payroll run / journal entry mutations require desktop. */
export function allowsDesktopDataEntry(width: number): boolean {
  return classifyViewportWidth(width) !== 'mobile';
}

export function desktopEntryBlockedMessage(feature: string): string {
  return `${feature} is available on desktop (768px+). On mobile you can review existing records in read-only mode.`;
}
