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
    expect(patch).not.toHaveProperty('ctc');
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('email');
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
});
