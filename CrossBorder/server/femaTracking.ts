/**
 * Server FEMA tracking + filing acknowledgement (T-030 / T-031).
 */
import { getOrgData, setOrgData, queryTransactions } from './db.js';
import type { FilingTask, OdiProfile, RemittanceRecord, Transaction } from '../types.js';
import { applyFilingAcknowledgement, type FilingAckInput } from '../services/filingAcknowledgement.js';
import { buildFemaTrackingReport, applySuggestedMatch } from '../services/femaTracking.js';

const FILING_TASKS_KEY = 'filingTasks';
const REMITTANCE_KEY = 'remittanceRecords';
const ODI_KEY = 'odiProfile';

function getFilingTasks(orgId: string): FilingTask[] {
  const raw = getOrgData(orgId, FILING_TASKS_KEY);
  return Array.isArray(raw) ? (raw as FilingTask[]) : [];
}

function setFilingTasks(orgId: string, tasks: FilingTask[]): void {
  setOrgData(orgId, FILING_TASKS_KEY, tasks);
}

function getRemittances(orgId: string): RemittanceRecord[] {
  const raw = getOrgData(orgId, REMITTANCE_KEY);
  return Array.isArray(raw) ? (raw as RemittanceRecord[]) : [];
}

function setRemittances(orgId: string, list: RemittanceRecord[]): void {
  setOrgData(orgId, REMITTANCE_KEY, list);
}

export function getOdiProfile(orgId: string): OdiProfile | null {
  const raw = getOrgData(orgId, ODI_KEY);
  if (!raw || typeof raw !== 'object') return null;
  return raw as OdiProfile;
}

export function setOdiProfile(orgId: string, profile: OdiProfile): OdiProfile {
  const next: OdiProfile = { ...profile, updatedAt: new Date().toISOString() };
  setOrgData(orgId, ODI_KEY, next);
  return next;
}

export function getFemaTrackingForOrg(orgId: string) {
  const remittances = getRemittances(orgId);
  const transactions = queryTransactions({ orgId, limit: 10_000, offset: 0 }) as Transaction[];
  const filingTasks = getFilingTasks(orgId);
  const odiProfile = getOdiProfile(orgId);
  return buildFemaTrackingReport({ remittances, transactions, odiProfile, filingTasks });
}

export function acknowledgeFilingForOrg(
  orgId: string,
  taskId: string,
  input: FilingAckInput,
): { ok: true; task: FilingTask; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] } {
  const tasks = getFilingTasks(orgId);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) {
    return { ok: false, errors: [`Filing task ${taskId} not found`], warnings: [] };
  }
  const { task, validation } = applyFilingAcknowledgement(tasks[idx], input);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }
  tasks[idx] = task;
  setFilingTasks(orgId, tasks);
  return { ok: true, task, warnings: validation.warnings };
}

export function applyFircMatchForOrg(
  orgId: string,
  remittanceId: string,
  transactionId: string,
): { ok: true; remittance: RemittanceRecord } | { ok: false; error: string } {
  const remittances = getRemittances(orgId);
  const idx = remittances.findIndex((r) => r.id === remittanceId);
  if (idx < 0) return { ok: false, error: 'Remittance not found' };
  const transactions = queryTransactions({ orgId, limit: 10_000, offset: 0 }) as Transaction[];
  const tx = transactions.find((t) => t.id === transactionId);
  if (!tx) return { ok: false, error: 'Transaction not found' };
  const rem = remittances[idx];
  remittances[idx] = applySuggestedMatch(rem, {
    remittanceId,
    transactionId,
    remittanceAmount: rem.amount,
    transactionAmount: Math.abs(tx.originalAmount ?? tx.netAmount ?? tx.amount),
    amountDeltaPct: 0,
    dateDeltaDays: 0,
    score: 1,
  });
  setRemittances(orgId, remittances);
  return { ok: true, remittance: remittances[idx] };
}
