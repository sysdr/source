/**
 * Vendors, bills, payment runs, TDS on payments (P2P).
 */

import type { Vendor, Bill, BillLine, PaymentRun, PaymentRunLine } from '../types';
import { getVendors, addVendor, updateVendor, getBills, addBill, updateBill, getPaymentRuns, addPaymentRun, setPaymentRuns, addTransaction } from './storageService';
import type { Transaction, EntityType } from '../types';

const BILL_PREFIX = 'BILL';

function nextBillNumber(): string {
  const list = getBills();
  const year = String(new Date().getFullYear()).slice(-2);
  const sameYear = list.filter((i) => i.number.startsWith(`${BILL_PREFIX}-${year}`));
  const maxNum = sameYear.reduce((max, i) => {
    const n = parseInt(i.number.split('-')[2] || '0', 10);
    return n > max ? n : max;
  }, 0);
  return `${BILL_PREFIX}-${year}-${String(maxNum + 1).padStart(4, '0')}`;
}

function generateId(): string {
  return `bl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface CreateVendorInput {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  country: string;
  gstin?: string;
  pan?: string;
  isNonResident: boolean;
  bankAccount?: string;
  bankIfsc?: string;
  bankName?: string;
}

export function createVendor(input: CreateVendorInput): Vendor {
  const now = new Date().toISOString();
  const v: Vendor = {
    id: `vendor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    country: input.country,
    gstin: input.gstin,
    pan: input.pan,
    isNonResident: input.isNonResident,
    bankAccount: input.bankAccount,
    bankIfsc: input.bankIfsc,
    bankName: input.bankName,
    createdAt: now,
    updatedAt: now,
  };
  addVendor(v);
  return v;
}

export interface CreateBillInput {
  vendorId: string;
  date: string;
  dueDays?: number;
  currency: 'USD' | 'INR';
  lines: { description: string; quantity: number; unitPrice: number; gstRate?: number; glAccountCode?: string }[];
  entity?: EntityType;
  tdsSection?: string;
  tdsRate?: number;
}

const TDS_RATES: Record<string, number> = {
  '194Q': 1,
  '194A': 10,
  '194J': 10,
  '194T': 10,
  '195': 20,
};

export function createBill(input: CreateBillInput): Bill {
  const dueDate = input.dueDays != null
    ? (() => { const d = new Date(input.date); d.setDate(d.getDate() + input.dueDays); return d.toISOString().slice(0, 10); })()
    : input.date;

  const lines: BillLine[] = input.lines.map((l) => {
    const amount = l.quantity * l.unitPrice;
    const gstRate = l.gstRate ?? 0;
    const gstAmount = amount * (gstRate / 100);
    return {
      id: generateId(),
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount,
      gstRate: gstRate || undefined,
      gstAmount: gstAmount || undefined,
      glAccountCode: l.glAccountCode,
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const taxTotal = lines.reduce((s, l) => s + (l.gstAmount ?? 0), 0);
  const total = subtotal + taxTotal;
  const section = input.tdsSection ?? '194Q';
  const tdsRate = input.tdsRate ?? TDS_RATES[section] ?? 0;
  const tdsAmount = total * (tdsRate / 100);
  const netPayable = total - tdsAmount;

  const now = new Date().toISOString();
  const bill: Bill = {
    id: `bill-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    vendorId: input.vendorId,
    number: nextBillNumber(),
    date: input.date,
    dueDate,
    status: 'Pending',
    currency: input.currency,
    subtotal,
    taxTotal,
    total,
    lines,
    entity: input.entity,
    tdsSection: section,
    tdsRate,
    tdsAmount,
    netPayable,
    createdAt: now,
    updatedAt: now,
  };
  addBill(bill);
  return bill;
}

export interface CreatePaymentRunInput {
  date: string;
  vendorId: string;
  currency: 'USD' | 'INR';
  lines: { billId: string; amountPaid: number; tdsDeducted: number }[];
}

export function createPaymentRun(input: CreatePaymentRunInput): PaymentRun {
  const totalAmount = input.lines.reduce((s, l) => s + l.amountPaid + l.tdsDeducted, 0);
  const totalTds = input.lines.reduce((s, l) => s + l.tdsDeducted, 0);
  const totalNet = input.lines.reduce((s, l) => s + l.amountPaid, 0);

  const runLines: PaymentRunLine[] = input.lines.map((l) => ({
    billId: l.billId,
    amountPaid: l.amountPaid,
    tdsDeducted: l.tdsDeducted,
    netAmount: l.amountPaid,
  }));

  const now = new Date().toISOString();
  const pr: PaymentRun = {
    id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    date: input.date,
    vendorId: input.vendorId,
    currency: input.currency,
    lines: runLines,
    totalAmount,
    totalTds,
    totalNet,
    status: 'Draft',
    createdAt: now,
  };
  addPaymentRun(pr);
  return pr;
}

export function processPaymentRun(
  paymentRunId: string,
  entity?: EntityType,
): void {
  const runs = getPaymentRuns();
  const pr = runs.find((r) => r.id === paymentRunId);
  if (!pr || pr.status !== 'Draft') return;

  const vendor = getVendors().find((v) => v.id === pr.vendorId);
  const desc = `Payment to ${vendor?.name ?? 'Vendor'} - ${pr.lines.length} bill(s)`;
  const tx: Transaction = {
    id: `tx-pr-${paymentRunId}`,
    date: pr.date,
    description: desc,
    amount: -pr.totalNet,
    currency: pr.currency,
    source: 'Manual',
    category: 'Vendor Payment',
    status: 'Completed',
    type: 'Expense',
    entity,
  };
  addTransaction(tx);

  pr.lines.forEach((line) => {
    updateBill(line.billId, { status: 'Paid', paidAt: pr.date, paymentRunId: pr.id, transactionId: tx.id });
  });

  const list = getPaymentRuns().map((r) =>
    r.id === paymentRunId ? { ...r, status: 'Processed' as const, transactionId: tx.id } : r,
  );
  setPaymentRuns(list);
}

export function getBillsByVendor(vendorId: string): Bill[] {
  return getBills().filter((b) => b.vendorId === vendorId);
}

export function getUnpaidBills(): Bill[] {
  return getBills().filter((b) => b.status === 'Pending' || b.status === 'Overdue');
}
