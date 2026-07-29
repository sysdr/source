import { describe, expect, it } from 'vitest';
import {
  moneyAdd,
  moneyMul,
  moneyPercent,
  moneySub,
  roundBankers,
  roundMoney,
} from './decimalMath';
import {
  assessFxStaleness,
  FX_MAX_STALENESS_MS,
  shouldRefreshFxRate,
} from './fxStaleness';

describe('decimalMath (REQ-034 / T-038)', () => {
  it('uses banker’s rounding on .5 ties (half to even)', () => {
    expect(roundBankers(1.225, 2)).toBe(1.22); // 122.5 → 122 (even)
    expect(roundBankers(1.235, 2)).toBe(1.24); // 123.5 → 124 (even)
    expect(roundBankers(2.5, 0)).toBe(2); // 2.5 → 2 (even)
    expect(roundBankers(3.5, 0)).toBe(4); // 3.5 → 4 (even)
  });

  it('rounds money to 2dp', () => {
    expect(roundMoney(10.006)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
    expect(roundMoney(2.5)).toBe(2.5);
  });

  it('adds/subtracts via minor units', () => {
    expect(moneyAdd(0.1, 0.2)).toBe(0.3);
    expect(moneySub(1.0, 0.3)).toBe(0.7);
  });

  it('computes TDS-style percents safely', () => {
    expect(moneyPercent(100_000, 1)).toBe(1000);
    expect(moneyMul(83.4567, 100, 2)).toBe(8345.67);
  });
});

describe('fxStaleness (REQ-033 / T-037)', () => {
  it('flags missing snapshot as stale', () => {
    const r = assessFxStaleness(null, { nowMs: Date.parse('2026-07-29T10:00:00+05:30') });
    expect(r.stale).toBe(true);
    expect(shouldRefreshFxRate(r)).toBe(true);
  });

  it('flags rates older than 4h in business hours', () => {
    const now = Date.parse('2026-07-29T14:00:00+05:30'); // Wed afternoon IST
    const r = assessFxStaleness(
      {
        rate: 83.5,
        fetchedAt: new Date(now - FX_MAX_STALENESS_MS - 60_000).toISOString(),
        source: 'frankfurter',
        pair: 'USD/INR',
      },
      { nowMs: now },
    );
    expect(r.withinBusinessHours).toBe(true);
    expect(r.stale).toBe(true);
  });

  it('accepts fresh rates', () => {
    const now = Date.parse('2026-07-29T14:00:00+05:30');
    const r = assessFxStaleness(
      {
        rate: 83.5,
        fetchedAt: new Date(now - 30 * 60_000).toISOString(),
        source: 'cache',
        pair: 'USD/INR',
      },
      { nowMs: now },
    );
    expect(r.stale).toBe(false);
  });
});
