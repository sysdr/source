/**
 * REQ: REQ-090 (self-service allowlist) / document flags
 * Mutation-strong suite for employeeSelfService (RW-009b).
 */
import { describe, expect, it } from 'vitest';
import {
  applyDocumentFlagsFromPatch,
  pickEmployeeSelfPatch,
} from './employeeSelfService';
import type { Employee } from '../types';

const baseEmp: Employee = {
  id: 'E1',
  name: 'Alex',
  designation: 'Engineer',
  ctc: 1200000,
  doj: '2024-01-01',
  status: 'Active',
  email: 'alex@example.com',
  documents: { pan: false, aadhaar: false, contract: true },
};

describe('employeeSelfService', () => {
  it('picks only allowlisted self-service fields', () => {
    const patch = pickEmployeeSelfPatch({
      name: 'Alex Updated',
      phone: '9999999999',
      ctc: 9999999,
      status: 'Exited',
      designation: 'CTO',
      email: 'hacker@evil.com',
      bankIFSC: 'HDFC0001234',
    });
    expect(patch).toEqual({
      name: 'Alex Updated',
      phone: '9999999999',
      bankIFSC: 'HDFC0001234',
    });
    expect(Object.keys(patch).sort()).toEqual(['bankIFSC', 'name', 'phone']);
    expect(patch).not.toHaveProperty('ctc');
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('email');
  });

  it('skips explicit undefined values and keys absent from the input', () => {
    const patch = pickEmployeeSelfPatch({
      name: undefined,
      phone: '1',
    });
    expect(patch).toEqual({ phone: '1' });
    expect(patch).not.toHaveProperty('name');
    expect(patch).not.toHaveProperty('panNumber');
  });

  it('marks PAN/Aadhaar document flags when numbers are provided', () => {
    const docs = applyDocumentFlagsFromPatch(baseEmp, {
      panNumber: 'ABCDE1234F',
      aadhaarNumber: '123456789012',
    });
    expect(docs.pan).toBe(true);
    expect(docs.aadhaar).toBe(true);
    expect(docs.contract).toBe(true);
  });

  it('does not set PAN from Aadhaar-only patches (and vice versa)', () => {
    const panOnly = applyDocumentFlagsFromPatch(baseEmp, { panNumber: 'ABCDE1234F' });
    expect(panOnly.pan).toBe(true);
    expect(panOnly.aadhaar).toBe(false);

    const aadhaarOnly = applyDocumentFlagsFromPatch(baseEmp, { aadhaarNumber: '123456789012' });
    expect(aadhaarOnly.pan).toBe(false);
    expect(aadhaarOnly.aadhaar).toBe(true);
  });

  it('ignores whitespace-only and non-string identity numbers', () => {
    const blank = applyDocumentFlagsFromPatch(baseEmp, {
      panNumber: '   ',
      aadhaarNumber: '\t\n',
    });
    expect(blank.pan).toBe(false);
    expect(blank.aadhaar).toBe(false);

    const nonString = applyDocumentFlagsFromPatch(baseEmp, {
      panNumber: 12345 as unknown as string,
      aadhaarNumber: null as unknown as string,
    });
    expect(nonString.pan).toBe(false);
    expect(nonString.aadhaar).toBe(false);
  });

  it('preserves existing document flags when patch has no identity fields', () => {
    const withDocs = {
      ...baseEmp,
      documents: { pan: true, aadhaar: true, contract: false },
    };
    const docs = applyDocumentFlagsFromPatch(withDocs, { phone: '9' });
    expect(docs).toEqual({ pan: true, aadhaar: true, contract: false });
  });

  it('defaults document flags when employee has none', () => {
    const bare = { ...baseEmp, documents: undefined as unknown as Employee['documents'] };
    const docs = applyDocumentFlagsFromPatch(bare, { panNumber: 'ABCDE1234F' });
    expect(docs.pan).toBe(true);
    expect(docs.aadhaar).toBe(false);
    expect(docs.contract).toBe(false);
  });
});
