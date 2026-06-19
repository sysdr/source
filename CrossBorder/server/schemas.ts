/**
 * server/schemas.ts — Phase 4: Zod validation schemas + business-rule refinements
 *
 * Validated domains:
 *   Transaction   — amount, currency, type, GST-rate, double-entry GST check
 *   Employee      — required fields, pan/aadhaar format, UAN format
 *   PayrollRun    — positive totals, net = gross − statutory
 *   Invoice       — line-sum integrity, subtotal+tax = total
 *
 * Business rules enforced at the API layer:
 *   • GST rate must be in {0, 5, 12, 18, 28}
 *   • gstImpact (when present) must equal amount × gstRate / 100  (±0.5 tolerance)
 *   • ITC: if itcEligible=true, gstRate must be > 0
 *   • Invoice line amounts: quantity × unitPrice × (1 - discountPct/100) ≈ amount
 *   • Invoice totals: sum(lines.amount) ≈ subtotal; subtotal + taxTotal ≈ total
 *   • PayrollRun: totalNet ≈ totalGross − totalStatutory  (±1 tolerance)
 */

import { z } from 'zod';

// ─── Shared primitives ────────────────────────────────────────────────────────

const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const Currency = z.enum(['USD', 'INR']);
const EntityType = z.enum(['parent', 'subsidiary']).optional();
const GST_RATES = [0, 5, 12, 18, 28] as const;

// ─── Transaction ─────────────────────────────────────────────────────────────

// Base shape used for both full and partial (update) schemas
const TransactionBaseShape = {
  id:              z.string().min(1, 'id required'),
  date:            ISODate,
  description:     z.string().min(1, 'description required'),
  amount:          z.number().positive('amount must be positive'),
  currency:        Currency,
  source:          z.enum(['Stripe', 'LemonSqueezy', 'Mercury', 'IndianBank', 'Manual', 'Substack'] as const),
  category:        z.string().min(1, 'category required'),
  status:          z.enum(['Pending', 'Completed', 'Flagged', 'Failed', 'Refunded'] as const),
  type:            z.enum(['Income', 'Expense', 'Purchase'] as const),
  entity:          EntityType,
  gstImpact:       z.number().nonnegative().optional(),
  gstRate:         z.number().refine(r => (GST_RATES as readonly number[]).includes(r), {
                     message: 'gstRate must be 0, 5, 12, 18, or 28',
                   }).optional(),
  itcEligible:     z.boolean().optional(),
  tdsApplicable:   z.boolean().optional(),
  tdsSection:      z.string().optional(),
  tdsRate:         z.number().min(0).max(100).optional(),
  tdsAmount:       z.number().nonnegative().optional(),
  fxRate:          z.number().positive().optional(),
  feeAmount:       z.number().nonnegative().optional(),
  netAmount:       z.number().optional(),
  narration:       z.string().optional(),
};

// Update schema: all optional except id (no business-rule refinements needed for partial updates)
export const TransactionUpdateSchema = z.object(TransactionBaseShape).partial().required({ id: true }).passthrough();

export const TransactionSchema = z
  .object(TransactionBaseShape)
  .passthrough()
  // ── Business rule 1: GST amount cross-check ──────────────────────────────
  .superRefine((tx, ctx) => {
    if (tx.gstImpact == null || tx.gstRate == null || tx.gstRate === 0) return;
    const expected = (tx.amount * tx.gstRate) / 100;
    if (Math.abs(tx.gstImpact - expected) > 0.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gstImpact'],
        message: `gstImpact (${tx.gstImpact.toFixed(2)}) must equal amount × gstRate / 100 = ${expected.toFixed(2)} (±0.50 tolerance)`,
      });
    }
  })
  // ── Business rule 2: ITC requires a non-zero GST rate ────────────────────
  .superRefine((tx, ctx) => {
    if (tx.itcEligible === true && (!tx.gstRate || tx.gstRate === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itcEligible'],
        message: 'itcEligible=true requires gstRate > 0',
      });
    }
  })
  // ── Business rule 3: TDS amount ≈ amount × tdsRate / 100 ─────────────────
  .superRefine((tx, ctx) => {
    if (tx.tdsAmount == null || tx.tdsRate == null) return;
    const expected = (tx.amount * tx.tdsRate) / 100;
    if (Math.abs(tx.tdsAmount - expected) > 1.0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tdsAmount'],
        message: `tdsAmount (${tx.tdsAmount.toFixed(2)}) must equal amount × tdsRate / 100 = ${expected.toFixed(2)} (±1.00 tolerance)`,
      });
    }
  })
  // ── Business rule 4: netAmount ≤ amount ──────────────────────────────────
  .superRefine((tx, ctx) => {
    if (tx.netAmount != null && tx.netAmount > tx.amount + 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['netAmount'],
        message: `netAmount (${tx.netAmount}) cannot exceed amount (${tx.amount})`,
      });
    }
  });

