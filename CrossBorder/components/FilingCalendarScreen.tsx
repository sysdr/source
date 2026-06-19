import React, { useState, useEffect, useCallback } from 'react';
import { getFilingTasks, updateFilingTask } from '../services/storageService';
import { getOverdueFilings, getUpcomingFilings, seedDefaultFilingTasksForFY, markFilingFiled, ensureFilingTask } from '../services/filingCalendarService';
import type { FilingTask, FilingTaskStatus, FilingTaskType } from '../types';

type CalTab = 'upcoming' | 'overdue' | 'all';

const INDIA_FILINGS: FilingTaskType[] = ['GSTR-1', 'GSTR-3B', 'GSTR-9', 'GSTR-9C', '24Q', '26Q', '27Q', 'ITR-5', 'ITR-6', 'ITR-7', 'Advance Tax', 'FEMA'];
const US_FILINGS: FilingTaskType[]    = ['Form 5472', 'Form 1120', 'Form 1065'];

const STATUS_STYLES: Record<FilingTaskStatus, { bg: string; color: string; label: string }> = {
  Pending:       { bg: '#fef9c3', color: '#a16207', label: 'Pending' },
  InProgress:    { bg: '#e0f2fe', color: '#0369a1', label: 'In Progress' },
  Filed:         { bg: '#dcfce7', color: '#16a34a', label: 'Filed ✓' },
  Overdue:       { bg: '#fee2e2', color: '#dc2626', label: 'Overdue' },
  NotApplicable: { bg: '#f3f4f6', color: '#6b7280', label: 'N/A' },
};

const STATUS_ORDER: FilingTaskStatus[] = ['Pending', 'InProgress', 'Filed', 'Overdue', 'NotApplicable'];

function nextStatus(current: FilingTaskStatus): FilingTaskStatus {
  const idx = STATUS_ORDER.indexOf(current);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
}

function daysUntil(date: string): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

function getDueBadge(task: FilingTask): { text: string; color: string } {
  if (task.status === 'Filed' || task.status === 'NotApplicable') {
    return { text: task.status === 'Filed' ? `Filed ${task.filedDate ?? ''}` : 'N/A', color: 'var(--text-muted)' };
  }
  const days = daysUntil(task.dueDate);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, color: '#dc2626' };
  if (days === 0) return { text: 'Due today!', color: '#dc2626' };
  if (days <= 7) return { text: `${days}d left`, color: '#d97706' };
  if (days <= 30) return { text: `${days}d left`, color: '#ca8a04' };
  return { text: `${days}d`, color: 'var(--text-muted)' };
}

const FILING_TYPE_GROUPS: { label: string; types: FilingTaskType[] }[] = [
  { label: 'India – GST', types: ['GSTR-1', 'GSTR-3B', 'GSTR-9', 'GSTR-9C'] },
  { label: 'India – TDS', types: ['24Q', '26Q', '27Q'] },
  { label: 'India – Income Tax', types: ['ITR-5', 'ITR-6', 'ITR-7', 'Advance Tax'] },
  { label: 'India – FEMA', types: ['FEMA'] },
  { label: 'US – Federal', types: ['Form 5472', 'Form 1120', 'Form 1065'] },
];

