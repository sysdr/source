import { CompanyProfile } from '../types';
import { getCompanyProfile, getManualUsdToInrRate, getUIState, StorageKeys } from './storageService';
import { USD_TO_INR } from '../constants';
import { get as psGet, setIfChanged, PersistentKeys } from './persistentStorage';

export type BaseCurrency = 'INR' | 'USD';

const US_STATES = new Set(['Delaware', 'Wyoming', 'California', 'New York', 'Texas', 'Nevada', 'Florida', 'Washington', 'Colorado', 'Arizona']);
const INDIAN_STATES = new Set(['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Delhi', 'Telangana', 'Gujarat', 'West Bengal', 'Kerala', 'Rajasthan', 'Uttar Pradesh']);

/** Derive base currency from parent company registration country */
export function getBaseCurrencyFromProfile(profile: CompanyProfile | null): BaseCurrency {
  if (!profile) return 'INR';
  if (profile.baseCurrency) return profile.baseCurrency;
  const parentState = profile.parent?.state || '';
  const parentCountry = (profile.parent as { country?: 'IN' | 'US' })?.country;
  const parentTaxId = profile.parent?.taxId || '';
  if (parentCountry === 'US') return 'USD';
  if (parentCountry === 'IN') return 'INR';
  if (US_STATES.has(parentState) || (parentTaxId && parentTaxId.replace(/-/g, '').match(/^\d{9}$/))) return 'USD';
  if (INDIAN_STATES.has(parentState) || (parentTaxId && parentTaxId.length >= 15)) return 'INR';
  return 'INR';
}

export function getBaseCurrency(): BaseCurrency {
  const profile = getCompanyProfile();
  return getBaseCurrencyFromProfile(profile);
}

/** User-selected currency for displaying all amounts (INR or USD). Defaults to base currency. */
export function getDisplayCurrency(): BaseCurrency {
  return getUIState(StorageKeys.UI_DISPLAY_CURRENCY, getBaseCurrency()) as BaseCurrency;
}

const fxCache: Record<string, number> = {};
const DEFAULT_USD_INR = USD_TO_INR;
let todayUsdInrCache: number | null = null;

/** Load today's USD/INR from persistent storage into memory (e.g. after refresh). */
function loadPersistedTodayRate(): void {
  try {
    const today = psGet<number>(PersistentKeys.todayUsdInr);
    if (typeof today === 'number' && today > 0) todayUsdInrCache = today;
  } catch {
    // ignore
  }
}
loadPersistedTodayRate();