// ─── Employee ─────────────────────────────────────────────────────────────────

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^\d{12}$/;
const UAN_RE = /^\d{12}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const EmployeeBaseShape = {
  id:          z.string().min(1),
  name:        z.string().min(1, 'name required'),
  designation: z.string().min(1, 'designation required'),
  ctc:         z.number().positive('CTC must be positive'),
  doj:         ISODate,
  status:      z.enum(['Active', 'Inactive', 'Onboarding', 'Notice', 'Exited', 'Archived'] as const),
  email:       z.string().email('invalid email'),
  documents:   z.object({
    pan:      z.boolean(),
    aadhaar:  z.boolean(),
    contract: z.boolean(),
  }),
  panNumber:        z.string().regex(PAN_RE, 'PAN must be in format AAAAA0000A').optional().or(z.literal('')),
  aadhaarNumber:    z.string().regex(AADHAAR_RE, 'Aadhaar must be 12 digits').optional().or(z.literal('')),
  uan:              z.string().regex(UAN_RE, 'UAN must be 12 digits').optional().or(z.literal('')),
  bankIFSC:         z.string().regex(IFSC_RE, 'IFSC must match format e.g. HDFC0001234').optional().or(z.literal('')),
  bankAccountNumber:z.string().optional(),
  gender:           z.enum(['Male', 'Female', 'Other'] as const).optional(),
  employeeType:     z.enum(['Full-time', 'Part-time', 'Contract', 'Intern'] as const).optional(),
  taxRegime:        z.enum(['new', 'old'] as const).optional(),
  noticePeriodDays: z.number().int().nonnegative().optional(),
};

// Update schema: all optional except id
export const EmployeeUpdateSchema = z.object(EmployeeBaseShape).partial().required({ id: true }).passthrough();

export const EmployeeSchema = z
  .object(EmployeeBaseShape)
  .passthrough()
  // Business rule: if documents.pan = true, panNumber should be provided
  .superRefine((e, ctx) => {
    if (e.documents.pan && !e.panNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panNumber'],
        message: 'panNumber is required when documents.pan is marked true',
      });
    }
  })
  // Business rule: if documents.aadhaar = true, aadhaarNumber should be provided
  .superRefine((e, ctx) => {
    if (e.documents.aadhaar && !e.aadhaarNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aadhaarNumber'],
        message: 'aadhaarNumber is required when documents.aadhaar is marked true',
      });
    }
  });

// ─── PayrollRun ───────────────────────────────────────────────────────────────

export const PayrollRunSchema = z
  .object({
    id:             z.string().min(1),
    month:          z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    year:           z.number().int().min(2000).max(2100),
    runAt:          z.string().min(1),
    employeeCount:  z.number().int().positive(),
    totalGross:     z.number().nonnegative(),
    totalStatutory: z.number().nonnegative(),
    totalNet:       z.number().nonnegative(),
    totalEmployerCost: z.number().nonnegative(),
    employeeSlips:  z.array(z.object({
      employeeId:   z.string(),
      employeeName: z.string(),
      netPay:       z.number(),
    }).passthrough()),
  })
  .passthrough()
  // Business rule: totalNet ≈ totalGross − totalStatutory  (±1 for rounding)
  .superRefine((r, ctx) => {
    if (Math.abs(r.totalNet - (r.totalGross - r.totalStatutory)) > 1.0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalNet'],
        message: `totalNet (${r.totalNet.toFixed(2)}) must equal totalGross (${r.totalGross.toFixed(2)}) − totalStatutory (${r.totalStatutory.toFixed(2)}) = ${(r.totalGross - r.totalStatutory).toFixed(2)} (±1.00)`,
      });
    }
  })
  // Business rule: employer cost >= gross (employer contributions on top)
  .superRefine((r, ctx) => {
    if (r.totalEmployerCost < r.totalGross - 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalEmployerCost'],
        message: `totalEmployerCost (${r.totalEmployerCost.toFixed(2)}) must be ≥ totalGross (${r.totalGross.toFixed(2)})`,
      });
    }
  });

