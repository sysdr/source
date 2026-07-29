/**
 * Filing reminder email builders (REQ-051 / T-039).
 */
import type { FilingTask } from '../types';
import { deriveFilingStatus } from './complianceStatusEngine';

export interface ReminderCandidate {
  task: FilingTask;
  derivedStatus: string;
  daysUntilDue: number;
  urgency: 'overdue' | 'due_soon' | 'upcoming';
}

export function selectFilingReminders(
  tasks: FilingTask[],
  asOfDate = new Date().toISOString().slice(0, 10),
  dueSoonDays = 7,
): ReminderCandidate[] {
  const out: ReminderCandidate[] = [];
  for (const task of tasks) {
    const derived = deriveFilingStatus(task, asOfDate);
    if (derived === 'Filed' || derived === 'NotApplicable') continue;
    const daysUntilDue = Math.ceil(
      (new Date(`${task.dueDate}T00:00:00`).getTime() - new Date(`${asOfDate}T00:00:00`).getTime())
        / 86_400_000,
    );
    if (derived === 'Overdue' || daysUntilDue < 0) {
      out.push({ task, derivedStatus: 'Overdue', daysUntilDue, urgency: 'overdue' });
    } else if (daysUntilDue <= dueSoonDays) {
      out.push({
        task,
        derivedStatus: derived,
        daysUntilDue,
        urgency: daysUntilDue <= 3 ? 'due_soon' : 'upcoming',
      });
    }
  }
  return out.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

export function buildFilingReminderEmail(input: {
  orgName: string;
  toName?: string;
  candidates: ReminderCandidate[];
}): { subject: string; text: string; html: string } | null {
  if (input.candidates.length === 0) return null;
  const overdue = input.candidates.filter((c) => c.urgency === 'overdue').length;
  const subject = overdue > 0
    ? `[Action required] ${overdue} overdue filing(s) — ${input.orgName}`
    : `[Reminder] ${input.candidates.length} filing(s) due soon — ${input.orgName}`;

  const lines = input.candidates.map((c) => {
    const when = c.daysUntilDue < 0
      ? `${Math.abs(c.daysUntilDue)}d overdue`
      : c.daysUntilDue === 0
        ? 'due today'
        : `due in ${c.daysUntilDue}d`;
    return `• ${c.task.type} (${c.task.period}) — ${when} — due ${c.task.dueDate}`;
  });

  const greeting = input.toName ? `Hi ${input.toName},` : 'Hi,';
  const text = `${greeting}

Filing reminder for ${input.orgName}:

${lines.join('\n')}

Open CrossBorder ERP → Filing Calendar to update status and attach acknowledgements.

— Project Suez
`;

  const htmlRows = input.candidates.map((c) => {
    const color = c.urgency === 'overdue' ? '#dc2626' : c.urgency === 'due_soon' ? '#d97706' : '#0369a1';
    const when = c.daysUntilDue < 0
      ? `${Math.abs(c.daysUntilDue)}d overdue`
      : c.daysUntilDue === 0
        ? 'due today'
        : `due in ${c.daysUntilDue}d`;
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(c.task.type)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(c.task.period)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(c.task.dueDate)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:${color};font-weight:700;">${escapeHtml(when)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;">
  <p>${escapeHtml(greeting)}</p>
  <p>Filing reminder for <strong>${escapeHtml(input.orgName)}</strong>:</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <thead><tr style="text-align:left;background:#f8fafc;">
      <th style="padding:8px;">Filing</th><th style="padding:8px;">Period</th>
      <th style="padding:8px;">Due</th><th style="padding:8px;">Status</th>
    </tr></thead>
    <tbody>${htmlRows}</tbody>
  </table>
  <p style="font-size:13px;color:#64748b;margin-top:16px;">Open Filing Calendar to mark filed and attach ARN/evidence.</p>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
