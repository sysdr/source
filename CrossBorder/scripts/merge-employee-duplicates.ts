/**
 * One-shot: find Active↔Onboarding duplicates in an org and merge them.
 * Usage: npx tsx --env-file-if-exists=.env scripts/merge-employee-duplicates.ts [orgId]
 */
import {
  getEmployees,
  upsertEmployee,
  deleteEmployee,
  listInvites,
  updateInviteStatus,
  checkpointDatabase,
} from '../server/db.ts';
import { decryptEmployeePII, encryptEmployeePII } from '../server/pii.ts';
import { findDuplicatePairs, mergeAllDuplicates } from '../services/employeeDuplicateMerge.ts';
import { rebuildKvFromDomain } from '../server/rebuildKv.ts';
import type { Employee } from '../types.ts';

const orgId = process.argv[2] ?? 'org-1769926725440';

const employees = getEmployees(orgId).map((e) => decryptEmployeePII(e) as Employee);
console.log(`[merge] org=${orgId} employees=${employees.length}`);

const pairs = findDuplicatePairs(employees);
if (pairs.length === 0) {
  console.log('[merge] no duplicates found');
  process.exit(0);
}

for (const p of pairs) {
  console.log(
    `[merge] ${p.reason}=${p.key} survivor=${p.survivorId} remove=${p.duplicateId}`,
  );
}

const { employees: mergedList, merged } = mergeAllDuplicates(employees);

for (const op of merged) {
  const survivor = mergedList.find((e) => e.id === op.survivorId);
  if (!survivor) continue;
  upsertEmployee(orgId, encryptEmployeePII(survivor as unknown as Record<string, unknown>));
  deleteEmployee(orgId, op.removedId);
  console.log(
    `[merge] wrote ${survivor.id} (${survivor.name}) status=${survivor.status} phone=${survivor.phone || '-'}`,
  );
}

for (const inv of listInvites(orgId)) {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(inv.data) as Record<string, unknown>;
  } catch {
    /* */
  }
  for (const op of merged) {
    if (data.employeeId !== op.removedId) continue;
    updateInviteStatus(inv.token, inv.status, {
      employeeId: op.survivorId,
      mergedIntoExisting: true,
      mergeReason: op.reason,
      previousEmployeeId: op.removedId,
    });
    console.log(`[merge] invite ${inv.email} -> ${op.survivorId}`);
  }
}

const summary = rebuildKvFromDomain();
checkpointDatabase();
console.log(`[merge] done removed=${merged.length} kv employees=${summary.employees}`);