// ─── Invoice ──────────────────────────────────────────────────────────────────

const InvoiceLineSchema = z
  .object({
    id:          z.string().min(1),
    description: z.string().min(1),
    quantity:    z.number().positive(),
    unitPrice:   z.number().nonnegative(),
    amount:      z.number().nonnegative(),
    currency:    Currency,
    discountPct: z.number().min(0).max(100).optional(),
    taxRate:     z.number().min(0).max(100).optional(),
    taxAmount:   z.number().nonnegative().optional(),
  })
  .passthrough()
  // Line amount ≈ qty × unitPrice × (1 − discount%)
  .superRefine((l, ctx) => {
    const disc = l.discountPct ?? 0;
    const expected = l.quantity * l.unitPrice * (1 - disc / 100);
    if (Math.abs(l.amount - expected) > 0.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: `Line amount (${l.amount.toFixed(2)}) must equal qty×unitPrice×(1-disc%) = ${expected.toFixed(2)} (±0.50)`,
      });
    }
  });

export const InvoiceSchema = z
  .object({
    id:           z.string().min(1),
    number:       z.string().min(1),
    date:         ISODate,
    dueDate:      ISODate,
    customerName: z.string().min(1),
    status:       z.enum(['Draft', 'Sent', 'Viewed', 'PartiallyPaid', 'Paid', 'Overdue', 'Cancelled']),
    currency:     Currency,
    subtotal:     z.number().nonnegative(),
    taxTotal:     z.number().nonnegative(),
    total:        z.number().nonnegative(),
    lines:        z.array(InvoiceLineSchema),
    createdAt:    z.string(),
    updatedAt:    z.string(),
  })
  .passthrough()
  // Invoice total = subtotal + taxTotal  (±0.50)
  .superRefine((inv, ctx) => {
    if (Math.abs(inv.total - (inv.subtotal + inv.taxTotal)) > 0.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: `total (${inv.total.toFixed(2)}) must equal subtotal (${inv.subtotal.toFixed(2)}) + taxTotal (${inv.taxTotal.toFixed(2)}) = ${(inv.subtotal + inv.taxTotal).toFixed(2)} (±0.50)`,
      });
    }
  })
  // Sum of line amounts ≈ subtotal  (±0.50 × line-count for rounding)
  .superRefine((inv, ctx) => {
    if (!inv.lines.length) return;
    const lineSum = inv.lines.reduce((s, l) => s + l.amount, 0);
    const tolerance = Math.max(0.5, inv.lines.length * 0.05);
    if (Math.abs(lineSum - inv.subtotal) > tolerance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subtotal'],
        message: `Sum of line amounts (${lineSum.toFixed(2)}) must equal subtotal (${inv.subtotal.toFixed(2)})`,
      });
    }
  })
  // dueDate >= date
  .superRefine((inv, ctx) => {
    if (inv.dueDate < inv.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueDate'],
        message: 'dueDate must be on or after invoice date',
      });
    }
  });

// ─── Validation helper ────────────────────────────────────────────────────────

/**
 * Returns null if valid, or an error message string if validation fails.
 * Usage: const err = validate(Schema, data); if (err) respond(422, {error: err});
 */
export function validate(
  schema: z.ZodType,
  data: unknown,
): string | null {
  const result = schema.safeParse(data);
  if (result.success) return null;
  const issues = result.error.issues;
  return issues
    .map(i => `${(i.path as (string | number)[]).join('.') || 'root'}: ${i.message}`)
    .join('; ');
}

/** Validate an array; returns array of {index, error} for any failed items. */
export function validateArray(
  schema: z.ZodType,
  items: unknown[],
): Array<{ index: number; error: string }> {
  const errors: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < items.length; i++) {
    const err = validate(schema, items[i]);
    if (err) errors.push({ index: i, error: err });
  }
  return errors;
}
