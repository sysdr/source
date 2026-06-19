/**
 * US tax: 1120/1065 draft, state apportionment, 1099 for contractors.
 */

import type { USTaxDraft, Contractor1099 } from '../types';
import { getTransferPricingData, getCompanyProfile } from './storageService';
import { getUSTaxDrafts, addUSTaxDraft, getContractor1099s, addContractor1099 } from './storageService';

const FEDERAL_RATE = 0.21;

const STATE_TAX_RATES: Record<string, { name: string; rate: number }> = {
  'CA': { name: 'California', rate: 0.0884 },
  'DE': { name: 'Delaware', rate: 0.0 },   // no corporate income tax
  'NY': { name: 'New York', rate: 0.065 },
  'TX': { name: 'Texas', rate: 0.0 },      // no corporate income tax
  'WA': { name: 'Washington', rate: 0.0 }, // no corporate income tax
  'FL': { name: 'Florida', rate: 0.055 },
  'IL': { name: 'Illinois', rate: 0.095 },
  'NJ': { name: 'New Jersey', rate: 0.09 },
  'MA': { name: 'Massachusetts', rate: 0.08 },
  'CO': { name: 'Colorado', rate: 0.0450 },
};

function resolveStateInfo(stateField: string | undefined): { name: string; rate: number } {
  if (!stateField) return { name: 'Delaware', rate: 0.0 };
  // Try exact 2-letter abbreviation match
  const upper = stateField.trim().toUpperCase();
  if (STATE_TAX_RATES[upper]) return STATE_TAX_RATES[upper];
  // Try case-insensitive name match
  const byName = Object.values(STATE_TAX_RATES).find(
    (s) => s.name.toLowerCase() === stateField.trim().toLowerCase()
  );
  if (byName) return byName;
  // Default: Delaware (most US startups incorporate in DE)
  return { name: 'Delaware', rate: 0.0 };
}

export function buildUSTaxDraft(taxYear: number, formType: '1120' | '1065'): USTaxDraft {
  const tp = getTransferPricingData();
  const usRevenue = tp.usRevenue ?? 0;
  const usExpenses = tp.usExpenses ?? 0;
  const taxableIncome = Math.max(0, usRevenue - usExpenses);
  const federalTax = taxableIncome * FEDERAL_RATE;

  const profile = getCompanyProfile();
  const stateInfo = resolveStateInfo(profile?.subsidiary?.state);
  const stateRate = stateInfo.rate;
  const stateTax = taxableIncome * stateRate;
  const totalTax = federalTax + stateTax;

  const draft: USTaxDraft = {
    id: `us-${formType}-${taxYear}-${Date.now()}`,
    formType,
    taxYear,
    usRevenue,
    usExpenses,
    taxableIncome,
    federalRate: FEDERAL_RATE,
    federalTax,
    stateName: stateInfo.name,
    stateRate,
    stateTax,
    totalTax,
    createdAt: new Date().toISOString(),
  };
  addUSTaxDraft(draft);
  return draft;
}

export function createContractor1099(input: {
  contractorName: string;
  tin?: string;
  address?: string;
  amount: number;
  taxYear: number;
  formType: '1099-NEC' | '1099-MISC';
}): Contractor1099 {
  const c: Contractor1099 = {
    id: `1099-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ...input,
    createdAt: new Date().toISOString(),
  };
  addContractor1099(c);
  return c;
}

export function get1099sForYear(taxYear: number): Contractor1099[] {
  return getContractor1099s().filter((c) => c.taxYear === taxYear);
}
