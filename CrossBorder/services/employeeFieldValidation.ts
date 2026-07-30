/**
 * Shared employee field validation (REQ-037 / T-021).
 * Aligns directory edit/add UX with payroll pre-validation (REQ-059).
 */
import type { Employee } from '../types';

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const AADHAAR_RE = /^\d{12}$/;

export type EmployeeFieldCode =
  | 'MISSING_NAME'
  | 'MISSING_EMAIL'
  | 'INVALID_EMAIL'
  | 'MISSING_PAN'
  | 'INVALID_PAN'
  | 'MISSING_BANK_ACCOUNT'
  | 'MISSING_BANK_IFSC'
  | 'INVALID_BANK_IFSC'
  | 'MISSING_TAX_REGIME'
  | 'INVALID_CTC'
  | 'INVALID_AADHAAR'
  | 'INACTIVE_STATUS';

export interface EmployeeFieldIssue {
  code: EmployeeFieldCode;
  message: string;
}

export interface EmployeeFieldValidationResult {
  ok: boolean;
  issues: EmployeeFieldIssue[];
  messages: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize identity / bank fields before validate or persist. */
export function normalizeEmployeeFields<T extends Partial<Employee>>(emp: T): T {
  return {
    ...emp,
    panNumber: emp.panNumber != null
      ? String(emp.panNumber).replace(/\s+/g, '').toUpperCase()
      : emp.panNumber,
    bankIFSC: emp.bankIFSC != null
      ? String(emp.bankIFSC).replace(/\s+/g, '').toUpperCase()
      : emp.bankIFSC,
    aadhaarNumber: emp.aadhaarNumber != null
      ? String(emp.aadhaarNumber).replace(/\s+/g, '')
      : emp.aadhaarNumber,
    bankAccountNumber: emp.bankAccountNumber != null
      ? String(emp.bankAccountNumber).replace(/\s+/g, '')
      : emp.bankAccountNumber,
  };
}

export type EmployeeValidationScope = 'core' | 'full';

/**
 * Validate employee fields for directory save.
 *
 * - `scope: 'core'` — name, email, CTC only (admin edits / CTC changes).
 *   Related identity/bank fields never block save.
 * - `scope: 'full'` (default) — also format-check related fields when present;
 *   when status is Active (or requirePayrollReady), require payroll-ready fields.
 *   Use at payroll run time, not for admin CTC edits.
 */
export function validateEmployeeFields(
  emp: Partial<Employee>,
  options: {
    requirePayrollReady?: boolean;
    /** Admin directory updates use 'core' so CTC saves are not blocked by PAN/bank gaps. */
    scope?: EmployeeValidationScope;
  } = {},
): EmployeeFieldValidationResult {
  const normalized = normalizeEmployeeFields(emp);
  const issues: EmployeeFieldIssue[] = [];
  const scope = options.scope ?? 'full';
  const payrollReady = scope === 'full'
    && (options.requirePayrollReady === true || normalized.status === 'Active');

  if (!normalized.name?.trim()) {
    issues.push({ code: 'MISSING_NAME', message: 'Name is required' });
  }
  if (!normalized.email?.trim()) {
    issues.push({ code: 'MISSING_EMAIL', message: 'Email is required' });
  } else if (!EMAIL_RE.test(normalized.email.trim())) {
    issues.push({ code: 'INVALID_EMAIL', message: 'Email format is invalid' });
  }

  const ctc = Number(normalized.ctc);
  if (!(ctc > 0)) {
    issues.push({ code: 'INVALID_CTC', message: 'CTC must be greater than 0' });
  }

  // Related fields: never block admin/core saves (CTC / directory edits).
  if (scope === 'core') {
    return {
      ok: issues.length === 0,
      issues,
      messages: issues.map((i) => i.message),
    };
  }

  const pan = (normalized.panNumber || '').trim();
  if (payrollReady) {
    if (!pan) {
      issues.push({ code: 'MISSING_PAN', message: 'PAN is required for Active employees (Form 24Q)' });
    } else if (!PAN_RE.test(pan)) {
      issues.push({ code: 'INVALID_PAN', message: 'PAN must match format AAAAA9999A' });
    }
  } else if (pan && !PAN_RE.test(pan)) {
    issues.push({ code: 'INVALID_PAN', message: 'PAN must match format AAAAA9999A' });
  }

  const account = (normalized.bankAccountNumber || '').trim();
  const ifsc = (normalized.bankIFSC || '').trim();
  if (payrollReady) {
    if (!account) {
      issues.push({ code: 'MISSING_BANK_ACCOUNT', message: 'Bank account number is required for Active employees' });
    }
    if (!ifsc) {
      issues.push({ code: 'MISSING_BANK_IFSC', message: 'Bank IFSC is required for Active employees' });
    } else if (!IFSC_RE.test(ifsc)) {
      issues.push({ code: 'INVALID_BANK_IFSC', message: 'IFSC must match format AAAA0XXXXXX' });
    }
  } else if (ifsc && !IFSC_RE.test(ifsc)) {
    issues.push({ code: 'INVALID_BANK_IFSC', message: 'IFSC must match format AAAA0XXXXXX' });
  }

  if (payrollReady) {
    if (normalized.taxRegime !== 'new' && normalized.taxRegime !== 'old') {
      issues.push({ code: 'MISSING_TAX_REGIME', message: 'Tax regime (new|old) must be selected for Active employees' });
    }
  }

  const aadhaar = (normalized.aadhaarNumber || '').trim();
  if (aadhaar && !AADHAAR_RE.test(aadhaar)) {
    issues.push({ code: 'INVALID_AADHAAR', message: 'Aadhaar must be 12 digits' });
  }

  return {
    ok: issues.length === 0,
    issues,
    messages: issues.map((i) => i.message),
  };
}
