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

  it('requires PAN/bank/tax regime for Active employees (full scope)', () => {
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

  it('allows admin CTC update without related-field errors (core scope)', () => {
    const result = validateEmployeeFields({
      name: 'Divya Pendem',
      email: 'divyap@systemdrd.com',
      ctc: 150000,
      status: 'Active',
      panNumber: '',
      bankAccountNumber: '',
      bankIFSC: 'BAD',
      aadhaarNumber: '123',
    }, { scope: 'core' });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('core scope still rejects invalid CTC / missing name', () => {
    const result = validateEmployeeFields({
      name: '',
      email: 'a@example.com',
      ctc: 0,
      status: 'Active',
    }, { scope: 'core' });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['MISSING_NAME', 'INVALID_CTC']),
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
