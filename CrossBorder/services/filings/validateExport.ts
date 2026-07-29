/**
 * Schema-validation pipeline for regulatory exports (REQ-029, T-007).
 * Validates generated payloads against Zod schemas before download is offered.
 */
import { z } from 'zod';

export type ExportKind = 'gstr1' | 'gstr3b' | 'form24q' | 'form26q' | 'form5472' | 'epfEcr';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T = unknown> {
  ok: boolean;
  kind: ExportKind;
  data?: T;
  issues: ValidationIssue[];
}

const money = z.number().finite().nonnegative();
const gstin = z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i, 'Invalid GSTIN');
const fp = z.string().regex(/^(0[1-9]|1[0-2])[0-9]{4}$/, 'Filing period must be MMYYYY');

const gstr1ItemDet = z.object({
  rt: z.number().nonnegative(),
  txval: money,
  iamt: money.optional().default(0),
  camt: money.optional().default(0),
  samt: money.optional().default(0),
  csamt: money.optional().default(0),
});

export const Gstr1Schema = z.object({
  gstin: z.string().min(1),
  fp,
  version: z.string().min(1),
  hash: z.string().optional(),
  b2b: z.array(z.object({
    ctin: z.string().min(1),
    inv: z.array(z.object({
      inum: z.string().min(1),
      idt: z.string().min(1),
      val: money,
      pos: z.string().min(1),
      rchrg: z.enum(['Y', 'N']).default('N'),
      inv_typ: z.string().default('R'),
      itms: z.array(z.object({ num: z.number().int().positive(), itm_det: gstr1ItemDet })),
    })).min(1),
  })),
  exp: z.array(z.object({
    exp_typ: z.enum(['WPAY', 'WOPAY']),
    inv: z.array(z.object({
      inum: z.string().min(1),
      idt: z.string().min(1),
      val: money,
      sbnum: z.string().optional(),
      sbdt: z.string().optional(),
    })),
  })),
  b2cl: z.array(z.object({
    pos: z.string().min(1),
    inv: z.array(z.object({
      inum: z.string().min(1),
      idt: z.string().min(1),
      val: money,
      itms: z.array(z.object({ num: z.number().int().positive(), itm_det: gstr1ItemDet })),
    })),
  })),
  b2cs: z.array(z.object({
    sply_ty: z.enum(['INTRA', 'INTER']),
    rt: z.number().nonnegative(),
    typ: z.literal('OE'),
    pos: z.string().min(1),
    txval: money,
    iamt: money.optional().default(0),
    camt: money.optional().default(0),
    samt: money.optional().default(0),
    csamt: money.optional().default(0),
  })),
  meta: z.object({
    disclaimer: z.string().min(20),
    generatedAt: z.string().min(1),
    forReviewOnly: z.literal(true),
  }),
});

export const Gstr3bSchema = z.object({
  gstin: z.string().min(1),
  ret_period: fp,
  sup_details: z.object({
    osup_det: z.object({ txval: money, iamt: money, camt: money, samt: money, csamt: money }),
    osup_zero: z.object({ txval: money, iamt: money, camt: money, samt: money, csamt: money }),
    osup_nil_exmp: z.object({ txval: money, iamt: money, camt: money, samt: money, csamt: money }),
    isup_rev: z.object({ txval: money, iamt: money, camt: money, samt: money, csamt: money }),
    osup_nongst: z.object({ txval: money, iamt: money, camt: money, samt: money, csamt: money }),
  }),
  itc_elg: z.object({
    itc_avl: z.array(z.object({
      ty: z.string(),
      iamt: money,
      camt: money,
      samt: money,
      csamt: money,
    })),
    itc_rev: z.array(z.object({
      ty: z.string(),
      iamt: money,
      camt: money,
      samt: money,
      csamt: money,
    })),
    itc_net: z.object({ iamt: money, camt: money, samt: money, csamt: money }),
    itc_inelg: z.array(z.object({
      ty: z.string(),
      iamt: money,
      camt: money,
      samt: money,
      csamt: money,
    })),
  }),
  meta: z.object({
    disclaimer: z.string().min(20),
    generatedAt: z.string().min(1),
    forReviewOnly: z.literal(true),
  }),
});

