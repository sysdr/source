/**
 * Employee self-service profile field allowlist.
 * HR-owned fields (CTC, status, designation, etc.) are never writable here.
 */

import type { Employee } from '../types';

export const EMPLOYEE_SELF_EDITABLE_KEYS = [
  'name',
  'phone',
  'address',
  'dateOfBirth',
  'gender',
  'fatherOrSpouseName',
  'panNumber',
  'aadhaarNumber',
  'uan',
  'esiNumber',
  'bankAccountNumber',
  'bankIFSC',
  'bankName',
  'taxRegime',
  'section80C',
  'section80D',
  'hraExemptionRent',
] as const;

export type EmployeeSelfEditableKey = (typeof EMPLOYEE_SELF_EDITABLE_KEYS)[number];

export type EmployeeSelfPatch = Partial<Pick<Employee, EmployeeSelfEditableKey>>;

export function pickEmployeeSelfPatch(input: Record<string, unknown>): EmployeeSelfPatch {
  const out: EmployeeSelfPatch = {};
  for (const key of EMPLOYEE_SELF_EDITABLE_KEYS) {
    if (!(key in input)) continue;
    const value = input[key];
    if (value === undefined) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** When PAN/Aadhaar numbers are provided, mark the matching document flags. */
export function applyDocumentFlagsFromPatch(
  existing: Employee,
  patch: EmployeeSelfPatch,
): Employee['documents'] {
  const docs = { ...(existing.documents || { pan: false, aadhaar: false, contract: false }) };
  const pan = typeof patch.panNumber === 'string' ? patch.panNumber.trim() : undefined;
  const aadhaar = typeof patch.aadhaarNumber === 'string' ? patch.aadhaarNumber.trim() : undefined;
  if (pan && pan.length > 0) docs.pan = true;
  if (aadhaar && aadhaar.length > 0) docs.aadhaar = true;
  return docs;
}