const FRANKFURTER_CURRENCIES = new Set(['AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HRK', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'RUB', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR']);

/** Fetch historical FX rate for a date (withdrawal/settlement date) */
export async function getFxRateForDate(date: string, from: string, to: string): Promise<number> {
  const fromUpper = from?.toUpperCase() || 'USD';
  const toUpper = to?.toUpperCase() || 'USD';
  if (fromUpper === toUpper) return 1;
  const cacheKey = `${date}-${fromUpper}-${toUpper}`;
  if (fxCache[cacheKey]) return fxCache[cacheKey];
  const persistedKey = PersistentKeys.fxRate(date, fromUpper, toUpper);
  const persisted = psGet<number>(persistedKey);
  if (typeof persisted === 'number' && persisted > 0) {
    fxCache[cacheKey] = persisted;
    return persisted;
  }
  try {
    const fromCode = FRANKFURTER_CURRENCIES.has(fromUpper) ? fromUpper : 'USD';
    const toCode = FRANKFURTER_CURRENCIES.has(toUpper) ? toUpper : 'USD';
    const res = await fetch(
      `https://api.frankfurter.app/${date}?from=${fromCode}&to=${toCode}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error('FX API failed');
    const data = await res.json();
    const rate = data?.rates?.[toCode];
    if (typeof rate === 'number') {
      fxCache[cacheKey] = rate;
      setIfChanged(persistedKey, rate, { namespace: 'fetch' });
      return rate;
    }
  } catch {
    // Fallback to default
  }
  if (fromUpper === 'USD' && toUpper === 'INR') return DEFAULT_USD_INR;
  if (fromUpper === 'INR' && toUpper === 'USD') return 1 / DEFAULT_USD_INR;
  if (fromUpper !== 'USD' && fromUpper !== 'INR' && toUpper === 'USD') return 0;
  if (fromUpper !== 'USD' && fromUpper !== 'INR' && toUpper === 'INR') return 0;
  return 1;
}

/** Convert amount to base currency using date-specific FX rate. Supports USD, INR, EUR, GBP, etc. via Frankfurter. */
export async function convertToBaseCurrency(
  amount: number,
  fromCurrency: string,
  date: string,
  baseCurrency: BaseCurrency
): Promise<{ amount: number; fxRate: number; fxRateDate: string }> {
  const from = (fromCurrency?.toUpperCase() || 'USD') as string;
  if (from === baseCurrency) return { amount, fxRate: 1, fxRateDate: date };
  if (!FRANKFURTER_CURRENCIES.has(from)) {
    return convertToBaseCurrency(amount, 'USD', date, baseCurrency);
  }
  const rate = await getFxRateForDate(date, from, baseCurrency);
  if (rate <= 0) return { amount: 0, fxRate: 0, fxRateDate: date };
  const converted = amount * rate;
  return { amount: Math.round(converted * 100) / 100, fxRate: rate, fxRateDate: date };
}

/** Synchronous conversion using default rate (when async not needed) */
export function convertToBaseSync(
  amount: number,
  fromCurrency: 'USD' | 'INR',
  baseCurrency: BaseCurrency
): number {
  if (fromCurrency === baseCurrency) return amount;
  if (fromCurrency === 'USD' && baseCurrency === 'INR') return amount * DEFAULT_USD_INR;
  if (fromCurrency === 'INR' && baseCurrency === 'USD') return amount / DEFAULT_USD_INR;
  return amount;
}

/** Fetch today's USD to INR rate. Caches result. Persists only when changed. Uses manual override if set. */
export async function fetchTodayUsdToInrRate(): Promise<number> {
  const manual = getManualUsdToInrRate();
  if (manual) return manual;
  try {
    const res = await fetch(
      'https://api.frankfurter.app/latest?from=USD&to=INR',
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error('FX API failed');
    const data = await res.json();
    const rate = data?.rates?.INR;
    if (typeof rate === 'number') {
      todayUsdInrCache = rate;
      setIfChanged(PersistentKeys.todayUsdInr, rate, { namespace: 'fetch' });
      return rate;
    }
  } catch {
    // Fallback
  }
  todayUsdInrCache = DEFAULT_USD_INR;
  return DEFAULT_USD_INR;
}

/** Get today's USD→INR rate (sync). Manual override > cached > default. */
export function getTodayUsdToInrRate(): number {
  const manual = getManualUsdToInrRate();
  if (manual) return manual;
  return todayUsdInrCache ?? DEFAULT_USD_INR;
}

/** Update cached today rate (call after fetchTodayUsdToInrRate). */
export function setTodayUsdInrCache(rate: number): void {
  todayUsdInrCache = rate;
}

/** Format amount in base currency for display (no rounding; show decimals as-is) */
export function formatAmount(amount: number, baseCurrency: BaseCurrency, options?: { compact?: boolean }): string {
  const frac = { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  if (baseCurrency === 'INR') {
    return `₹${amount.toLocaleString('en-IN', { ...frac, ...(options?.compact ? { notation: 'compact' } : {}) })}`;
  }
  return `$${amount.toLocaleString('en-US', { ...frac, ...(options?.compact ? { notation: 'compact' } : {}) })}`;
}

/** Convert amount from one currency to another using today's USD/INR rate. */
export function toDisplayCurrency(
  amount: number,
  fromCurrency: 'USD' | 'INR',
  displayCurrency: BaseCurrency
): number {
  if (fromCurrency === displayCurrency) return amount;
  const rate = getTodayUsdToInrRate();
  if (fromCurrency === 'USD' && displayCurrency === 'INR') return amount * rate;
  if (fromCurrency === 'INR' && displayCurrency === 'USD') return amount / rate;
  return amount;
}

/** Format a single amount in the chosen display currency (no dual USD/INR). Use with getDisplayCurrency() or passed displayCurrency. */
export function formatAmountInDisplay(
  amount: number,
  amountCurrency: 'USD' | 'INR',
  displayCurrency: BaseCurrency,
  options?: { compact?: boolean }
): string {
  const converted = toDisplayCurrency(amount, amountCurrency, displayCurrency);
  return formatAmount(converted, displayCurrency, options);
}

/** Format amount showing both USD and INR using today's rate (no rounding; show decimals as-is). */
export function formatAmountDual(amount: number, amountCurrency: 'USD' | 'INR', options?: { compact?: boolean }): string {
  const rate = getTodayUsdToInrRate();
  const frac = { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  const fmt = (n: number, isInr: boolean) =>
    isInr ? `₹${n.toLocaleString('en-IN', { ...frac, ...(options?.compact ? { notation: 'compact' } : {}) })}` : `$${n.toLocaleString('en-US', { ...frac, ...(options?.compact ? { notation: 'compact' } : {}) })}`;
  const usd = amountCurrency === 'USD' ? amount : amount / rate;
  const inr = amountCurrency === 'INR' ? amount : amount * rate;
  return `${fmt(usd, false)} (${fmt(inr, true)})`;
}

/** Get amount in base currency from a transaction (converts when tx.currency differs from base) */
export function getAmountInBase(
  tx: { amount: number; currency: 'USD' | 'INR'; originalAmount?: number; originalCurrency?: string },
  baseCurrency: BaseCurrency,
): number {
  if (
    tx.originalCurrency != null &&
    tx.originalAmount != null &&
    tx.originalCurrency !== baseCurrency &&
    (tx.originalCurrency === 'USD' || tx.originalCurrency === 'INR')
  ) {
    return convertToBaseSync(tx.originalAmount, tx.originalCurrency, baseCurrency);
  }
  if (tx.currency === baseCurrency) return tx.amount;
  return convertToBaseSync(tx.amount, tx.currency, baseCurrency);
}

/** Get GST/tax impact in base currency */
export function getGstImpactInBase(tx: { amount: number; currency: 'USD' | 'INR'; gstImpact?: number }, baseCurrency: BaseCurrency): number {
  if (!tx.gstImpact) return 0;
  if (tx.currency === baseCurrency) return tx.gstImpact;
  return convertToBaseSync(tx.gstImpact, tx.currency, baseCurrency);
}
