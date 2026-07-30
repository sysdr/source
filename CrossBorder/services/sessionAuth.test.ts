/** Session auth + role tab gating */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loginAsAdmin,
  loginAsEmployee,
  logoutAppSession,
  getAppSession,
  isTabAllowedForSession,
  EMPLOYEE_DEFAULT_TAB,
  ADMIN_DEFAULT_TAB,
} from './sessionAuth';

describe('sessionAuth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('logs in admin and allows admin tabs only', () => {
    const s = loginAsAdmin('Test Admin');
    expect(s.role).toBe('admin');
    expect(getAppSession()?.displayName).toBe('Test Admin');
    expect(isTabAllowedForSession('dashboard', s)).toBe(true);
    expect(isTabAllowedForSession('people', s)).toBe(true);
    expect(isTabAllowedForSession(EMPLOYEE_DEFAULT_TAB, s)).toBe(false);
  });

  it('logs in employee and restricts to employee tabs', () => {
    const s = loginAsEmployee({
      employeeId: 'EMP-1',
      displayName: 'Ada',
      email: 'ada@example.com',
    });
    expect(s.role).toBe('employee');
    expect(isTabAllowedForSession('emp-home', s)).toBe(true);
    expect(isTabAllowedForSession('emp-pay', s)).toBe(true);
    expect(isTabAllowedForSession('dashboard', s)).toBe(false);
    expect(isTabAllowedForSession('admin', s)).toBe(false);
    expect(ADMIN_DEFAULT_TAB).toBe('dashboard');
  });

  it('clears session on logout', () => {
    loginAsAdmin();
    logoutAppSession();
    expect(getAppSession()).toBeNull();
  });
});
