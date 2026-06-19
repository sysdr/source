/**
 * ReconciliationPanel — Phase 4 accuracy surface
 *
 * Shows the live reconciliation report inside the Financial Books module.
 * Errors = red, Warnings = amber, Info = blue.
 * Collapses to a compact badge when clean.
 */

import React, { useState } from 'react';
import { useReconciliation } from '../../hooks/useReconciliation';
import type { ReconciliationIssue } from '../../hooks/useReconciliation';

const SEVERITY_STYLES: Record<string, string> = {
  error:   'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info:    'bg-blue-50 border-blue-200 text-blue-700',
};

const SEVERITY_DOT: Record<string, string> = {
  error:   'bg-red-500',
  warning: 'bg-amber-400',
  info:    'bg-blue-400',
};

const CODE_LABELS: Record<string, string> = {
  STALE_PENDING:          'Stale Pending',
  GST_RATE_MISMATCH:      'GST Mismatch',
  ITC_INELIGIBLE:         'ITC Ineligible',
  TDS_MISMATCH:           'TDS Mismatch',
  NEGATIVE_AMOUNT:        'Negative Amount',
  MISSING_NARRATION:      'Missing Narration',
  INVOICE_OVERDUE:        'Invoice Overdue',
  INVOICE_TOTAL_MISMATCH: 'Invoice Total',
};

function IssueRow({ issue }: { issue: ReconciliationIssue }) {
  return (
    <div className={`border rounded-lg px-3 py-2 text-xs ${SEVERITY_STYLES[issue.severity]}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[issue.severity]}`} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold">{CODE_LABELS[issue.code] ?? issue.code}</span>
          {' — '}
          <span>{issue.message}</span>
          <div className="mt-0.5 opacity-75">
            ↳ {issue.action}
          </div>
        </div>
        <span className="flex-shrink-0 opacity-50">{issue.date}</span>
      </div>
    </div>
  );
}

export default function ReconciliationPanel() {
  const { data: report, isLoading, refetch } = useReconciliation();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        Running reconciliation…
      </div>
    );
  }

  if (!report) return null;

  const { summary } = report;

  // ── Clean state ───────────────────────────────────────────────────────────
  if (summary.clean) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium px-1">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        All {report.totalTransactions} transactions reconciled — no issues
        <button
          onClick={() => refetch()}
          className="ml-2 opacity-50 hover:opacity-100 text-[10px] underline"
        >
          refresh
        </button>
      </div>
    );
  }

  const errors   = report.issues.filter(i => i.severity === 'error');
  const warnings = report.issues.filter(i => i.severity === 'warning');
  const infos    = report.issues.filter(i => i.severity === 'info');

  // ── Summary bar ───────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(x => !x)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 text-sm font-medium text-gray-700">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          Reconciliation Report
          <span className="font-normal text-gray-400 text-xs">
            {report.totalTransactions} txns · {report.totalInvoices} invoices
          </span>
        </div>
        <div className="flex items-center gap-2">
          {summary.errors   > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">{summary.errors} error{summary.errors !== 1 ? 's' : ''}</span>}
          {summary.warnings > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">{summary.warnings} warning{summary.warnings !== 1 ? 's' : ''}</span>}
          {summary.infos    > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">{summary.infos} info</span>}
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </button>

      {/* Issue list */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2 max-h-80 overflow-y-auto">
          {errors.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-1">Errors</p>
              <div className="space-y-1">
                {errors.map((issue, i) => <React.Fragment key={`e-${i}`}><IssueRow issue={issue} /></React.Fragment>)}
              </div>
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider mb-1">Warnings</p>
              <div className="space-y-1">
                {warnings.map((issue, i) => <React.Fragment key={`w-${i}`}><IssueRow issue={issue} /></React.Fragment>)}
              </div>
            </div>
          )}
          {infos.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-1">Info</p>
              <div className="space-y-1">
                {infos.map((issue, i) => <React.Fragment key={`i-${i}`}><IssueRow issue={issue} /></React.Fragment>)}
              </div>
            </div>
          )}
          <div className="pt-1 flex justify-between items-center">
            <span className="text-[10px] text-gray-400">Generated {new Date(report.generatedAt).toLocaleTimeString()}</span>
            <button
              onClick={() => refetch()}
              className="text-[10px] text-blue-500 hover:text-blue-700 underline"
            >
              Re-run
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
