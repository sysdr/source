/**
 * Design-token contrast checks (F-013 / REQ-069).
 * jsdom cannot run axe color-contrast reliably; we assert WCAG AA ratios
 * on the corporate palette used for text/surfaces.
 */
import { describe, expect, it } from 'vitest';

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(parseHex(fg));
  const L2 = relativeLuminance(parseHex(bg));
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Tokens mirrored from index.html design system */
const TOKENS = {
  n900: '#111e33',
  n500: '#637896',
  surfacePage: '#eef2f8',
  white: '#ffffff',
  brand600: '#1246D6',
  rose700: '#be123c',
  emerald800: '#065f46',
};

describe('design token contrast (F-013 / REQ-069)', () => {
  it('primary body text on page surface meets WCAG AA (4.5:1)', () => {
    expect(contrastRatio(TOKENS.n900, TOKENS.surfacePage)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.n900, TOKENS.white)).toBeGreaterThanOrEqual(4.5);
  });

  it('brand primary on white meets AA for UI text', () => {
    expect(contrastRatio(TOKENS.brand600, TOKENS.white)).toBeGreaterThanOrEqual(4.5);
  });

  it('status colors on white meet AA', () => {
    expect(contrastRatio(TOKENS.rose700, TOKENS.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.emerald800, TOKENS.white)).toBeGreaterThanOrEqual(4.5);
  });

  it('muted n-500 on white meets AA for secondary text', () => {
    expect(contrastRatio(TOKENS.n500, TOKENS.white)).toBeGreaterThanOrEqual(4.5);
  });
});
