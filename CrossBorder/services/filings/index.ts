/**
 * Filing export barrel — schema-validated regulatory generators (EPIC-02 / EPIC-04).
 */
export { FILING_DISCLAIMER, FILING_DISCLAIMER_META_KEY, disclaimerCommentLines, withDisclaimerMeta } from './disclaimer';
export {
  validateExport,
  Gstr1Schema,
  Gstr3bSchema,
  Form24qSchema,
  Form26qSchema,
  Form5472Schema,
  EpfEcrSchema,
  type ExportKind,
  type ValidationResult,
  type ValidationIssue,
} from './validateExport';
export { buildGstr1Payload, generateGstr1, gstr1ToJsonString } from './gstr1';
export { buildGstr3bPayload, generateGstr3b } from './gstr3b';
export { buildForm24qPayload, generateForm24q, FORM24Q_NSDL_HEADERS, type Quarter } from './form24q';
export {
  buildForm26qPayload,
  generateForm26q,
  FORM26Q_NSDL_HEADERS,
  withholdingsTo26qDeductees,
  transactionsTo26qDeductees,
  type Form26qDeducteeInput,
  type Form26qInput,
} from './form26q';
export { buildForm5472Payload, generateForm5472, form5472ToCsv } from './form5472';
export {
  buildEpfEcrPayload,
  generateEpfEcr,
  EPF_ECR_FIELDS,
  EPF_WAGE_CEILING,
  type EpfEcrInput,
} from './epfEcr';

/** Deferred MVP filings (REQ-054) — UI must show Coming Soon, not broken buttons.
 * Form 26Q promoted to MVP by T-020 / REQ-010 superseding the earlier deferral. */
export const DEFERRED_FILINGS = [
  { id: 'gstr9', title: 'GSTR-9 Annual Return', reason: 'Deferred to v2 per REQ-054' },
  { id: 'form1120', title: 'Form 1120 (US Corporate Tax)', reason: 'Deferred to v2 per REQ-054' },
] as const;
