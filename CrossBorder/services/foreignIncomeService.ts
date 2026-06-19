/**
 * Foreign income classification and records; FX and sourcing.
 */

import type { Transaction, RevenueCategory, ForeignIncomeType } from '../types';
import { getRevenueData, getTransactions } from './storageService';
import { getForeignIncomeRecords, addForeignIncomeRecord } from './storageService';

export function classifyTransactionAsForeign(
  transactionId: string,
  customerCountry: string,
  incomeType: ForeignIncomeType,
  classification: RevenueCategory,
  sourcingCountry?: 'IN' | 'US',
): void {
  const records = getForeignIncomeRecords();
  if (records.some((r) => r.transactionId === transactionId)) return;

  const txn = getTransactions().find((t) => t.id === transactionId) ?? getRevenueData().transactions.find((t) => t.id === transactionId);
  if (!txn || txn.type !== 'Income') return;

  const record = {
    id: `fir-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    transactionId,
    date: txn.date,
    description: txn.description,
    amount: txn.amount,
    currency: txn.currency,
    customerCountry,
    incomeType,
    classification,
    sourcingCountry,
    createdAt: new Date().toISOString(),
  };
  addForeignIncomeRecord(record);
}

export function getForeignIncomeByPeriod(startDate: string, endDate: string): { total: number; byType: Record<ForeignIncomeType, number>; byCountry: Record<string, number> } {
  const records = getForeignIncomeRecords();
  const inRange = records.filter((r) => r.date >= startDate && r.date <= endDate);
  const total = inRange.reduce((s, r) => s + r.amount, 0);
  const byType: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  for (const r of inRange) {
    byType[r.incomeType] = (byType[r.incomeType] ?? 0) + r.amount;
    byCountry[r.customerCountry] = (byCountry[r.customerCountry] ?? 0) + r.amount;
  }
  return { total, byType: byType as Record<ForeignIncomeType, number>, byCountry };
}

export function getOIDARSummary(period: string): { totalOIDAR: number; gstLiability: number } {
  const records = getForeignIncomeRecords().filter(
    (r) => r.incomeType === 'oidar' && r.date.startsWith(period),
  );
  const totalOIDAR = records.reduce((s, r) => s + r.amount, 0);
  const gstLiability = totalOIDAR * 0.18;
  return { totalOIDAR, gstLiability };
}

export function getExportRevenueSummary(period: string): number {
  return getForeignIncomeRecords()
    .filter((r) => r.classification === 'Export Revenue (GST 0%)' && r.date.startsWith(period))
    .reduce((s, r) => s + r.amount, 0);
}
