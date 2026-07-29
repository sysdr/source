/**
 * Rebuild kv_store from domain tables so a cloned repo + running API
 * hydrates the browser with the full org (employees, ledger, SMTP, etc.).
 */
import {
  getAllKV,
  setKV,
  getEmployees,
  getAllTransactionsForOrg,
  getPayrollRuns,
  getInvoicesDB,
  getAllOrgData,
  getOrgData,
  setOrgData,
  listInvites,
  getTransactionCount,
} from './db.js';

const PRIMARY_ORG_CANDIDATES = [
  'org-1769926725440',
  'org-1780217842949',
];

function unwrapOrgId(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let id = raw.trim();
  // Fix accidental JSON-quoted ids stored as "\"org-...\""
  if ((id.startsWith('"') && id.endsWith('"')) || (id.startsWith("'") && id.endsWith("'"))) {
    try { id = JSON.parse(id) as string; } catch { id = id.slice(1, -1); }
  }
  return id || null;
}

function pickPrimaryOrgId(kv: Record<string, unknown>): string {
  const fromKv = unwrapOrgId(kv.suez_active_org_id);
  if (fromKv && fromKv !== 'default' && getTransactionCount(fromKv, false) > 0) {
    return fromKv;
  }

  let best = fromKv || PRIMARY_ORG_CANDIDATES[0];
  let bestCount = 0;
  const seen = new Set<string>([
    ...PRIMARY_ORG_CANDIDATES,
    ...(fromKv ? [fromKv] : []),
  ]);

  const orgsBlob = kv.suez_organisations as
    | { activeOrgId?: string; organisations?: Record<string, unknown> }
    | undefined;
  if (orgsBlob?.organisations) {
    for (const id of Object.keys(orgsBlob.organisations)) seen.add(id);
  }
  for (const id of [...seen]) {
    const count = getTransactionCount(id, false);
    if (count > bestCount) {
      bestCount = count;
      best = id;
    }
  }
  if (bestCount === 0) {
    for (const id of seen) {
      if (getEmployees(id).length > 0) return id;
    }
  }
  return best;
}

function mergeSmtp(orgId: string): Record<string, unknown> | null {
  const direct = getOrgData(orgId, 'suez_smtp_settings') as Record<string, unknown> | null;
  if (direct && typeof direct.host === 'string' && direct.host) return direct;
  for (const alt of ['org-1780217842949', 'org-1769926725440', '"org-1780217842949"', 'test-org']) {
    if (alt === orgId) continue;
    const s = getOrgData(alt, 'suez_smtp_settings') as Record<string, unknown> | null;
    if (s && typeof s.host === 'string' && s.host) {
      setOrgData(orgId, 'suez_smtp_settings', s);
      return s;
    }
  }
  return direct;
}

/**
 * Sync domain tables → kv_store (and enrich organisations blob).
 * Safe to run on every server start; idempotent.
 */
