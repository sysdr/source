/**
 * Find and merge duplicate employees (existing directory vs invite onboarding).
 * Implements OQ-E-002 / OQ-E-003: match by email or exact name; merge onto survivor.
 */

import type { Employee } from '../types';

const PII_FILL_KEYS = [
  'phone',
  'panNumber',
  'aadhaarNumber',
  'uan',
  'esiNumber',
  'bankAccountNumber',
  'bankIFSC',
  'bankName',
  'address',
  'fatherOrSpouseName',
  'gender',
  'dateOfBirth',
  'taxRegime',
  'employeeType',
  'department',
  'designation',
  'reportingManager',
] as const;

type PiiFillKey = (typeof PII_FILL_KEYS)[number];

export function normalizeEmployeeEmail(email: string | undefined | null): string {
  return (email ?? '').trim().toLowerCase();
}

export function normalizeEmployeeName(name: string | undefined | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/** Prefer Active/Notice over Onboarding/Inactive when choosing the survivor. */
const STATUS_RANK: Record<Employee['status'], number> = {
  Active: 5,
  Notice: 4,
  Inactive: 3,
  Exited: 2,
  Onboarding: 1,
  Archived: 0,
};

export type DuplicateMatchReason = 'email' | 'name' | 'pan';

export interface DuplicatePair {
  reason: DuplicateMatchReason;
  key: string;
  survivorId: string;
  duplicateId: string;
  employees: [Employee, Employee];
}

export function chooseSurvivor(a: Employee, b: Employee): Employee {
  const rankDiff = (STATUS_RANK[a.status] ?? 0) - (STATUS_RANK[b.status] ?? 0);
  if (rankDiff !== 0) return rankDiff > 0 ? a : b;
  if ((a.ctc ?? 0) !== (b.ctc ?? 0)) return (a.ctc ?? 0) > (b.ctc ?? 0) ? a : b;
  // Stable: prefer older/stable EMP-* ids over UUID invitees when ranks tie
  const aInvite = Boolean(a.onboardedViaInviteAt);
  const bInvite = Boolean(b.onboardedViaInviteAt);
  if (aInvite !== bInvite) return aInvite ? b : a;
  return a.id <= b.id ? a : b;
}

/**
 * Merge `donor` into `survivor`. Keeps survivor id/status/email/ctc when set;
 * fills blank PII and invite metadata from donor.
 */
export function mergeEmployeeRecords(survivor: Employee, donor: Employee): Employee {
  const merged: Employee = { ...survivor };

  for (const key of PII_FILL_KEYS) {
    if (isBlank(merged[key]) && !isBlank(donor[key])) {
      (merged as Record<PiiFillKey, unknown>)[key] = donor[key];
    }
  }

  if ((merged.ctc ?? 0) <= 1 && (donor.ctc ?? 0) > 1) {
    merged.ctc = donor.ctc;
  }

  if (isBlank(merged.doj) && !isBlank(donor.doj)) {
    merged.doj = donor.doj;
  }

  merged.documents = {
    pan: Boolean(survivor.documents?.pan || donor.documents?.pan || merged.panNumber),
    aadhaar: Boolean(survivor.documents?.aadhaar || donor.documents?.aadhaar || merged.aadhaarNumber),
    contract: Boolean(survivor.documents?.contract || donor.documents?.contract),
  };

  if (!merged.inviteId && donor.inviteId) merged.inviteId = donor.inviteId;
  if (!merged.onboardedViaInviteAt && donor.onboardedViaInviteAt) {
    merged.onboardedViaInviteAt = donor.onboardedViaInviteAt;
  }

  const survivorDocs = survivor.uploadedDocuments ?? [];
  const donorDocs = donor.uploadedDocuments ?? [];
  if (donorDocs.length > survivorDocs.length) {
    merged.uploadedDocuments = [...survivorDocs, ...donorDocs.filter(
      (d) => !survivorDocs.some((s) => s.kind === d.kind && s.dataUrl === d.dataUrl),
    )];
  }

  if ((donor.salaryRevisions?.length ?? 0) > 0) {
    const existing = survivor.salaryRevisions ?? [];
    const seen = new Set(existing.map((r) => `${r.effectiveDate}:${r.newCTC}:${r.reason}`));
    merged.salaryRevisions = [
      ...existing,
      ...(donor.salaryRevisions ?? []).filter(
        (r) => !seen.has(`${r.effectiveDate}:${r.newCTC}:${r.reason}`),
      ),
    ];
  }

  return merged;
}

export function findDuplicateEmployee(
  candidates: Employee[],
  probe: { email?: string; name?: string; panNumber?: string; excludeId?: string },
): { match: Employee; reason: DuplicateMatchReason } | null {
  const email = normalizeEmployeeEmail(probe.email);
  const name = normalizeEmployeeName(probe.name);
  const pan = (probe.panNumber ?? '').replace(/\s/g, '').toUpperCase();

  const pool = candidates.filter(
    (e) => e.id !== probe.excludeId && e.status !== 'Archived',
  );

  if (email) {
    const byEmail = pool.find((e) => normalizeEmployeeEmail(e.email) === email);
    if (byEmail) return { match: byEmail, reason: 'email' };
  }
  if (pan) {
    const byPan = pool.find(
      (e) => (e.panNumber ?? '').replace(/\s/g, '').toUpperCase() === pan,
    );
    if (byPan) return { match: byPan, reason: 'pan' };
  }
  if (name) {
    const byName = pool.find((e) => normalizeEmployeeName(e.name) === name);
    if (byName) return { match: byName, reason: 'name' };
  }
  return null;
}

/** Pair every duplicate group in a directory (email, then PAN, then exact name). */
export function findDuplicatePairs(employees: Employee[]): DuplicatePair[] {
  const active = employees.filter((e) => e.status !== 'Archived');
  const pairs: DuplicatePair[] = [];
  const claimed = new Set<string>();

  const groupBy = (
    reason: DuplicateMatchReason,
    keyFn: (e: Employee) => string,
  ) => {
    const map = new Map<string, Employee[]>();
    for (const e of active) {
      const key = keyFn(e);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    for (const [key, group] of map) {
      if (group.length < 2) continue;
      const unclaimed = group.filter((e) => !claimed.has(e.id));
      if (unclaimed.length < 2) continue;
      const survivor = unclaimed.reduce((a, b) => chooseSurvivor(a, b));
      for (const dup of unclaimed) {
        if (dup.id === survivor.id) continue;
        claimed.add(dup.id);
        pairs.push({
          reason,
          key,
          survivorId: survivor.id,
          duplicateId: dup.id,
          employees: [survivor, dup],
        });
      }
      claimed.add(survivor.id);
    }
  };

  groupBy('email', (e) => normalizeEmployeeEmail(e.email));
  groupBy('pan', (e) => (e.panNumber ?? '').replace(/\s/g, '').toUpperCase());
  groupBy('name', (e) => normalizeEmployeeName(e.name));

  return pairs;
}

/** Apply all duplicate merges; returns survivors list and removed ids. */
export function mergeAllDuplicates(employees: Employee[]): {
  employees: Employee[];
  merged: Array<{ survivorId: string; removedId: string; reason: DuplicateMatchReason }>;
} {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const merged: Array<{ survivorId: string; removedId: string; reason: DuplicateMatchReason }> = [];
  const pairs = findDuplicatePairs([...byId.values()]);

  for (const pair of pairs) {
    const survivor = byId.get(pair.survivorId);
    const donor = byId.get(pair.duplicateId);
    if (!survivor || !donor) continue;
    byId.set(survivor.id, mergeEmployeeRecords(survivor, donor));
    byId.delete(donor.id);
    merged.push({
      survivorId: survivor.id,
      removedId: donor.id,
      reason: pair.reason,
    });
  }

  return { employees: [...byId.values()], merged };
}