const FilingCalendarScreen: React.FC = () => {
  const [tasks, setTasks]     = useState<FilingTask[]>([]);
  const [tab, setTab]         = useState<CalTab>('upcoming');
  const [entityFilter, setEntityFilter] = useState<'all' | 'india' | 'us'>('all');
  const [statusFilter, setStatusFilter] = useState<FilingTaskStatus | 'all'>('all');
  const [fy, setFy]           = useState('2025-2026');
  const [search, setSearch]   = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editFiledDate, setEditFiledDate] = useState('');
  const [editStatus, setEditStatus] = useState<FilingTaskStatus>('Pending');

  // Manual add task
  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType]   = useState<FilingTaskType>('GSTR-1');
  const [addPeriod, setAddPeriod] = useState('');

  const refresh = useCallback(() => setTasks(getFilingTasks()), []);

  useEffect(() => {
    refresh();
    window.addEventListener('suez_data_updated', refresh);
    return () => window.removeEventListener('suez_data_updated', refresh);
  }, [refresh]);

  const overdue  = getOverdueFilings();
  const upcoming = getUpcomingFilings(60);

  const handleSeed = () => {
    seedDefaultFilingTasksForFY(fy.trim());
    refresh();
  };

  const handleCycleStatus = (task: FilingTask) => {
    const next = nextStatus(task.status);
    const updates: Partial<FilingTask> = { status: next, updatedAt: new Date().toISOString() };
    if (next === 'Filed' && !task.filedDate) updates.filedDate = new Date().toISOString().slice(0, 10);
    updateFilingTask(task.id, updates);
    refresh();
  };

  const handleOpenEdit = (task: FilingTask) => {
    setEditingId(task.id);
    setEditNotes(task.notes ?? '');
    setEditFiledDate(task.filedDate ?? '');
    setEditStatus(task.status);
  };

  const handleSaveEdit = (taskId: string) => {
    const updates: Partial<FilingTask> = {
      status: editStatus,
      notes: editNotes.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editStatus === 'Filed') {
      updates.filedDate = editFiledDate || new Date().toISOString().slice(0, 10);
    }
    updateFilingTask(taskId, updates);
    setEditingId(null);
    refresh();
  };

  const handleAddTask = () => {
    if (!addPeriod.trim()) return;
    ensureFilingTask(addType, addPeriod.trim());
    setAddType('GSTR-1');
    setAddPeriod('');
    setShowAddForm(false);
    refresh();
  };

  // Filter tasks
  let filtered = tasks;
  if (tab === 'upcoming') filtered = upcoming;
  else if (tab === 'overdue') filtered = overdue;

  if (entityFilter === 'india') filtered = filtered.filter(t => (INDIA_FILINGS as string[]).includes(t.type));
  if (entityFilter === 'us')    filtered = filtered.filter(t => (US_FILINGS as string[]).includes(t.type));
  if (statusFilter !== 'all')   filtered = filtered.filter(t => t.status === statusFilter);
  if (search.trim()) {
    const s = search.toLowerCase();
    filtered = filtered.filter(t => t.type.toLowerCase().includes(s) || t.period.toLowerCase().includes(s) || (t.notes ?? '').toLowerCase().includes(s));
  }

  // Group for 'all' tab
  const grouped = FILING_TYPE_GROUPS.map(group => ({
    ...group,
    tasks: filtered.filter(t => group.types.includes(t.type)),
  })).filter(g => g.tasks.length > 0);

  const renderTaskRow = (task: FilingTask, compact = false) => {
    const due = getDueBadge(task);
    const statusStyle = STATUS_STYLES[task.status] ?? STATUS_STYLES.Pending;
    const isEditing = editingId === task.id;
    return (
      <React.Fragment key={task.id}>
        <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <td className="py-3 px-4">
            <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{task.type}</div>
            {!compact && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{task.period}</div>}
          </td>
          {compact && <td className="py-3 px-4 text-xs" style={{ color: 'var(--text-secondary)' }}>{task.period}</td>}
          <td className="py-3 px-4 text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>{task.dueDate}</td>
          <td className="py-3 px-4">
            <button type="button" onClick={() => handleCycleStatus(task)}
              className="text-xs px-2 py-0.5 rounded-lg font-semibold cursor-pointer hover:opacity-80 transition-opacity"
              title="Click to cycle status"
              style={statusStyle}>
              {statusStyle.label}
            </button>
          </td>
          <td className="py-3 px-4 text-xs hidden lg:table-cell" style={{ color: due.color }}>
            {due.text}
          </td>
          <td className="py-3 px-4 text-xs hidden lg:table-cell max-w-xs truncate" style={{ color: 'var(--text-muted)' }}>
            {task.notes ?? '—'}
          </td>
          <td className="py-3 px-4 text-xs">
            <button type="button" onClick={() => isEditing ? setEditingId(null) : handleOpenEdit(task)}
              className="font-heading text-xs px-2 py-1 rounded-lg font-semibold"
              style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
              {isEditing ? 'Close' : 'Edit'}
            </button>
          </td>
        </tr>
        {isEditing && (
          <tr style={{ borderColor: 'var(--border-subtle)' }}>
            <td colSpan={compact ? 7 : 7} className="px-4 pb-4" style={{ background: 'var(--bg-page)' }}>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Status</label>
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value as FilingTaskStatus)}
                      className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                      {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_STYLES[s].label}</option>)}
                    </select>
                  </div>
                  {(editStatus === 'Filed') && (
                    <div>
                      <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Filed Date</label>
                      <input type="date" value={editFiledDate} onChange={e => setEditFiledDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
                    </div>
                  )}
                  <div className={editStatus === 'Filed' ? '' : 'col-span-2'}>
                    <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Notes / Ack. Number</label>
                    <input type="text" placeholder="Acknowledgement / challan reference..." value={editNotes} onChange={e => setEditNotes(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleSaveEdit(task.id)}
                    className="font-heading px-4 py-1.5 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}
                    className="font-heading px-4 py-1.5 rounded-lg text-sm font-semibold" style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
                    Cancel
                  </button>
                  {task.status !== 'Filed' && (
                    <button type="button" onClick={() => { markFilingFiled(task.id, editFiledDate || new Date().toISOString().slice(0, 10)); setEditingId(null); refresh(); }}
                      className="font-heading px-4 py-1.5 rounded-lg text-sm font-semibold ml-auto" style={{ background: '#dcfce7', color: '#16a34a' }}>
                      Mark as Filed ✓
                    </button>
                  )}
                </div>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Filing Calendar</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {tasks.length} tasks · {overdue.length} overdue · {upcoming.length} due in 60 days
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowAddForm(v => !v)}
            className="font-heading px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
            + Add Task
          </button>
          <div className="flex items-center gap-2">
            <input type="text" placeholder="FY e.g. 2025-2026" value={fy} onChange={e => setFy(e.target.value)}
              className="px-3 py-2 rounded-xl border text-sm w-36" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
            <button type="button" onClick={handleSeed}
              className="font-heading px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--bg-sidebar)' }}>
              Seed FY Tasks
            </button>
          </div>
        </div>
      </div>

      {/* Overdue alert */}
      {overdue.length > 0 && tab !== 'overdue' && (
        <div className="p-4 rounded-2xl border-2 flex items-center justify-between" style={{ borderColor: '#dc2626', background: '#fff5f5' }}>
          <div className="flex items-center gap-3">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="font-heading font-bold text-sm" style={{ color: '#dc2626' }}>
                {overdue.length} filing{overdue.length > 1 ? 's' : ''} overdue
              </p>
              <p className="text-xs" style={{ color: '#dc2626' }}>
                {overdue.slice(0, 3).map(t => `${t.type} (${t.period})`).join(' · ')}
                {overdue.length > 3 ? ` + ${overdue.length - 3} more` : ''}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setTab('overdue')}
            className="font-heading text-sm font-semibold px-3 py-1.5 rounded-lg" style={{ background: '#dc2626', color: '#fff' }}>
            View All
          </button>
        </div>
      )}

      {/* Add task form */}
      {showAddForm && (
        <div className="p-4 rounded-2xl border space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <h3 className="font-heading text-base font-bold" style={{ color: 'var(--text-primary)' }}>Add Filing Task</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Filing Type</label>
              <select value={addType} onChange={e => setAddType(e.target.value as FilingTaskType)}
                className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}>
                {FILING_TYPE_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.types.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-heading font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Period</label>
              <input type="text" placeholder="e.g. 2025-04 or 2025-Q1" value={addPeriod} onChange={e => setAddPeriod(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm w-40" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)', color: 'var(--text-primary)' }} />
            </div>
            <button type="button" onClick={handleAddTask} disabled={!addPeriod.trim()}
              className="font-heading px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--bg-sidebar)' }}>
              Add
            </button>
            <button type="button" onClick={() => setShowAddForm(false)}
              className="font-heading px-4 py-2 rounded-lg text-sm font-semibold" style={{ color: 'var(--text-secondary)', background: 'var(--bg-page)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
          {(['upcoming', 'overdue', 'all'] as CalTab[]).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className="font-heading px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize"
              style={tab === t ? { background: 'var(--bg-sidebar)', color: '#fff' } : { color: 'var(--text-secondary)' }}>
              {t === 'upcoming' ? `Upcoming (${upcoming.length})` : t === 'overdue' ? `Overdue (${overdue.length})` : `All (${tasks.length})`}
            </button>
          ))}
        </div>

        {/* Entity filter */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
          {(['all', 'india', 'us'] as const).map(e => (
            <button key={e} type="button" onClick={() => setEntityFilter(e)}
              className="font-heading px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize"
              style={entityFilter === e ? { background: 'var(--bg-sidebar)', color: '#fff' } : { color: 'var(--text-secondary)' }}>
              {e === 'india' ? '🇮🇳 India' : e === 'us' ? '🇺🇸 US' : 'All'}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as FilingTaskStatus | 'all')}
          className="px-3 py-2 rounded-xl border text-sm" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
          <option value="all">All statuses</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_STYLES[s].label}</option>)}
        </select>

        {/* Search */}
        <input type="text" placeholder="Search type / period / notes…" value={search} onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 rounded-xl border text-sm flex-1 min-w-[200px]"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
      </div>

      {/* Results */}
      {tab === 'all' ? (
        // Grouped view
        <div className="space-y-4">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border p-12 text-center" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p style={{ color: 'var(--text-muted)' }}>No filing tasks match your filters. Use "Seed FY Tasks" to populate the calendar.</p>
            </div>
          ) : grouped.map(group => (
            <div key={group.label} className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-page)' }}>
                <span className="font-heading text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{group.label}</span>
                <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>({group.tasks.length} tasks)</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-page)' }}>
                    <th className="text-left py-2 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-muted)' }}>Type</th>
                    <th className="text-left py-2 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-muted)' }}>Period</th>
                    <th className="text-left py-2 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-muted)' }}>Due Date</th>
                    <th className="text-left py-2 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-muted)' }}>Status</th>
                    <th className="text-left py-2 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-muted)' }}>Due In</th>
                    <th className="text-left py-2 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-muted)' }}>Notes</th>
                    <th className="py-2 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {group.tasks.map(task => renderTaskRow(task, true))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : (
        // Flat view for upcoming/overdue
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-page)' }}>
                <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Type</th>
                <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Period</th>
                <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Due Date</th>
                <th className="text-left py-3 px-4 font-heading font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>Status</th>
                <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Due In</th>
                <th className="text-left py-3 px-4 font-heading font-semibold text-xs hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Notes</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                    {tab === 'upcoming' ? 'No upcoming filings in the next 60 days.' : 'No overdue filings. Great job! 🎉'}
                  </td>
                </tr>
              ) : filtered.map(task => renderTaskRow(task, false))}
            </tbody>
          </table>
        </div>
      )}

      {/* Status legend */}
      <div className="flex flex-wrap gap-3 items-center p-3 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
        <span className="text-xs font-heading font-semibold" style={{ color: 'var(--text-muted)' }}>STATUS LEGEND:</span>
        {STATUS_ORDER.map(s => (
          <span key={s} className="text-xs px-2 py-0.5 rounded-lg font-semibold" style={STATUS_STYLES[s]}>
            {STATUS_STYLES[s].label}
          </span>
        ))}
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>Click status badge to cycle · Click Edit to update notes/ack.</span>
      </div>
    </div>
  );
};

export default FilingCalendarScreen;
