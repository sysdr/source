/**
 * Indian bank statement CSV parse + ledger matching (REQ-079 / T-026).
 * Standard MVP columns: date, description, debit, credit, balance.
 */
import type { Transaction } from '../types';

export interface BankStatementRow {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance?: number;
  /** Absolute movement amount */
  amount: number;
  /** Income = credit, Expense = debit */
  type: 'Income' | 'Expense';
  rawLine?: string;
}

export type MatchStatus = 'matched' | 'unmatched' | 'ambiguous';

export interface BankMatchCandidate {
  transactionId: string;
  description: string;
  amount: number;
  date: string;
  score: number;
}

export interface BankStatementMatchResult {
  rowIndex: number;
  row: BankStatementRow;
  status: MatchStatus;
  matchedTransactionId?: string;
  candidates: BankMatchCandidate[];
}

export interface BankImportReport {
  rows: BankStatementRow[];
  matches: BankStatementMatchResult[];
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  suggestedTransactions: Array<Partial<Transaction> & {
    date: string;
    description: string;
    amount: number;
    type: 'Income' | 'Expense';
    source: 'IndianBank';
    currency: 'INR';
    category: string;
    status: 'Completed';
  }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(raw: string): string | null {
  const t = raw.trim().replace(/"/g, '');
  if (DATE_RE.test(t)) return t;
  const dmy = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!dmy) return null;
  const [, d, m, yRaw] = dmy;
  const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseMoney(raw: string | undefined): number {
  if (!raw || !String(raw).trim()) return 0;
  const n = Number(String(raw).replace(/[",]/g, '').trim());
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime());
  return Math.round(ms / 86_400_000);
}

/**
 * Parse standard Indian bank statement CSV: date, description, debit, credit, balance.
 * Also accepts legacy amount-column format (falls back via detect).
 */
export function parseIndianBankStatementCSV(csv: string): BankStatementRow[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headerCols = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasStandard = headerCols.some((c) => c.includes('debit'))
    && headerCols.some((c) => c.includes('credit'));
  const hasHeader = headerCols.some((c) => c.includes('date'));

  if (hasStandard) {
    const idx = {
      date: headerCols.findIndex((c) => c.includes('date')),
      description: headerCols.findIndex((c) => c.includes('desc') || c.includes('narrat') || c.includes('particular')),
      debit: headerCols.findIndex((c) => c.includes('debit') || c === 'dr' || c === 'withdrawal'),
      credit: headerCols.findIndex((c) => c.includes('credit') || c === 'cr' || c === 'deposit'),
      balance: headerCols.findIndex((c) => c.includes('balance') || c.includes('bal')),
    };
    const dataLines = hasHeader ? lines.slice(1) : lines;
    const rows: BankStatementRow[] = [];
    for (const line of dataLines) {
      const cols = splitCsvLine(line);
      const date = normalizeDate(cols[idx.date] || cols[0] || '');
      const description = (cols[idx.description >= 0 ? idx.description : 1] || '').replace(/^"|"$/g, '');
      const debit = parseMoney(cols[idx.debit]);
      const credit = parseMoney(cols[idx.credit]);
      const balance = idx.balance >= 0 ? parseMoney(cols[idx.balance]) : undefined;
      if (!date || !description || (debit <= 0 && credit <= 0)) continue;
      const type: 'Income' | 'Expense' = credit > 0 ? 'Income' : 'Expense';
      const amount = credit > 0 ? credit : debit;
      rows.push({
        date,
        description,
        debit,
        credit,
        balance: balance || undefined,
        amount,
        type,
        rawLine: line,
      });
    }
    return rows;
  }

  // Legacy: date, description, amount [, ...]
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: BankStatementRow[] = [];
  for (const line of dataLines) {
    const cols = splitCsvLine(line);
    if (cols.length < 3) continue;
    const date = normalizeDate(cols[0] || '');
    const description = cols[1] || '';
    const signed = Number(String(cols[2]).replace(/,/g, ''));
    if (!date || !description || !Number.isFinite(signed) || signed === 0) continue;
    const type: 'Income' | 'Expense' = signed >= 0 ? 'Income' : 'Expense';
    const amount = Math.abs(signed);
    rows.push({
      date,
      description,
      debit: type === 'Expense' ? amount : 0,
      credit: type === 'Income' ? amount : 0,
      amount,
      type,
      rawLine: line,
    });
  }
  return rows;
}

/**
 * Match statement rows to ledger transactions by amount + date window (±dateWindowDays).
 */
export function matchBankStatementToLedger(
  rows: BankStatementRow[],
  ledger: Array<Pick<Transaction, 'id' | 'date' | 'description' | 'amount' | 'type' | 'source' | 'status'>>,
  options: { dateWindowDays?: number; amountTolerance?: number } = {},
): BankImportReport {
  const dateWindowDays = options.dateWindowDays ?? 3;
  const amountTolerance = options.amountTolerance ?? 1;
  const used = new Set<string>();

  const matches: BankStatementMatchResult[] = rows.map((row, rowIndex) => {
    const candidates: BankMatchCandidate[] = [];
    for (const tx of ledger) {
      if (used.has(tx.id)) continue;
      if (tx.status === 'Refunded' || (tx as { deleted?: boolean }).deleted) continue;
      const amountDiff = Math.abs(Math.abs(Number(tx.amount)) - row.amount);
      if (amountDiff > amountTolerance) continue;
      const dayDiff = daysBetween(tx.date, row.date);
      if (dayDiff > dateWindowDays) continue;
      // Prefer same direction: Income↔credit, Expense↔debit
      const typeBonus = tx.type === row.type ? 2 : 0;
      const score = 10 - dayDiff - amountDiff + typeBonus;
      candidates.push({
        transactionId: tx.id,
        description: tx.description,
        amount: Number(tx.amount),
        date: tx.date,
        score,
      });
    }
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { rowIndex, row, status: 'unmatched' as const, candidates };
    }
    if (candidates.length > 1 && Math.abs(candidates[0].score - candidates[1].score) < 0.5) {
      return { rowIndex, row, status: 'ambiguous' as const, candidates: candidates.slice(0, 5) };
    }
    used.add(candidates[0].transactionId);
    return {
      rowIndex,
      row,
      status: 'matched' as const,
      matchedTransactionId: candidates[0].transactionId,
      candidates: candidates.slice(0, 5),
    };
  });

  const suggestedTransactions = matches
    .filter((m) => m.status === 'unmatched')
    .map((m, i) => ({
      id: `indianbank-${m.row.date}-${m.row.amount}-${i}`,
      date: m.row.date,
      description: m.row.description,
      amount: m.row.amount,
      currency: 'INR' as const,
      source: 'IndianBank' as const,
      category: m.row.type === 'Income' ? 'Bank Credit' : 'Bank Debit',
      status: 'Completed' as const,
      type: m.row.type,
      entity: 'parent' as const,
    }));

  return {
    rows,
    matches,
    matchedCount: matches.filter((m) => m.status === 'matched').length,
    unmatchedCount: matches.filter((m) => m.status === 'unmatched').length,
    ambiguousCount: matches.filter((m) => m.status === 'ambiguous').length,
    suggestedTransactions,
  };
}

export function importAndMatchIndianBankCSV(
  csv: string,
  ledger: Array<Pick<Transaction, 'id' | 'date' | 'description' | 'amount' | 'type' | 'source' | 'status'>>,
  options?: { dateWindowDays?: number; amountTolerance?: number },
): BankImportReport {
  const rows = parseIndianBankStatementCSV(csv);
  return matchBankStatementToLedger(rows, ledger, options);
}
