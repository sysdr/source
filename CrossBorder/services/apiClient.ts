/**
 * Typed API client for the CrossBorder ERP backend.
 *
 * All methods:
 *   - are async
 *   - throw on HTTP errors (non-2xx)
 *   - silently no-op if the server is unreachable (returns null / [])
 *     so components always fall back to localStorage gracefully.
 *
 * Base URL: VITE_SERVER_URL env var or http://localhost:3001
 */

import type { Transaction, Employee, PayrollRun, Invoice } from '../types';

const BASE = (import.meta as { env?: { VITE_SERVER_URL?: string; VITE_SUEZ_API_KEY?: string } }).env?.VITE_SERVER_URL
  ?? 'http://localhost:3001';

const SUEZ_CLIENT_KEY = (import.meta as { env?: { VITE_SUEZ_API_KEY?: string } }).env?.VITE_SUEZ_API_KEY;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  } catch (e) {
    // Server unreachable — degrade gracefully
    if ((e as Error).message?.includes('fetch') || (e as Error).message?.includes('network')) {
      return null;
    }
    throw e;
  }
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export interface TxnQueryParams {
  orgId: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  type?: string;
  source?: string;
  status?: string;
  search?: string;
  includeDeleted?: boolean;
}

export interface TxnPage {
  transactions: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export const api = {
  // ── Transactions ──────────────────────────────────────────────────────────
  async getTransactions(params: TxnQueryParams): Promise<TxnPage | null> {
    return apiFetch<TxnPage>(`/api/transactions${qs(params as unknown as Record<string, string | number | boolean | undefined>)}`);
  },

  async upsertTransactions(orgId: string, transactions: Transaction[]): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ orgId, transactions }),
    });
    return result?.ok ?? false;
  },

  async upsertTransaction(orgId: string, transaction: Transaction): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ orgId, transaction }),
    });
    return result?.ok ?? false;
  },

  async updateTransaction(orgId: string, transaction: Transaction): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(`/api/transactions/${encodeURIComponent(transaction.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ orgId, transaction }),
    });
    return result?.ok ?? false;
  },

  async deleteTransaction(orgId: string, txId: string): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(`/api/transactions/${encodeURIComponent(txId)}${qs({ orgId })}`, {
      method: 'DELETE',
    });
    return result?.ok ?? false;
  },

  // ── Employees ─────────────────────────────────────────────────────────────
  async getEmployees(orgId: string): Promise<Employee[] | null> {
    const result = await apiFetch<{ employees: Employee[] }>(`/api/employees${qs({ orgId })}`);
    return result?.employees ?? null;
  },

  async upsertEmployees(orgId: string, employees: Employee[]): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>('/api/employees', {
      method: 'POST',
      body: JSON.stringify({ orgId, employees }),
    });
    return result?.ok ?? false;
  },

  async upsertEmployee(orgId: string, employee: Employee): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(`/api/employees/${encodeURIComponent(employee.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ orgId, employee }),
    });
    return result?.ok ?? false;
  },

  async deleteEmployee(orgId: string, empId: string): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(`/api/employees/${encodeURIComponent(empId)}${qs({ orgId })}`, {
      method: 'DELETE',
    });
    return result?.ok ?? false;
  },

  // ── Payroll ───────────────────────────────────────────────────────────────
  async getPayrollRuns(orgId: string): Promise<PayrollRun[] | null> {
    const result = await apiFetch<{ runs: PayrollRun[] }>(`/api/payroll${qs({ orgId })}`);
    return result?.runs ?? null;
  },

  async upsertPayrollRun(orgId: string, run: PayrollRun): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>('/api/payroll', {
      method: 'POST',
      body: JSON.stringify({ orgId, run }),
    });
    return result?.ok ?? false;
  },

  async deletePayrollRun(orgId: string, runId: string): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(`/api/payroll/${encodeURIComponent(runId)}${qs({ orgId })}`, {
      method: 'DELETE',
    });
    return result?.ok ?? false;
  },

  // ── Invoices ──────────────────────────────────────────────────────────────
  async getInvoices(orgId: string, status?: string): Promise<Invoice[] | null> {
    const result = await apiFetch<{ invoices: Invoice[] }>(`/api/invoices${qs({ orgId, status })}`);
    return result?.invoices ?? null;
  },

  async upsertInvoice(orgId: string, invoice: Invoice): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ orgId, invoice }),
    });
    return result?.ok ?? false;
  },

  async deleteInvoice(orgId: string, invId: string): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(`/api/invoices/${encodeURIComponent(invId)}${qs({ orgId })}`, {
      method: 'DELETE',
    });
    return result?.ok ?? false;
  },

  // ── Org data ──────────────────────────────────────────────────────────────
  async getOrgData<T>(orgId: string, key: string): Promise<T | null> {
    const result = await apiFetch<{ key: string; value: T }>(`/api/org/${encodeURIComponent(orgId)}/${encodeURIComponent(key)}`);
    return result?.value ?? null;
  },

  async getAllOrgData(orgId: string): Promise<Record<string, unknown> | null> {
    return apiFetch<Record<string, unknown>>(`/api/org/${encodeURIComponent(orgId)}`);
  },

  async setOrgData(orgId: string, key: string, value: unknown): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(`/api/org/${encodeURIComponent(orgId)}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
    return result?.ok ?? false;
  },

  // ── Health ────────────────────────────────────────────────────────────────
  async isAlive(): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>('/api/health');
    return result?.ok === true;
  },

  /**
   * Server-side Stripe → SQLite import (no browser). Requires API server.
   * When the server has SUEZ_API_KEY set, set VITE_SUEZ_API_KEY to the same value in `.env`.
   */
  async stripeSqliteSync(body: {
    orgId: string;
    baseCurrency: 'INR' | 'USD';
    stripeOrgConfig: {
      apiKey: string;
      accounts: { id: string; name?: string; scope?: string }[];
      accountsSource?: 'connect' | 'standard';
      stripeContextAccountId?: string;
    };
    entireHistory?: boolean;
    startDate?: string;
    endDate?: string;
    purge?: 'none' | 'stripe' | 'all';
  }): Promise<{
    ok: boolean;
    accountsSynced: number;
    chargeCount: number;
    upserted: number;
    purgeRemoved: number;
    error?: string;
  }> {
    const res = await fetch(`${BASE}/api/stripe/sqlite-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SUEZ_CLIENT_KEY ? { 'X-API-Key': SUEZ_CLIENT_KEY } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      ok: boolean;
      accountsSynced: number;
      chargeCount: number;
      upserted: number;
      purgeRemoved: number;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || res.statusText || 'stripeSqliteSync failed');
    }
    return data;
  },
};