export const Form24qRowSchema = z.object({
  srNo: z.number().int().positive(),
  employeePan: z.string().min(1),
  employeeName: z.string().min(1),
  sectionCode: z.literal('192'),
  paymentDate: z.string().min(1),
  amountPaid: money,
  tdsDeducted: money,
  tdsDeposited: money,
  deductorTan: z.string().min(1),
  assessmentYear: z.string().regex(/^[0-9]{4}-[0-9]{2}$/),
});

export const Form24qSchema = z.object({
  form: z.literal('24Q'),
  quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']),
  financialYear: z.string().min(1),
  deductorName: z.string().min(1),
  deductorTan: z.string().min(1),
  rows: z.array(Form24qRowSchema),
  csv: z.string().min(1),
  meta: z.object({
    disclaimer: z.string().min(20),
    generatedAt: z.string().min(1),
    forReviewOnly: z.literal(true),
  }),
});

export const Form5472Schema = z.object({
  form: z.literal('5472'),
  reportingCorporation: z.object({
    name: z.string().min(1),
    ein: z.string().min(1),
  }),
  relatedParty: z.object({
    name: z.string().min(1),
    country: z.string().min(1),
  }),
  taxYear: z.string().min(4),
  transactions: z.array(z.object({
    date: z.string().min(1),
    description: z.string().min(1),
    amountUsd: z.number().finite(),
    amountInr: z.number().finite().optional(),
    transactionType: z.enum([
      'purchases',
      'sales',
      'rents',
      'royalties',
      'interest',
      'service_fees',
      'other',
    ]),
    direction: z.enum(['inbound', 'outbound']),
  })),
  meta: z.object({
    disclaimer: z.string().min(20),
    generatedAt: z.string().min(1),
    forReviewOnly: z.literal(true),
  }),
});

export const Form26qRowSchema = z.object({
  srNo: z.number().int().positive(),
  deducteePan: z.string().min(1),
  deducteeName: z.string().min(1),
  sectionCode: z.string().min(1),
  paymentDate: z.string().min(1),
  amountPaid: money,
  tdsDeducted: money,
  tdsDeposited: money,
  deductorTan: z.string().min(1),
  assessmentYear: z.string().regex(/^[0-9]{4}-[0-9]{2}$/),
});

export const Form26qSchema = z.object({
  form: z.literal('26Q'),
  quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']),
  financialYear: z.string().min(1),
  deductorName: z.string().min(1),
  deductorTan: z.string().min(1),
  rows: z.array(Form26qRowSchema),
  csv: z.string().min(1),
  meta: z.object({
    disclaimer: z.string().min(20),
    generatedAt: z.string().min(1),
    forReviewOnly: z.literal(true),
  }),
});

export const EpfEcrMemberSchema = z.object({
  uan: z.string().min(1),
  memberName: z.string().min(1),
  grossWages: money,
  epfWages: money.max(15000),
  epsWages: money.max(15000),
  edliWages: money.max(15000),
  epfContribution: money,
  epsContribution: money,
  ncpDays: z.number().int().nonnegative(),
  refund: money,
});

export const EpfEcrSchema = z.object({
  form: z.literal('EPF_ECR'),
  month: z.string().min(1),
  year: z.number().int(),
  employerName: z.string().min(1),
  establishmentId: z.string().min(1),
  members: z.array(EpfEcrMemberSchema),
  text: z.string().min(1),
  fieldOrder: z.array(z.string()).min(1),
  meta: z.object({
    disclaimer: z.string().min(20),
    generatedAt: z.string().min(1),
    forReviewOnly: z.literal(true),
  }),
});

const SCHEMAS: Record<ExportKind, z.ZodTypeAny> = {
  gstr1: Gstr1Schema,
  gstr3b: Gstr3bSchema,
  form24q: Form24qSchema,
  form26q: Form26qSchema,
  form5472: Form5472Schema,
  epfEcr: EpfEcrSchema,
};

export function validateExport<T = unknown>(kind: ExportKind, data: unknown): ValidationResult<T> {
  const schema = SCHEMAS[kind];
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return { ok: true, kind, data: parsed.data as T, issues: [] };
  }
  return {
    ok: false,
    kind,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  };
}

/** Soft GSTIN check — generators may emit placeholder when org profile incomplete */
export function isLikelyGstin(value: string): boolean {
  return gstin.safeParse(value).success;
}
