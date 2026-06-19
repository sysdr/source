/**
 * Withholding tax (WHT) on foreign payments: rates, DTAA, deposit/cert tracking.
 */

import type { WithholdingPayment, TaxTreaty } from '../types';
import { getWithholdingPayments, addWithholdingPayment, getTaxTreaties } from './storageService';

const DEFAULT_RATES: Record<string, number> = {
  '195': 20,
  '194E': 5,
  '194LB': 5,
  '194LC': 5,
  '194A': 10,
  '194J': 10,
  '194T': 10,
};

export function getTreatyRate(countryCode: string, article: string): number | null {
  const treaties = getTaxTreaties().filter(
    (t) => t.countryCode === countryCode && t.article === article,
  );
  const now = new Date().toISOString().slice(0, 10);
  const valid = treaties.find(
    (t) => t.effectiveFrom <= now && (t.effectiveTo == null || t.effectiveTo >= now),
  );
  return valid?.rate ?? null;
}

export function calculateWHT(
  amount: number,
  section: string,
  payeeCountry: string,
  treatyArticle?: string,
): { rate: number; withheldAmount: number; treatyUsed?: string } {
  const treatyRate = treatyArticle ? getTreatyRate(payeeCountry, treatyArticle) : null;
  const rate = treatyRate ?? DEFAULT_RATES[section] ?? 20;
  const withheldAmount = amount * (rate / 100);
  return {
    rate,
    withheldAmount,
    treatyUsed: treatyRate != null ? `${payeeCountry}-${treatyArticle}` : undefined,
  };
}

export function recordWithholdingPayment(input: {
  date: string;
  payeeId: string;
  payeeName: string;
  payeeCountry: string;
  amount: number;
  currency: 'USD' | 'INR';
  section: string;
  rate: number;
  withheldAmount: number;
  treatyUsed?: string;
  trcReference?: string;
  depositDate?: string;
  certificateNumber?: string;
  quarter?: string;
  financialYear?: string;
}): WithholdingPayment {
  const now = new Date().toISOString();
  const w: WithholdingPayment = {
    id: `wht-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    createdAt: now,
  };
  addWithholdingPayment(w);
  return w;
}

export function getWithholdingByQuarter(quarter: string, financialYear: string): WithholdingPayment[] {
  return getWithholdingPayments().filter(
    (w) => w.quarter === quarter && w.financialYear === financialYear,
  );
}

export function getWithholdingBySection(section: string): WithholdingPayment[] {
  return getWithholdingPayments().filter((w) => w.section === section);
}
