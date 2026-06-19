import { Transaction } from '../types';
import { getBaseCurrency, convertToBaseSync } from './currencyService';
import { getTransactions, setTransactions, updateTransaction, removeTransaction } from './storageService';
import * as pdfjsLib from 'pdfjs-dist';

export interface LLPBankStatementRow {
  date: string;
  description: string;
  amount: number;
  currency?: 'INR' | 'USD';
  type?: 'Income' | 'Expense' | 'Purchase';
  category?: string;
  status?: Transaction['status'];
  entity?: Transaction['entity'];
  sourceRef?: string;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

const toTxnStatus = (value?: string): Transaction['status'] => {
  const v = (value || '').trim().toLowerCase();
  if (v === 'pending') return 'Pending';
  if (v === 'failed') return 'Failed';
  if (v === 'refunded') return 'Refunded';
  if (v === 'flagged') return 'Flagged';
  return 'Completed';
};

const toTxnType = (value?: string, amount?: number): Transaction['type'] => {
  const v = (value || '').trim().toLowerCase();
  if (v === 'income') return 'Income';
  if (v === 'purchase') return 'Purchase';
  if (v === 'expense') return 'Expense';
  return (amount || 0) >= 0 ? 'Income' : 'Expense';
};

const sanitizeAmount = (raw: string): number => {
  const cleaned = raw.replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

export const parseLLPBankStatementCSV = (csv: string): LLPBankStatementRow[] => {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const hasHeader = /date/i.test(lines[0]) && /description/i.test(lines[0]);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const rows: LLPBankStatementRow[] = [];
  for (const line of dataLines) {
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 3) continue;
    const [date, description, amountRaw, currencyRaw, typeRaw, categoryRaw, statusRaw, entityRaw, sourceRefRaw] = cols;
    const amount = sanitizeAmount(amountRaw);
    if (!date || !description || Number.isNaN(amount)) continue;
    const currency = (currencyRaw || '').toUpperCase() === 'USD' ? 'USD' : 'INR';
    const type = toTxnType(typeRaw, amount);
    rows.push({
      date,
      description,
      amount,
      currency,
      type,
      category: categoryRaw || (type === 'Income' ? 'Revenue' : 'Bank Expense'),
      status: toTxnStatus(statusRaw),
      entity: entityRaw === 'subsidiary' ? 'subsidiary' : 'parent',
      sourceRef: sourceRefRaw || undefined,
    });
  }
  return rows;
};

const normalizeDate = (raw: string): string | null => {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const ddmmyyyy = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, yRaw] = ddmmyyyy;
    const y = yRaw.length === 2 ? (Number(yRaw) <= 70 ? `20${yRaw}` : `19${yRaw}`) : yRaw;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const ddMonYYYY = t.match(/^(\d{1,2})[-\s]+([A-Za-z]{3,9})[-\s]+(\d{2,4})$/);
  if (ddMonYYYY) {
    const [, d, monRaw, yRaw] = ddMonYYYY;
    const monMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = monMap[monRaw.toLowerCase().slice(0, 4).replace('.', '')];
    if (!mon) return null;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${mon}-${d.padStart(2, '0')}`;
  }
  return null;
};

const parseAmountToken = (token: string): { amount: number; type: 'Income' | 'Expense' } | null => {
  const cleaned = token.replace(/,/g, '').trim();
  const drcr = cleaned.match(/^([\-+]?\d+(?:\.\d+)?)\s*(CR|DR)$/i);
  if (drcr) {
    const n = Number(drcr[1]);
    if (!Number.isFinite(n)) return null;
    return drcr[2].toUpperCase() === 'CR'
      ? { amount: Math.abs(n), type: 'Income' }
      : { amount: -Math.abs(n), type: 'Expense' };
  }
  const signed = Number(cleaned);
  if (!Number.isFinite(signed)) return null;
  return signed >= 0
    ? { amount: signed, type: 'Income' }
    : { amount: signed, type: 'Expense' };
};

export const parseLLPBankStatementText = (text: string): LLPBankStatementRow[] => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: LLPBankStatementRow[] = [];

  const dateRegex =
    /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,9}[-\s]\d{2,4})/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatchAny = line.match(dateRegex);
    if (!dateMatchAny) continue;
    const dateRaw = dateMatchAny[1];
    const normalizedDate = normalizeDate(dateRaw);
    if (!normalizedDate) continue;

    // Many PDFs extract each statement row across multiple lines (date on one line,
    // amounts on the next). Parse a small window around the date line.
    const windowText = lines.slice(i, i + 10).join(' ');
    const datePos = windowText.toLowerCase().indexOf(dateRaw.toLowerCase());
    const rest = datePos >= 0 ? windowText.slice(datePos + dateRaw.length).trim() : windowText;

    const drcrAmount = rest.match(/([\-+]?\d[\d,]*(?:\.\d{1,2})?)\s*(CR|DR)\b/i);
    let amount = 0;
    let type: 'Income' | 'Expense' = 'Expense';
    let amountTextToStrip = '';

    if (drcrAmount) {
      const n = Number(drcrAmount[1].replace(/,/g, ''));
      if (!Number.isFinite(n)) continue;
      type = drcrAmount[2].toUpperCase() === 'CR' ? 'Income' : 'Expense';
      amount = Math.abs(n);
      amountTextToStrip = drcrAmount[0];
    } else {
      // Bank statements like your sample are extracted as:
      //   ... <Dr> <Cr> <Balance>
      // where Dr/Cr can be either a number or `NA`.
      // After the date, we extract the last 3 tokens matching either `NA` or decimal amounts.
      const amtOrNaTokens = [
        ...rest.matchAll(/NA|[0-9]{1,3}(?:,[0-9]{3})*\.\d{1,2}|[0-9]+\.\d{1,2}/gi),
      ].map((m) => m[0]);

      const tail3 = amtOrNaTokens.slice(-3);
      const drToken = tail3[0];
      const crToken = tail3[1];
      const balToken = tail3[2];

      const toNum = (s: string | undefined): number | null => {
        if (!s || s.toUpperCase() === 'NA') return null;
        const cleaned = s.replace(/,/g, '');
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : null;
      };

      const drAmt = toNum(drToken);
      const crAmt = toNum(crToken);
      const balAmt = toNum(balToken);
      const naCount = tail3.filter((t) => (t || '').toUpperCase() === 'NA').length;

      // Only treat it as a transaction row if we see a plausible Dr/Cr pair.
      if (tail3.length === 3 && naCount === 1 && (drAmt != null || crAmt != null) && balAmt != null) {
        if (crAmt != null && drAmt == null) {
          type = 'Income';
          amount = crAmt;
          amountTextToStrip = crToken || '';
        } else if (drAmt != null && crAmt == null) {
          type = 'Expense';
          amount = drAmt;
          amountTextToStrip = drToken || '';
        } else if (crAmt != null && drAmt != null) {
          // Rare/ambiguous extraction (both present). Default to the non-zero larger of the two.
          if (crAmt >= drAmt) {
            type = 'Income';
            amount = crAmt;
            amountTextToStrip = crToken || '';
          } else {
            type = 'Expense';
            amount = drAmt;
            amountTextToStrip = drToken || '';
          }
        }
      } else {
        // Fallback: previous heuristic (less accurate, but helps with other banks/layouts).
        const numericTokens = [...rest.matchAll(/[\-+]?\d[\d,]*(?:\.\d{1,2})?/g)].map((m) => m[0]);
        if (numericTokens.length === 0) continue;

        const tail = numericTokens.slice(-3);
        const tailNums = tail.map((v) => Number(v.replace(/,/g, '')));
        let picked: number | null = null;

        if (tailNums.length === 3) {
          const [a, b] = tailNums;
          if (Number.isFinite(a) && Number.isFinite(b) && (a > 0 || b > 0)) {
            if (a > 0 && b === 0) picked = Math.abs(a); // debit
            if (b > 0 && a === 0) picked = Math.abs(b); // credit
          }
        }

        if (picked === null) {
          const token = numericTokens.length >= 2 ? numericTokens[numericTokens.length - 2] : numericTokens[numericTokens.length - 1];
          const parsed = parseAmountToken(token);
          if (!parsed) continue;
          type = parsed.type;
          amount = Math.abs(parsed.amount);
          amountTextToStrip = token;
          continue;
        }

        // If we got here, amount is positive and type is inferred from which column likely had value.
        // Keep default type as Expense unless we can deduce it from numeric order.
        // This fallback is intentionally conservative.
        amount = Math.abs(picked);
        type = 'Expense';
      }
    }

    const description = rest
      .replace(amountTextToStrip, '')
      .replace(/\s+(CR|DR)\b/i, '')
      .replace(/\bNA\b/gi, '')
      .replace(/[0-9]{1,3}(?:,[0-9]{3})*\.\d{1,2}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!description) continue;
    // Skip statement header/metadata blocks that can accidentally look like rows
    // (they include date ranges + NA placeholders, but not actual transaction narration).
    if (/(transaction period|advanced search|request\/download|cheque number|transaction type)/i.test(description)) continue;
    out.push({
      date: normalizedDate,
      description,
      amount,
      currency: 'INR',
      type,
      category: type === 'Income' ? 'Sales' : 'Bank Expense',
      status: 'Completed',
      entity: 'parent',
    });
  }

  return out;
};

export const extractTextFromBankStatementPDF = async (file: File): Promise<string> => {
  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as any[];
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of items) {
      const str = String(item.str || '').trim();
      if (!str) continue;
      const x = Number(item.transform?.[4] ?? 0);
      const y = Number(item.transform?.[5] ?? 0);
      const key = Math.round(y);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push({ x, str });
    }
    const pageLines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map((r) => r.str).join(' '))
      .filter(Boolean);
    text += `${pageLines.join('\n')}\n`;
  }
  return text;
};

const dedupeKey = (t: Transaction) =>
  [
    t.date,
    t.description.trim().toLowerCase(),
    t.amount.toFixed(2),
    t.type,
    t.source,
    t.category,
  ].join('|');

export const importLLPBankStatement = (
  rows: LLPBankStatementRow[]
): { added: number; skipped: number; errors: string[]; importedIds: string[] } => {
  const ledgerCurrency: 'INR' = 'INR';
  const existing = getTransactions();
  const existingKeys = new Set(existing.map(dedupeKey));
  const toAdd: Transaction[] = [];
  const importedIds: string[] = [];
  const errors: string[] = [];

  rows.forEach((row, idx) => {
    try {
      // Requirement: imported LLP statement transactions must always be stored in INR.
      // If the statement row indicates USD, convert to INR using the app's default sync rate.
      const originalCurrency = (row.currency || 'INR') as 'INR' | 'USD';
      const originalAmountAbs = Math.abs(row.amount);
      const amountInInr =
        originalCurrency === ledgerCurrency
          ? originalAmountAbs
          : convertToBaseSync(originalAmountAbs, originalCurrency, ledgerCurrency);
      const type = row.type || (row.amount >= 0 ? 'Income' : 'Expense');
      const amountForLedger = amountInInr;

      const txn: Transaction = {
        id: `BANK-${Date.now()}-${idx}`,
        date: row.date,
        description: row.sourceRef ? `${row.description} (${row.sourceRef})` : row.description,
        amount: amountForLedger,
        originalAmount: originalAmountAbs,
        originalCurrency,
        currency: ledgerCurrency,
        source: 'IndianBank',
        category: row.category || (type === 'Income' ? 'Revenue' : 'Bank Expense'),
        status: row.status || 'Completed',
        type,
        entity: row.entity || 'parent',
        gstImpact: type === 'Purchase' ? amountInInr * 0.18 : 0,
      };

      const key = dedupeKey(txn);
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      toAdd.push(txn);
      importedIds.push(txn.id);
    } catch (e) {
      errors.push(`Row ${idx + 1}: ${(e as Error).message}`);
    }
  });

  if (toAdd.length > 0) {
    setTransactions([...toAdd, ...existing]);
  }

  return { added: toAdd.length, skipped: rows.length - toAdd.length - errors.length, errors, importedIds };
};

export const convertImportedIndianBankTransactionsToINR = (): {
  converted: number;
  skipped: number;
  errors: string[];
} => {
  const txs = getTransactions();
  const errors: string[] = [];
  let converted = 0;
  let skipped = 0;

  txs
    .filter((t) => t.source === 'IndianBank')
    .forEach((t) => {
      try {
        if (t.currency === 'INR') {
          skipped += 1;
          return;
        }
        if (t.currency !== 'USD') {
          skipped += 1;
          return;
        }

        const convertedAmount = convertToBaseSync(t.amount, 'USD', 'INR');
        const gstImpactConverted =
          typeof t.gstImpact === 'number'
            ? convertToBaseSync(t.gstImpact, 'USD', 'INR')
            : undefined;

        updateTransaction(t.id, {
          currency: 'INR',
          amount: convertedAmount,
          originalAmount: convertedAmount,
          originalCurrency: 'INR',
          gstImpact: gstImpactConverted,
        });
        converted += 1;
      } catch (e) {
        errors.push((e as Error).message || 'Conversion failed');
      }
    });

  return { converted, skipped, errors };
};

export const deleteAllImportedIndianBankTransactions = (): {
  deleted: number;
  skipped: number;
  errors: string[];
} => {
  const txs = getTransactions();
  const errors: string[] = [];
  let deleted = 0;
  let skipped = 0;
  const ids = txs.filter((t) => t.source === 'IndianBank').map((t) => t.id);
  if (ids.length === 0) return { deleted: 0, skipped: 0, errors: [] };

  for (const id of ids) {
    try {
      removeTransaction(id);
      deleted += 1;
    } catch (e) {
      errors.push((e as Error).message || `Failed to delete ${id}`);
    }
  }
  skipped = txs.length - ids.length;
  return { deleted, skipped, errors };
};
