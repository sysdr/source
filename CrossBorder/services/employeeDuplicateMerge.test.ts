import { describe, expect, it } from 'vitest';
import type { Employee } from '../types';
import {
  chooseSurvivor,
  findDuplicateEmployee,
  findDuplicatePairs,
  mergeAllDuplicates,
  mergeEmployeeRecords,
  normalizeEmployeeName,
} from './employeeDuplicateMerge';

const base = (over: Partial<Employee>): Employee => ({
  id: over.id ?? 'e1',
  name: over.name ?? 'Divya Pendem',
  designation: over.designation ?? 'Intern',
  ctc: over.ctc ?? 108000,
  doj: over.doj ?? '2025-09-01',
  status: over.status ?? 'Active',
  email: over.email ?? 'divyap@systemdrd.com',
  documents: over.documents ?? { pan: false, aadhaar: false, contract: false },
  ...over,
});

describe('employeeDuplicateMerge', () => {
  it('normalizes names for exact match', () => {
    expect(normalizeEmployeeName('  Divya   Pendem ')).toBe('divya pendem');
  });

  it('prefers Active over Onboarding as survivor', () => {
    const active = base({ id: 'a', status: 'Active' });
    const onb = base({ id: 'b', status: 'Onboarding', email: 'other@x.com', ctc: 1 });
    expect(chooseSurvivor(active, onb).id).toBe('a');
    expect(chooseSurvivor(onb, active).id).toBe('a');
  });

  it('merges blank PII from onboarding donor into active survivor', () => {
    const survivor = base({
      id: 'EMP-1',
      status: 'Active',
      phone: '',
      aadhaarNumber: '',
      designation: 'Intern',
    });
    const donor = base({
      id: 'uuid-1',
      status: 'Onboarding',
      email: 'systemdrllp5@gmail.com',
      ctc: 1,
      phone: '9326631228',
      aadhaarNumber: '824027118774',
      bankName: 'Union Bank Of India',
      designation: 'Software Engineer',
      inviteId: 'inv-1',
      onboardedViaInviteAt: '2026-07-30T10:45:30.204Z',
      documents: { pan: false, aadhaar: true, contract: false },
    });
    const merged = mergeEmployeeRecords(survivor, donor);
    expect(merged.id).toBe('EMP-1');
    expect(merged.status).toBe('Active');
    expect(merged.email).toBe('divyap@systemdrd.com');
    expect(merged.ctc).toBe(108000);
    expect(merged.phone).toBe('9326631228');
    expect(merged.aadhaarNumber).toBe('824027118774');
    expect(merged.bankName).toBe('Union Bank Of India');
    expect(merged.designation).toBe('Intern'); // survivor designation kept when set
    expect(merged.inviteId).toBe('inv-1');
    expect(merged.documents.aadhaar).toBe(true);
  });

  it('finds duplicate by email then name', () => {
    const existing = [base({ id: 'a', email: 'a@co.com', name: 'Divya Pendem' })];
    expect(findDuplicateEmployee(existing, { email: 'A@CO.com' })?.reason).toBe('email');
    expect(findDuplicateEmployee(existing, { name: 'divya pendem' })?.reason).toBe('name');
    expect(findDuplicateEmployee(existing, { email: 'x@y.com', name: 'Other' })).toBeNull();
  });

  it('mergeAllDuplicates collapses Active+Onboarding same name', () => {
    const employees = [
      base({ id: 'EMP-1', status: 'Active', email: 'divyap@systemdrd.com', ctc: 108000 }),
      base({
        id: 'uuid-onb',
        status: 'Onboarding',
        email: 'systemdrllp5@gmail.com',
        ctc: 1,
        phone: '9326631228',
      }),
      base({ id: 'EMP-2', name: 'Other Person', email: 'o@co.com', status: 'Active' }),
    ];
    const result = mergeAllDuplicates(employees);
    expect(result.merged).toEqual([
      { survivorId: 'EMP-1', removedId: 'uuid-onb', reason: 'name' },
    ]);
    expect(result.employees).toHaveLength(2);
    const divya = result.employees.find((e) => e.id === 'EMP-1')!;
    expect(divya.phone).toBe('9326631228');
    expect(divya.status).toBe('Active');
  });

  it('findDuplicatePairs reports cross-status name match', () => {
    const pairs = findDuplicatePairs([
      base({ id: 'a', status: 'Active' }),
      base({ id: 'b', status: 'Onboarding', email: 'other@x.com', ctc: 1 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reason).toBe('name');
    expect(pairs[0].survivorId).toBe('a');
  });
});
