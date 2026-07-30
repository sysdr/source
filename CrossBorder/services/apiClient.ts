/**
 * Typed API client for the CrossBorder ERP backend.
 *
 * All methods:
 *   - are async
 *   - throw on HTTP errors (non-2xx)
 *   - silently no-op if the server is unreachable (returns null / [])
 *     so components always fall back to localStorage gracefully.
 *
 * Base URL: VITE_SERVER_URL, or same hostname as the page on port 3001 (LAN-friendly).
 */

import type { Transaction, Employee, PayrollRun, Invoice, EmployeeInvite, LeaveRequest } from '../types';
import { getServerBaseUrl } from './serverUrl';

const BASE = getServerBaseUrl();

const SUEZ_CLIENT_KEY = (import.meta as { env?: { VITE_SUEZ_API_KEY?: string } }).env?.VITE_SUEZ_API_KEY;

const ACCESS_ROLE_KEY = 'suez_access_role';
const ACCOUNTANT_TOKEN_KEY = 'suez_accountant_token';
const WRITER_SESSION_KEY = 'suez_writer_session_id';

export function getAccessRole(): 'owner' | 'accountant' | 'employee' {
  const role = sessionStorage.getItem(ACCESS_ROLE_KEY);
  if (role === 'accountant' || role === 'employee') return role;
  return 'owner';
}

export function setAccessRole(role: 'owner' | 'accountant' | 'employee'): void {
  sessionStorage.setItem(ACCESS_ROLE_KEY, role);
}

export function getAccountantToken(): string | null {
  return sessionStorage.getItem(ACCOUNTANT_TOKEN_KEY);
}

export function setAccountantToken(token: string | null): void {
  if (token) sessionStorage.setItem(ACCOUNTANT_TOKEN_KEY, token);
  else sessionStorage.removeItem(ACCOUNTANT_TOKEN_KEY);
}

