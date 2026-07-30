/**
 * Browser session for Admin vs Employee portals.
 * Maps to X-SUEZ-ROLE: admin → owner, employee → employee.
 * Persisted in localStorage so magic-link redirects and refreshes keep the session.
 */

import { setAccessRole } from './apiClient';

const SESSION_KEY = 'suez_app_session';

export type AppUserRole = 'admin' | 'employee';

export interface AppSession {
  role: AppUserRole;
  displayName: string;
  email?: string;
  employeeId?: string;
  orgId?: string;
  loggedInAt: string;
}

function readStore(): Storage {
  try {
    return localStorage;
  } catch {
    return sessionStorage;
  }
}

export function getAppSession(): AppSession | null {
  try {
    const store = readStore();
    let raw = store.getItem(SESSION_KEY);
    // Migrate legacy sessionStorage sessions once
    if (!raw) {
      try {
        raw = sessionStorage.getItem(SESSION_KEY);
        if (raw) {
          store.setItem(SESSION_KEY, raw);
          sessionStorage.removeItem(SESSION_KEY);
        }
      } catch { /* ignore */ }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppSession;
    if (parsed.role !== 'admin' && parsed.role !== 'employee') return null;
    if (parsed.role === 'employee' && !parsed.employeeId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return getAppSession() !== null;
}

export function loginAsAdmin(displayName = 'Admin', email?: string, orgId?: string): AppSession {
  const session: AppSession = {
    role: 'admin',
    displayName,
    email,
    orgId,
    loggedInAt: new Date().toISOString(),
  };
  readStore().setItem(SESSION_KEY, JSON.stringify(session));
  setAccessRole('owner');
  return session;
}

export function loginAsEmployee(input: {
  employeeId: string;
  displayName: string;
  email?: string;
  orgId?: string;
}): AppSession {
  const session: AppSession = {
    role: 'employee',
    displayName: input.displayName,
    email: input.email,
    employeeId: input.employeeId,
    orgId: input.orgId,
    loggedInAt: new Date().toISOString(),
  };
  readStore().setItem(SESSION_KEY, JSON.stringify(session));
  setAccessRole('employee');
  return session;
}

export function logoutAppSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  setAccessRole('owner');
}

export const ADMIN_DEFAULT_TAB = 'dashboard';
export const EMPLOYEE_DEFAULT_TAB = 'emp-home';

export const EMPLOYEE_TAB_IDS = [
  'emp-home',
  'emp-profile',
  'emp-pay',
  'emp-leave',
] as const;

export type EmployeeTabId = (typeof EMPLOYEE_TAB_IDS)[number];

export function isEmployeeTab(tab: string): boolean {
  return (EMPLOYEE_TAB_IDS as readonly string[]).includes(tab);
}

export function isTabAllowedForSession(tab: string, session: AppSession | null): boolean {
  if (!session) return false;
  if (session.role === 'admin') return !isEmployeeTab(tab);
  return isEmployeeTab(tab);
}
