import { describe, expect, it } from 'vitest';
import {
  normalizeEmployeeFields,
  validateEmployeeFields,
} from './employeeFieldValidation';

describe('employeeFieldValidation (REQ-037 / T-021)', () => {
  it('normalizes PAN, IFSC, and Aadhaar', () => {
    const n = normalizeEmployeeFields({
      panNumber: 'abcde1234f',
      bankIFSC: 'hdfc 0001234',
      aadhaarNumber: '1234 5678 9012',
    });
    expect(n.panNumber).toBe('ABCDE1234F');
    expect(n.bankIFSC).toBe('HDFC0001234');
    expect(n.aadhaarNumber).toBe('123456789012');
  });

  it('allows onboarding without payroll fields', () => {
    const result = validateEmployeeFields({
      name: 'Onboard',
      email: 'o@example.com',
      ctc: 500000,
      status: 'Onboarding',
      taxRegime: 'new',
    });
    expect(result.ok).toBe(true);
  });

  it('requires PAN/bank/tax regime for Active employees', () => {
    const result = validateEmployeeFields({
      name: 'Active',
      email: 'a@example.com',
      ctc: 500000,
      status: 'Active',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['MISSING_PAN', 'MISSING_BANK_ACCOUNT', 'MISSING_BANK_IFSC', 'MISSING_TAX_REGIME']),
    );
  });

  it('accepts a complete Active employee', () => {
    const result = validateEmployeeFields({
      name: 'Complete',
      email: 'c@example.com',
      ctc: 900000,
      status: 'Active',
      panNumber: 'ABCDE1234F',
      bankAccountNumber: '1234567890',
      bankIFSC: 'HDFC0001234',
      taxRegime: 'new',
    });
    expect(result.ok).toBe(true);
  });
});
