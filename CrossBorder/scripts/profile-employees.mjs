import Database from 'better-sqlite3';

const db = new Database('data/suez.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(JSON.stringify({ tables: tables.map((t) => t.name) }, null, 2));

const emps = db.prepare('SELECT id, org_id, name, status, data FROM employees').all();
const statuses = {};
const types = {};
const depts = {};
let panMissing = 0;
let bankMissing = 0;
let taxMissing = 0;
const samples = [];

for (const row of emps) {
  statuses[row.status] = (statuses[row.status] || 0) + 1;
  let d = {};
  try {
    d = JSON.parse(row.data);
  } catch {
    d = {};
  }
  const t = d.employeeType || 'unknown';
  types[t] = (types[t] || 0) + 1;
  const dept = d.department || 'unset';
  depts[dept] = (depts[dept] || 0) + 1;
  if (!d.panNumber) panMissing += 1;
  if (!d.bankAccountNumber || !d.bankIFSC) bankMissing += 1;
  if (!d.taxRegime) taxMissing += 1;
  if (samples.length < 3) {
    samples.push({
      id: row.id,
      name: row.name,
      status: row.status,
      employeeType: d.employeeType,
      department: d.department,
      hasPan: Boolean(d.panNumber),
      hasBank: Boolean(d.bankAccountNumber && d.bankIFSC),
      taxRegime: d.taxRegime,
      salaryRevisions: (d.salaryRevisions || []).length,
    });
  }
}

let leaveCount = 0;
let attendanceCount = 0;
try {
  const orgRows = db.prepare("SELECT key, length(value) as len FROM kv_store WHERE key LIKE '%org%' OR key LIKE '%leave%' OR key LIKE '%attend%' OR key LIKE '%employee%' LIMIT 40").all();
  console.log(JSON.stringify({ kv_keys: orgRows }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ kv_error: String(e.message) }));
}

try {
  const orgs = db.prepare('SELECT id, data FROM organisations').all();
  for (const o of orgs) {
    const data = JSON.parse(o.data);
    leaveCount += (data.leaveRequests || []).length;
    attendanceCount += (data.attendance || []).length;
  }
} catch {
  /* organisations table may differ */
}

console.log(
  JSON.stringify(
    {
      employee_count: emps.length,
      statuses,
      employee_types: types,
      departments: depts,
      pan_missing: panMissing,
      bank_incomplete: bankMissing,
      tax_regime_missing: taxMissing,
      samples,
      leave_requests_in_orgs: leaveCount,
      attendance_in_orgs: attendanceCount,
    },
    null,
    2,
  ),
);
db.close();
