import { describe, expect, it } from 'vitest';
import {
  FX_GAIN_LOSS_CODE,
  applyBaseCurrencyConversion,
  buildFxGainLossLines,
  computeFxGainLoss,
  convertWithRate,
} from './fxPosting';

describe('fxPosting (REQ-061 / T-024)', () => {
  it('converts foreign amount to base with explicit rate', () => {
    const result = convertWithRate({
      amount: 100,
      fromCurrency: 'USD',
      toCurrency: 'INR',
      rate: 83.5,
      rateDate: '2026-01-15',
    });
    expect(result.baseAmount).toBe(8350);
    expect(result.originalAmount).toBe(100);
    expect(result.fxRate).toBe(83.5);
  });

  it('computes FX gain when settlement rate is higher', () => {
    const gl = computeFxGainLoss({
      originalAmount: 100,
      bookingRate: 80,
      settlementRate: 83,
    });
    expect(gl.bookingBaseAmount).toBe(8000);
    expect(gl.settlementBaseAmount).toBe(8300);
    expect(gl.gainLoss).toBe(300);
    expect(gl.isGain).toBe(true);
  });

  it('builds balanced gain and loss journal lines against FX Gain/Loss', () => {
    const gainLines = buildFxGainLossLines({
      gainLoss: 300,
      currency: 'INR',
      description: 'Stripe payout FX',
    });
    expect(gainLines).toHaveLength(2);
    expect(gainLines[0].debit).toBe(300);
    expect(gainLines[1].glAccountCode).toBe(FX_GAIN_LOSS_CODE);
    expect(gainLines[1].credit).toBe(300);
    expect(gainLines.reduce((s, l) => s + l.debit, 0)).toBe(
      gainLines.reduce((s, l) => s + l.credit, 0),
    );

    const lossLines = buildFxGainLossLines({ gainLoss: -150, currency: 'INR' });
    expect(lossLines[0].glAccountCode).toBe(FX_GAIN_LOSS_CODE);
    expect(lossLines[0].debit).toBe(150);
    expect(lossLines[1].credit).toBe(150);
  });

  it('enriches transaction with original + base amounts', () => {
    const enriched = applyBaseCurrencyConversion(
      { id: 'tx-1', amount: 50, currency: 'EUR', description: 'EU customer' },
      { baseCurrency: 'INR', fxRate: 90, fxRateDate: '2026-02-01' },
    );
    expect(enriched.originalAmount).toBe(50);
    expect(enriched.originalCurrency).toBe('EUR');
    expect(enriched.amount).toBe(4500);
    expect(enriched.currency).toBe('INR');
    expect(enriched.fxRate).toBe(90);
  });
});
