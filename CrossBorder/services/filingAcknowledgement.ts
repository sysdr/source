/**
 * Manual filing acknowledgements + portal deep-links (REQ-080 / T-030).
 * GSTN API is out of MVP — founder/CA enter ARN/ack and attach evidence.
 */
import type { FilingTask, FilingTaskType } from '../types';

export interface PortalDeepLink {
  label: string;
  url: string;
  filingTypes: FilingTaskType[];
}

/** Official portals — deep-link only; no API integration (REQ-080). */
export const FILING_PORTAL_LINKS: PortalDeepLink[] = [
  {
    label: 'Check on GSTN portal',
    url: 'https://services.gst.gov.in/services/login',
    filingTypes: ['GSTR-1', 'GSTR-3B', 'GSTR-9', 'GSTR-9C', 'GST LUT'],
  },
  {
    label: 'Check on Income Tax portal',
    url: 'https://www.incometax.gov.in/iec/foportal/',
    filingTypes: ['24Q', '26Q', '27Q', 'ITR-5', 'ITR-6', 'ITR-7', 'Advance Tax'],
  },
  {
    label: 'Check on IRS portal',
    url: 'https://www.irs.gov/businesses/corporations/form-5472',
    filingTypes: ['Form 5472', 'Form 1120', 'Form 1065'],
  },
  {
    label: 'Check on RBI FIRMS (FEMA/ODI)',
    url: 'https://firms.rbi.org.in/',
    filingTypes: ['FEMA'],
  },
];

const ACK_REQUIRED_TYPES = new Set<FilingTaskType>([
  'GSTR-1', 'GSTR-3B', 'GSTR-9', 'GSTR-9C', 'GST LUT',
  '24Q', '26Q', '27Q',
  'Form 5472',
]);

export function getPortalLinkForFiling(type: FilingTaskType): PortalDeepLink | null {
  return FILING_PORTAL_LINKS.find((p) => p.filingTypes.includes(type)) ?? null;
}

export interface FilingAckInput {
  acknowledgementNumber?: string;
  filedDate?: string;
  evidenceLinks?: string[];
  documentIds?: string[];
  notes?: string;
}

export interface FilingAckValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateFilingAcknowledgement(
  type: FilingTaskType,
  input: FilingAckInput,
): FilingAckValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ack = (input.acknowledgementNumber ?? '').trim();
  const links = (input.evidenceLinks ?? []).map((l) => l.trim()).filter(Boolean);
  const docs = (input.documentIds ?? []).map((d) => d.trim()).filter(Boolean);

  if (ACK_REQUIRED_TYPES.has(type) && !ack) {
    errors.push('Acknowledgement / ARN number is required when marking this filing as Filed');
  }
  if (ack && ack.length < 4) {
    errors.push('Acknowledgement number looks too short');
  }
  if (!input.filedDate) {
    warnings.push('Filed date not set — using today is recommended');
  }
  if (links.length === 0 && docs.length === 0) {
    warnings.push('No evidence link or document attached — consider attaching the portal receipt');
  }
  for (const link of links) {
    if (!/^https?:\/\//i.test(link) && !link.startsWith('vault:')) {
      warnings.push(`Evidence "${link}" is not an http(s) URL or vault: ref`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function applyFilingAcknowledgement(
  task: FilingTask,
  input: FilingAckInput,
  asOfDate = new Date().toISOString().slice(0, 10),
): { task: FilingTask; validation: FilingAckValidation } {
  const validation = validateFilingAcknowledgement(task.type, input);
  if (!validation.ok) {
    return { task, validation };
  }
  const filedDate = (input.filedDate || asOfDate).slice(0, 10);
  const updated: FilingTask = {
    ...task,
    status: 'Filed',
    filedDate,
    acknowledgementNumber: (input.acknowledgementNumber ?? '').trim() || undefined,
    evidenceLinks: (input.evidenceLinks ?? []).map((l) => l.trim()).filter(Boolean),
    documentIds: (input.documentIds ?? task.documentIds)?.filter(Boolean),
    notes: input.notes?.trim() || task.notes,
    updatedAt: new Date().toISOString(),
  };
  return { task: updated, validation };
}
