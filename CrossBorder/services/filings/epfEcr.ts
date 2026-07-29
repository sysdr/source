/**
 * EPFO Electronic Challan-cum-Return (ECR) text generator (REQ-013, REQ-050 / T-020).
 * Pure builder — # delimited member rows per EPFO portal upload contract (MVP).
 */
import type { CompanyProfile, Employee, PayrollRun } from '../../types';
import { disclaimerCommentLines, withDisclaimerMeta } from './disclaimer';
import { validateExport, type ValidationResult } from './validateExport';

/** Documented field order for each member line (EPFO ECR text). */
export const EPF_ECR_FIELDS = [
  'UAN',
  'MEMBER_NAME',
  'GROSS_WAGES',
  'EPF_WAGES',
  'EPS_WAGES',
  'EDLI_WAGES',
  'EPF_CONTRIBUTION',
  'EPS_CONTRIBUTION',
  'NCP_DAYS',
  'REFUND',
] as const;

export const EPF_WAGE_CEILING = 15000;

export interface EpfEcrInput {
  employees: Employee[];
  run: PayrollRun;
  profile: CompanyProfile;
}

export function buildEpfEcrPayload(input: EpfEcrInput) {
  const establishmentId = input.profile.parent?.epfNumber
    || input.profile.parent?.taxId
    || 'ESTNOTAVBL';
  const employerName = input.profile.parent?.name || 'Company';

  const members = input.run.employeeSlips
    .map((slip) => {
      const emp = input.employees.find((e) => e.id === slip.employeeId);
      if (!emp) return null;
      const pfWage = Math.min(Math.round(slip.basic), EPF_WAGE_CEILING);
      const epsWage = Math.min(Math.round(slip.basic), EPF_WAGE_CEILING);
      const edliWage = Math.min(Math.round(slip.basic), EPF_WAGE_CEILING);
      return {
        uan: emp.uan || '000000000000',
        memberName: emp.name.toUpperCase(),
        grossWages: Math.round(slip.grossEarnings),
        epfWages: pfWage,
        epsWages: epsWage,
        edliWages: edliWage,
        epfContribution: Math.round(slip.epf),
        epsContribution: Math.round(slip.epsEmployer),
        ncpDays: slip.lopDays || 0,
        refund: 0,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m != null);

  const headerLine = `#~#${employerName}#~#${establishmentId}#~#${input.run.month} ${input.run.year}#~#EPFO ECR#~#`;
  const memberLines = members.map((m) => [
    m.uan,
    m.memberName,
    m.grossWages,
    m.epfWages,
    m.epsWages,
    m.edliWages,
    m.epfContribution,
    m.epsContribution,
    m.ncpDays,
    m.refund,
  ].join('#'));

  const text = [
    ...disclaimerCommentLines().map((l) => l.replace(/^# /, '#~#')),
    headerLine,
    '',
    ...memberLines,
  ].join('\n');

  return withDisclaimerMeta({
    form: 'EPF_ECR' as const,
    month: input.run.month,
    year: input.run.year,
    employerName,
    establishmentId,
    members,
    text,
    fieldOrder: [...EPF_ECR_FIELDS],
  });
}

export function generateEpfEcr(input: EpfEcrInput): ValidationResult {
  const payload = buildEpfEcrPayload(input);
  return validateExport('epfEcr', payload);
}