export function rebuildKvFromDomain(): { orgId: string; employees: number; transactions: number } {
  const kv = getAllKV();
  const orgId = pickPrimaryOrgId(kv);

  const employees = getEmployees(orgId) as Record<string, unknown>[];
  const transactions = getAllTransactionsForOrg(orgId, false) as Record<string, unknown>[];
  const payrollRuns = getPayrollRuns(orgId) as Record<string, unknown>[];
  const invoices = getInvoicesDB(orgId) as Record<string, unknown>[];
  const orgData = getAllOrgData(orgId);
  const smtp = mergeSmtp(orgId);

  // Base organisations from org_data or kv
  let orgsState =
    (orgData.suez_organisations as {
      activeOrgId: string;
      organisations: Record<string, Record<string, unknown>>;
    } | undefined)
    || (kv.suez_organisations as {
      activeOrgId: string;
      organisations: Record<string, Record<string, unknown>>;
    } | undefined)
    || { activeOrgId: orgId, organisations: {} };

  // Normalize accidental quoted keys
  const cleanedOrgs: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(orgsState.organisations || {})) {
    const id = unwrapOrgId(k) || k;
    cleanedOrgs[id] = { ...v, id };
  }
  orgsState = { activeOrgId: orgId, organisations: cleanedOrgs };

  const existing = orgsState.organisations[orgId] || {
    id: orgId,
    name: (orgData.suez_company_profile as { projectName?: string } | undefined)?.projectName || orgId,
    createdAt: new Date().toISOString(),
  };

  const profile =
    (orgData.suez_company_profile as Record<string, unknown> | undefined)
    || (existing.profile as Record<string, unknown> | undefined)
    || (kv.suez_company_profile as Record<string, unknown> | undefined);

  orgsState.organisations[orgId] = {
    ...existing,
    id: orgId,
    name: (profile?.projectName as string) || (existing.name as string) || orgId,
    profile: profile || existing.profile,
    employees,
    transactions,
    payrollRuns,
    invoices,
    revenueData: orgData.suez_revenue_data || existing.revenueData || { transactions: [], lastSyncDate: null },
    transferPricing: orgData.suez_transfer_pricing || existing.transferPricing || { usRevenue: 0, usExpenses: 0, margin: 0 },
    taxEngine: orgData.suez_tax_engine || existing.taxEngine || { bookProfit: 0 },
    platformRules: orgData.suez_platform_rules || existing.platformRules || { fxMarkup: 2.5, auditRiskThreshold: 500000 },
    stripeOrgConfig: orgData.suez_stripe_org_config || existing.stripeOrgConfig,
    leaveRequests: existing.leaveRequests || [],
    leavePolicies: existing.leavePolicies || [],
    attendance: existing.attendance || [],
    modulePermissions: existing.modulePermissions || [],
    pendingTransactions: existing.pendingTransactions || [],
  };

  // Flat KV keys used by hydrateFromDB / localStorage
  setKV('suez_active_org_id', orgId);
  setKV('suez_onboarded', true);
  setKV('suez_organisations', orgsState);
  setKV('suez_employees', employees);
  setKV('suez_transactions', transactions);
  setKV('suez_payroll_runs', payrollRuns);
  setKV('suez_invoices', invoices);
  if (profile) setKV('suez_company_profile', profile);
  if (orgData.suez_revenue_data) setKV('suez_revenue_data', orgData.suez_revenue_data);
  if (orgData.suez_transfer_pricing) setKV('suez_transfer_pricing', orgData.suez_transfer_pricing);
  if (orgData.suez_tax_engine) setKV('suez_tax_engine', orgData.suez_tax_engine);
  if (orgData.suez_platform_rules) setKV('suez_platform_rules', orgData.suez_platform_rules);
  if (orgData.suez_stripe_org_config) setKV('suez_stripe_org_config', orgData.suez_stripe_org_config);
  if (orgData.suez_stripe_sync_schedule) setKV('suez_stripe_sync_schedule', orgData.suez_stripe_sync_schedule);
  if (orgData.suez_stripe_sync_cursors) setKV('suez_stripe_sync_cursors', orgData.suez_stripe_sync_cursors);
  if (smtp) setKV('suez_smtp_settings', smtp);

  // Invites (strip tokens? keep for admin continuity on clone)
  try {
    const invites = listInvites(orgId).map((r) => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(r.data) as Record<string, unknown>; } catch { /* */ }
      return {
        id: r.id,
        token: r.token,
        orgId: r.org_id,
        email: r.email,
        status: r.status,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        ...data,
      };
    });
    setKV('suez_employee_invites', invites);
  } catch {
    /* invites table may be empty on older DBs */
  }

  // Keep org_data organisations in sync
  setOrgData(orgId, 'suez_organisations', orgsState);
  if (profile) setOrgData(orgId, 'suez_company_profile', profile);

  return { orgId, employees: employees.length, transactions: transactions.length };
}