export function getOrCreateWriterSessionId(): string {
  let id = sessionStorage.getItem(WRITER_SESSION_KEY);
  if (!id) {
    id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(WRITER_SESSION_KEY, id);
  }
  return id;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const role = getAccessRole();
  headers['X-SUEZ-ROLE'] = role;
  const token = getAccountantToken();
  if (token) headers['X-SUEZ-ACCOUNTANT-TOKEN'] = token;
  if (role === 'employee') {
    try {
      const raw = localStorage.getItem('suez_app_session') || sessionStorage.getItem('suez_app_session');
      if (raw) {
        const session = JSON.parse(raw) as { employeeId?: string };
        if (session.employeeId) headers['X-SUEZ-EMPLOYEE-ID'] = session.employeeId;
      }
    } catch { /* ignore */ }
  }
  if (SUEZ_CLIENT_KEY) headers['X-API-Key'] = SUEZ_CLIENT_KEY;
  return headers;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init?.headers ?? {}),
      },
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

  async getEmployeeSelf(
    orgId: string,
    employeeId: string,
  ): Promise<Employee | null> {
    const result = await apiFetch<{ employee: Employee }>(
      `/api/employees/self${qs({ orgId, employeeId })}`,
    );
    return result?.employee ?? null;
  },

  async updateEmployeeSelf(
    orgId: string,
    employeeId: string,
    patch: Partial<Employee>,
  ): Promise<{ ok: boolean; employee?: Employee; error?: string }> {
    try {
      const result = await apiFetch<{ ok: boolean; employee?: Employee }>('/api/employees/self', {
        method: 'PUT',
        body: JSON.stringify({ orgId, employeeId, patch }),
      });
      if (!result) return { ok: false, error: 'Server unreachable' };
      return { ok: true, employee: result.employee };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
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

  async getLeaveRequests(orgId: string): Promise<LeaveRequest[] | null> {
    const result = await apiFetch<{ leaveRequests: LeaveRequest[] }>(
      `/api/leave-requests${qs({ orgId })}`,
    );
    return result?.leaveRequests ?? null;
  },

  async upsertLeaveRequest(orgId: string, request: LeaveRequest): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>('/api/leave-requests', {
      method: 'POST',
      body: JSON.stringify({ orgId, request }),
    });
    return result?.ok ?? false;
  },

  async updateLeaveRequest(
    orgId: string,
    leaveId: string,
    updates: Partial<LeaveRequest>,
  ): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(
      `/api/leave-requests/${encodeURIComponent(leaveId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ orgId, updates }),
      },
    );
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

  // ── SMTP ──────────────────────────────────────────────────────────────────
  async getSmtpSettings(orgId: string): Promise<(Record<string, unknown> & { hasPassword?: boolean }) | null> {
    const result = await apiFetch<{ settings: (Record<string, unknown> & { hasPassword?: boolean }) | null }>(
      `/api/smtp${qs({ orgId })}`,
    );
    return result?.settings ?? null;
  },

  async saveSmtpSettings(orgId: string, settings: Record<string, unknown>): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>('/api/smtp', {
      method: 'PUT',
      body: JSON.stringify({ orgId, settings }),
    });
    return result?.ok ?? false;
  },

  async testSmtp(orgId: string, to?: string): Promise<{ ok: boolean; to?: string; messageId?: string; error?: string }> {
    try {
      const result = await apiFetch<{ ok: boolean; to?: string; messageId?: string }>('/api/smtp/test', {
        method: 'POST',
        body: JSON.stringify({ orgId, to }),
      });
      if (!result) return { ok: false, error: 'Server unreachable. Start the API with npm run server.' };
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async requestMagicLogin(body: {
    orgId: string;
    email: string;
    role?: 'admin' | 'employee' | 'auto';
    appBaseUrl?: string;
  }): Promise<{
    ok: boolean;
    emailSent?: boolean;
    role?: 'admin' | 'employee';
    email?: string;
    orgId?: string;
    expiresAt?: string;
    warning?: string;
    devCode?: string;
    magicUrl?: string;
    error?: string;
  }> {
    try {
      const res = await fetch(`${BASE}/api/auth/magic/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        const raw = String(data.error || res.statusText);
        const error =
          res.status === 404 || raw.toLowerCase() === 'not found'
            ? 'Sign-in API not found — restart the API server (npm run server) so magic-login routes load.'
            : raw;
        return { ok: false, error };
      }
      return {
        ok: true,
        emailSent: Boolean(data.emailSent),
        role: data.role as 'admin' | 'employee' | undefined,
        email: typeof data.email === 'string' ? data.email : undefined,
        orgId: typeof data.orgId === 'string' ? data.orgId : undefined,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
        warning: typeof data.warning === 'string' ? data.warning : undefined,
        devCode: typeof data.devCode === 'string' ? data.devCode : undefined,
        magicUrl: typeof data.magicUrl === 'string' ? data.magicUrl : undefined,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'Server unreachable' };
    }
  },

  async verifyMagicLogin(body: {
    orgId: string;
    email?: string;
    code?: string;
    token?: string;
  }): Promise<{
    ok: boolean;
    session?: {
      role: 'admin' | 'employee';
      email: string;
      orgId: string;
      displayName: string;
      employeeId?: string;
    };
    error?: string;
  }> {
    try {
      const res = await fetch(`${BASE}/api/auth/magic/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        ok?: boolean;
        session?: {
          role: 'admin' | 'employee';
          email: string;
          orgId: string;
          displayName: string;
          employeeId?: string;
        };
        error?: string;
      };
      if (!res.ok) return { ok: false, error: data.error || res.statusText };
      return { ok: true, session: data.session };
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'Server unreachable' };
    }
  },

  // ── Employee invites ──────────────────────────────────────────────────────
  async listInvites(orgId: string): Promise<EmployeeInvite[] | null> {
    const result = await apiFetch<{ invites: EmployeeInvite[] }>(`/api/invites${qs({ orgId })}`);
    return result?.invites ?? null;
  },

  async createInvite(body: {
    orgId: string;
    email: string;
    orgName?: string;
    name?: string;
    designation?: string;
    department?: string;
    ctc?: number;
    doj?: string;
    employeeType?: string;
    expiresDays?: number;
    appBaseUrl?: string;
  }): Promise<{
    ok: boolean;
    invite?: EmployeeInvite & { inviteUrl?: string };
    emailSent?: boolean;
    error?: string;
  }> {
    try {
      const result = await apiFetch<{
        ok: boolean;
        invite: EmployeeInvite & { inviteUrl?: string };
        emailSent?: boolean;
        error?: string;
      }>('/api/invites', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!result) return { ok: false, error: 'Server unreachable. Start the API with npm run server.' };
      return result;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async deleteInvite(orgId: string, inviteId: string): Promise<boolean> {
    const result = await apiFetch<{ ok: boolean }>(
      `/api/invites/${encodeURIComponent(inviteId)}${qs({ orgId })}`,
      { method: 'DELETE' },
    );
    return result?.ok ?? false;
  },

  async getInviteByToken(token: string): Promise<{
    invite?: {
      email: string;
      orgId: string;
      orgName: string;
      name?: string;
      designation?: string;
      department?: string;
      ctc?: number;
      doj?: string;
      employeeType?: string;
      expiresAt: string;
      status: string;
    };
    error?: string;
  }> {
    try {
      const res = await fetch(`${BASE}/api/invites/token/${encodeURIComponent(token)}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json() as { invite?: Record<string, unknown>; error?: string };
      if (!res.ok) return { error: data.error || res.statusText };
      return { invite: data.invite as never };
    } catch (e) {
      return { error: (e as Error).message || 'Server unreachable' };
    }
  },

  async completeInvite(token: string, profile: Record<string, unknown>): Promise<{
    ok: boolean;
    employeeId?: string;
    error?: string;
  }> {
    try {
      const res = await fetch(`${BASE}/api/invites/token/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json() as { ok?: boolean; employeeId?: string; error?: string };
      if (!res.ok) return { ok: false, error: data.error || res.statusText };
      return { ok: true, employeeId: data.employeeId };
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'Server unreachable' };
    }
  },
};
