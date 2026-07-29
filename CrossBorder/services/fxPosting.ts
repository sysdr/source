/**
 * Multi-currency conversion + FX gain/loss posting (REQ-061 / T-024).
 * Pure helpers — callers supply rates (from currencyService / Frankfurter).
 */
import type { JournalEntryLine } from '../types';
import { roundMoney } from './decimalMath';

export const FX_GAIN_LOSS_CODE = '7100';
export const FX_GAIN_LOSS_NAME = 'FX Gain/Loss';
export const BANK_CASH_CODE = '1000';

export type IsoCurrency = string;

export interface ConvertedAmount {
  /** Amount in original currency */
  originalAmount: number;
  originalCurrency: IsoCurrency;
  /** Amount in entity base currency */
  baseAmount: number;
  baseCurrency: IsoCurrency;
  /** Units of base per 1 unit of original */
  fxRate: number;
  fxRateDate: string;
}

export interface FxGainLossResult {
  bookingBaseAmount: number;
  settlementBaseAmount: number;
  /** Positive = gain (credit FX), negative = loss (debit FX) */
  gainLoss: number;
  isGain: boolean;
  isLoss: boolean;
}

function round2(n: number): number {
  return roundMoney(n);
}

/** Convert foreign amount to base using an explicit rate (date-specific). */
export function convertWithRate(input: {
  amount: number;
  fromCurrency: IsoCurrency;
  toCurrency: IsoCurrency;
  rate: number;
  rateDate: string;
}): ConvertedAmount {
  if (!(input.amount >= 0) || !Number.isFinite(input.amount)) {
    throw new Error('amount must be a non-negative finite number');
  }
  if (!(input.rate > 0) || !Number.isFinite(input.rate)) {
    throw new Error('fx rate must be a positive finite number');
  }
  const from = input.fromCurrency.toUpperCase();
  const to = input.toCurrency.toUpperCase();
  if (from === to) {
    return {
      originalAmount: round2(input.amount),
      originalCurrency: from,
      baseAmount: round2(input.amount),
      baseCurrency: to,
      fxRate: 1,
      fxRateDate: input.rateDate,
    };
  }
  return {
    originalAmount: round2(input.amount),
    originalCurrency: from,
    baseAmount: round2(input.amount * input.rate),
    baseCurrency: to,
    fxRate: input.rate,
    fxRateDate: input.rateDate,
  };
}

/**
 * FX difference when cash is received/settled at a different rate than booked.
 * Gain when settlement base > booking base (for inbound receipts).
 */
export function computeFxGainLoss(input: {
  originalAmount: number;
  bookingRate: number;
  settlementRate: number;
}): FxGainLossResult {
  if (!(input.originalAmount >= 0)) throw new Error('originalAmount must be non-negative');
  if (!(input.bookingRate > 0) || !(input.settlementRate > 0)) {
    throw new Error('rates must be positive');
  }
  const bookingBaseAmount = round2(input.originalAmount * input.bookingRate);
  const settlementBaseAmount = round2(input.originalAmount * input.settlementRate);
  const gainLoss = round2(settlementBaseAmount - bookingBaseAmount);
  return {
    bookingBaseAmount,
    settlementBaseAmount,
    gainLoss,
    isGain: gainLoss > 0,
    isLoss: gainLoss < 0,
  };
}

/**
 * Journal lines to recognise FX gain/loss against bank/cash.
 * Gain: Dr Bank, Cr FX Gain/Loss
 * Loss: Dr FX Gain/Loss, Cr Bank
 */
export function buildFxGainLossLines(input: {
  gainLoss: number;
  currency: 'INR' | 'USD';
  bankAccountCode?: string;
  fxAccountCode?: string;
  description?: string;
}): JournalEntryLine[] {
  const amount = round2(Math.abs(input.gainLoss));
  if (amount < 0.005) return [];

  const bank = input.bankAccountCode || BANK_CASH_CODE;
  const fx = input.fxAccountCode || FX_GAIN_LOSS_CODE;
  const desc = input.description || 'FX revaluation';
  const stamp = Date.now();

  if (input.gainLoss > 0) {
    return [
      {
        id: `jel-fx-${stamp}-1`,
        glAccountCode: bank,
        description: desc,
        debit: amount,
        credit: 0,
        currency: input.currency,
      },
      {
        id: `jel-fx-${stamp}-2`,
        glAccountCode: fx,
        description: desc,
        debit: 0,
        credit: amount,
        currency: input.currency,
      },
    ];
  }

  return [
    {
      id: `jel-fx-${stamp}-1`,
      glAccountCode: fx,
      description: desc,
      debit: amount,
      credit: 0,
      currency: input.currency,
    },
    {
      id: `jel-fx-${stamp}-2`,
      glAccountCode: bank,
      description: desc,
      debit: 0,
      credit: amount,
      currency: input.currency,
    },
  ];
}

/**
 * Enrich a transaction-like payload with base-currency fields (REQ-061).
 * Does not mutate rates — caller supplies fxRate from the date-specific provider.
 */
export function applyBaseCurrencyConversion(
  tx: Record<string, unknown>,
  input: {
    baseCurrency: IsoCurrency;
    fxRate: number;
    fxRateDate: string;
  },
): Record<string, unknown> {
  const originalCurrency = String(tx.currency || input.baseCurrency).toUpperCase();
  const originalAmount = Number(tx.originalAmount ?? tx.amount) || 0;
  const converted = convertWithRate({
    amount: originalAmount,
    fromCurrency: originalCurrency,
    toCurrency: input.baseCurrency,
    rate: originalCurrency === input.baseCurrency.toUpperCase() ? 1 : input.fxRate,
    rateDate: input.fxRateDate,
  });
  return {
    ...tx,
    currency: input.baseCurrency.toUpperCase() === 'USD' ? 'USD' : 'INR',
    amount: converted.baseAmount,
    originalAmount: converted.originalAmount,
    originalCurrency: converted.originalCurrency,
    fxRate: converted.fxRate,
    fxRateDate: converted.fxRateDate,
  };
}
