/**
 * Decimal-safe financial math (REQ-034 / T-038).
 * Integer-cent arithmetic + banker's rounding (half to even).
 * No floating multiply/divide chains for money.
 */

export type MoneyScale = 0 | 2 | 4;

const SCALE_FACTOR: Record<MoneyScale, number> = {
  0: 1,
  2: 100,
  4: 10_000,
};

/**
 * Banker's rounding (IEEE 754 round-ties-to-even) at `scale` decimal places.
 */
export function roundBankers(value: number, scale: MoneyScale = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = SCALE_FACTOR[scale];
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const EPS = 1e-9;
  if (Math.abs(frac - 0.5) < EPS) {
    // tie → even
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Math.round(scaled) / factor;
}

/** Convert major units to minor (cents) with banker's rounding. */
export function toMinor(amount: number, scale: MoneyScale = 2): number {
  return Math.round(roundBankers(amount, scale) * SCALE_FACTOR[scale]);
}

/** Convert minor units back to major. */
export function fromMinor(minor: number, scale: MoneyScale = 2): number {
  return minor / SCALE_FACTOR[scale];
}

/** Add amounts in major units via integer minor units. */
export function moneyAdd(...amounts: number[]): number {
  const sum = amounts.reduce((acc, n) => acc + toMinor(n), 0);
  return fromMinor(sum);
}

/** Subtract b from a. */
export function moneySub(a: number, b: number): number {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** Multiply amount × rate (e.g. FX or TDS percent/100) with banker's rounding. */
export function moneyMul(amount: number, factor: number, scale: MoneyScale = 2): number {
  if (!Number.isFinite(amount) || !Number.isFinite(factor)) return 0;
  return roundBankers(amount * factor, scale);
}

/** Compute percentage of amount: amount × (percent / 100). */
export function moneyPercent(amount: number, percent: number, scale: MoneyScale = 2): number {
  return moneyMul(amount, percent / 100, scale);
}

/** Alias used across posting engines. */
export function roundMoney(amount: number): number {
  return roundBankers(amount, 2);
}
