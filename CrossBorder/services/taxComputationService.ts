/**
 * India tax computation: P&L to tax computation, advance tax, provisioning.
 */

import type { TaxComputation, TaxComputationLine, AdvanceTaxInstallment } from '../types';
import { getTaxEngineData, getTaxComputations, addTaxComputation, getAdvanceTaxInstallments, addAdvanceTaxInstallment } from './storageService';

const ADVANCE_DATES: Record<number, string[]> = {
  1: ['2025-06-15'],
  2: ['2025-09-15'],
  3: ['2025-12-15'],
  4: ['2026-03-15'],
};

export function buildTaxComputation(financialYear: string): TaxComputation {
  const [fyStartStr] = financialYear.split('-').map(Number);
  const taxEngine = getTaxEngineData();
  const bookProfit = taxEngine.bookProfit ?? 0;

  const lines: TaxComputationLine[] = [
    { description: 'Book profit', amount: bookProfit, addBack: false },
    { description: 'Add back: Disallowances (40A(3), 43B, etc.)', amount: 0, addBack: true },
    { description: 'Less: Deductions', amount: 0, addBack: false },
  ];

  const taxableIncome = Math.max(
    0,
    bookProfit + lines.filter((l) => l.addBack).reduce((s, l) => s + l.amount, 0) - lines.filter((l) => !l.addBack && l.description !== 'Book profit').reduce((s, l) => s + l.amount, 0),
  );
  const taxRate = 0.25;
  const taxAmount = taxableIncome * taxRate;

  const now = new Date().toISOString();
  const comp: TaxComputation = {
    id: `tc-${financialYear}-${Date.now()}`,
    financialYear,
    bookProfit,
    lines,
    taxableIncome,
    taxRate,
    taxAmount,
    createdAt: now,
    updatedAt: now,
  };
  addTaxComputation(comp);
  return comp;
}

export function getAdvanceTaxSchedule(financialYear: string): AdvanceTaxInstallment[] {
  const existing = getAdvanceTaxInstallments().filter((a) => a.financialYear === financialYear);
  if (existing.length > 0) return existing;

  const [fyStart] = financialYear.split('-').map(Number);
  const comps = getTaxComputations().filter((c) => c.financialYear === financialYear);
  const annualTax = comps.length > 0 ? comps[0].taxAmount : 0;
  const perInstallment = annualTax / 4;

  const installments: AdvanceTaxInstallment[] = [1, 2, 3, 4].map((installment) => {
    const dueDate = ADVANCE_DATES[installment as keyof typeof ADVANCE_DATES]?.[0] ?? '';
    const adjusted = installment === 4 ? annualTax - perInstallment * 3 : perInstallment;
    return {
      id: `ati-${financialYear}-${installment}`,
      financialYear,
      installment: installment as 1 | 2 | 3 | 4,
      dueDate: dueDate.replace(/\d{4}/, String(fyStart + (installment >= 4 ? 1 : 0))),
      amount: Math.round(adjusted),
    };
  });
  installments.forEach((a) => addAdvanceTaxInstallment(a));
  return installments;
}
