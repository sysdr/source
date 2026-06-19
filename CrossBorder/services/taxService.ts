/**
 * Tax calculation service.
 * When TAX_API_URL (and optionally TAX_API_KEY) are set, calls external API (Avalara/Vertex).
 * Otherwise uses built-in partner remuneration (Sec 40b + 194T) and stub for other types.
 */

import { getTaxEngineData } from './storageService';

export interface TaxCalculateParams {
  amount: number;
  fromCountry?: string;
  toCountry?: string;
  productType?: string;
}

export interface TaxCalculateResult {
  amount: number;
  fromCountry: string;
  toCountry: string;
  productType: string;
  taxRate: number;
  taxAmount: number;
  currency: string;
  note: string;
  maxDeductibleSalary?: number;
  tds194T?: number;
}

/** Optional: set in env for production. e.g. TAX_API_URL=https://api.avalara.com/... TAX_API_KEY=... */
const TAX_API_URL = typeof process !== 'undefined' ? process.env.TAX_API_URL : undefined;
const TAX_API_KEY = typeof process !== 'undefined' ? process.env.TAX_API_KEY : undefined;

async function callExternalTaxApi(params: TaxCalculateParams): Promise<TaxCalculateResult | null> {
  if (!TAX_API_URL || !params.amount) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (TAX_API_KEY) headers['Authorization'] = `Bearer ${TAX_API_KEY}`;
    const res = await fetch(TAX_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: params.amount,
        fromCountry: params.fromCountry || 'US',
        toCountry: params.toCountry || 'IN',
        productType: params.productType || 'service',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      amount: data.amount ?? params.amount,
      fromCountry: data.fromCountry ?? params.fromCountry ?? 'US',
      toCountry: data.toCountry ?? params.toCountry ?? 'IN',
      productType: data.productType ?? params.productType ?? 'service',
      taxRate: data.taxRate ?? 0,
      taxAmount: data.taxAmount ?? 0,
      currency: data.currency ?? 'USD',
      note: data.note ?? 'Calculated via external tax API.',
    };
  } catch {
    return null;
  }
}

/** Partner remuneration (Sec 40b + 194T) from tax engine. */
function partnerRemunerationTax(): TaxCalculateResult {
  const taxEngine = getTaxEngineData();
  const bookProfit = taxEngine.bookProfit ?? 0;
  const first3L = Math.min(bookProfit, 300000) * 0.9;
  const balance = Math.max(0, bookProfit - 300000) * 0.6;
  const maxRem = Math.max(150000, first3L + balance);
  const tds194T = maxRem > 20000 ? maxRem * 0.1 : 0;
  return {
    amount: maxRem,
    fromCountry: 'IN',
    toCountry: 'IN',
    productType: 'partner_remuneration',
    maxDeductibleSalary: maxRem,
    tds194T,
    taxRate: 0.1,
    taxAmount: tds194T,
    currency: 'INR',
    note: 'Sec 40(b) and 194T (10% TDS) applied from Tax Engine.',
  };
}

export async function taxCalculate(params: TaxCalculateParams): Promise<TaxCalculateResult> {
  const amount = Number(params.amount ?? 0);
  const fromCountry = (params.fromCountry as string) || 'US';
  const toCountry = (params.toCountry as string) || 'IN';
  const productType = (params.productType as string) || 'service';

  if (productType === 'partner_remuneration' || productType === 'partner') {
    return partnerRemunerationTax();
  }

  const external = await callExternalTaxApi({ amount, fromCountry, toCountry, productType });
  if (external) return external;

  return {
    amount,
    fromCountry,
    toCountry,
    productType,
    taxRate: 0,
    taxAmount: 0,
    currency: 'USD',
    note: 'External tax API not configured (set TAX_API_URL and optionally TAX_API_KEY). For production use Avalara or Vertex.',
  };
}
