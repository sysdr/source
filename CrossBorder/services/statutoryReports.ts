import { jsPDF } from 'jspdf';
import { Employee, PayrollRun, PayrollRunSlip, CompanyProfile } from '../types';
import { computeYTD, MONTHS } from './payrollCalculator';
import { getWithholdingPayments, getForeignIncomeRecords, getCompanyProfile } from './storageService';

function downloadFile(content: string, filename: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Form 24Q (Quarterly TDS on Salary) CSV ──────────────────────────────────

export function generateForm24QCSV(
  employees: Employee[],
  runs: PayrollRun[],
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4',
  financialYear: string,
  profile: CompanyProfile,
): void {
  const quarterMonths: Record<string, string[]> = {
    Q1: ['April', 'May', 'June'],
    Q2: ['July', 'August', 'September'],
    Q3: ['October', 'November', 'December'],
    Q4: ['January', 'February', 'March'],
  };
  const months = quarterMonths[quarter];
  const [fyStart] = financialYear.split('-').map(Number);
  const quarterRuns = runs.filter((r) => {
    if (!months.includes(r.month)) return false;
    const expectedYear = ['January', 'February', 'March'].includes(r.month) ? fyStart + 1 : fyStart;
    return r.year === expectedYear;
  });

  const allSlips = quarterRuns.flatMap((r) => r.employeeSlips);

  const header = [
    'Sr No', 'Employee PAN', 'Employee Name', 'Section Code', 'Payment Date',
    'Amount Paid/Credited', 'TDS Deducted', 'TDS Deposited', 'Deductor TAN',
    'Assessment Year',
  ].join(',');

  const rows: string[] = [];
  let sr = 1;
  for (const emp of employees) {
    const empSlips = allSlips.filter((s) => s.employeeId === emp.id);
    if (empSlips.length === 0) continue;
    const totalPaid = empSlips.reduce((a, s) => a + s.grossEarnings, 0);
    const totalTDS = empSlips.reduce((a, s) => a + s.tds, 0);
    if (totalTDS <= 0) continue;
    rows.push([
      sr++,
      emp.panNumber || 'PANNOTAVBL',
      `"${emp.name}"`,
      '192',
      quarterRuns[quarterRuns.length - 1]?.runAt?.split('T')[0] || '',
      Math.round(totalPaid),
      Math.round(totalTDS),
      Math.round(totalTDS),
      profile.parent?.taxId || '',
      `${fyStart + 1}-${String(fyStart + 2).slice(2)}`,
    ].join(','));
  }

  const content = [
    `# Form 24Q - Quarterly Statement of TDS on Salary`,
    `# Quarter: ${quarter} | Financial Year: ${financialYear}`,
    `# Deductor: ${profile.parent?.name || ''} | TAN: ${profile.parent?.taxId || ''}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    header,
    ...rows,
  ].join('\n');

  downloadFile(content, `Form24Q_${quarter}_${financialYear}.csv`, 'text/csv');
}

// ── PF ECR Text File ────────────────────────────────────────────────────────

export function generatePFECR(
  employees: Employee[],
  run: PayrollRun,
  profile: CompanyProfile,
): void {
  const lines: string[] = [];
  lines.push(`#~#${profile.parent?.name || 'Company'}#~#${profile.parent?.taxId || ''}#~#${run.month} ${run.year}#~#EPFO ECR#~#`);
  lines.push('');

  for (const slip of run.employeeSlips) {
    const emp = employees.find((e) => e.id === slip.employeeId);
    if (!emp) continue;
    const pfWage = Math.min(slip.basic, 15000);
    const epsWage = Math.min(slip.basic, 15000);
    const edliWage = Math.min(slip.basic, 15000);
    const epfContrib = slip.epf;
    const epsContrib = slip.epsEmployer;
    const ncpDays = slip.lopDays || 0;
    // UAN#MEMBER_NAME#GROSS_WAGES#EPF_WAGES#EPS_WAGES#EDLI_WAGES#EPF_CONTRIBUTION#EPS_CONTRIBUTION#NCP_DAYS#REFUND
    lines.push([
      emp.uan || '000000000000',
      emp.name.toUpperCase(),
      Math.round(slip.grossEarnings),
      pfWage,
      epsWage,
      edliWage,
      epfContrib,
      epsContrib,
      ncpDays,
      0,
    ].join('#'));
  }

  downloadFile(lines.join('\n'), `PF_ECR_${run.month}_${run.year}.txt`);
}

// ── ESI Monthly Return ──────────────────────────────────────────────────────

export function generateESIReturn(
  employees: Employee[],
  run: PayrollRun,
): void {
  const header = ['Sr No', 'ESI Number', 'Employee Name', 'No of Days Worked', 'Total Earnings', 'Employee Contribution', 'Employer Contribution', 'IP Contribution'].join(',');
  const rows: string[] = [];
  let sr = 1;
  for (const slip of run.employeeSlips) {
    if (slip.esiEmployee <= 0) continue;
    const emp = employees.find((e) => e.id === slip.employeeId);
    if (!emp) continue;
    rows.push([
      sr++,
      emp.esiNumber || '',
      `"${emp.name}"`,
      slip.paidDays,
      Math.round(slip.grossEarnings),
      slip.esiEmployee,
      slip.esiEmployer,
      0,
    ].join(','));
  }

  if (rows.length === 0) {
    rows.push('# No ESI-eligible employees for this period');
  }

  const content = [
    `# ESI Monthly Return - ${run.month} ${run.year}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    header,
    ...rows,
  ].join('\n');

  downloadFile(content, `ESI_Return_${run.month}_${run.year}.csv`, 'text/csv');
}

// ── PT Monthly Challan ──────────────────────────────────────────────────────

export function generatePTChallan(
  employees: Employee[],
  run: PayrollRun,
  profile: CompanyProfile,
): void {
  const header = ['Sr No', 'Employee Name', 'PAN', 'Gross Salary', 'PT Amount'].join(',');
  const rows: string[] = [];
  let sr = 1;
  let totalPT = 0;
  for (const slip of run.employeeSlips) {
    if (slip.pt <= 0) continue;
    const emp = employees.find((e) => e.id === slip.employeeId);
    if (!emp) continue;
    totalPT += slip.pt;
    rows.push([
      sr++,
      `"${emp.name}"`,
      emp.panNumber || '',
      Math.round(slip.grossEarnings),
      slip.pt,
    ].join(','));
  }

  const content = [
    `# Professional Tax Challan - ${run.month} ${run.year}`,
    `# State: ${profile.payroll?.ptState || ''}`,
    `# Employer: ${profile.parent?.name || ''}`,
    `# Total PT: ${totalPT}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    header,
    ...rows,
  ].join('\n');

  downloadFile(content, `PT_Challan_${run.month}_${run.year}.csv`, 'text/csv');
}

// ── Bank Payment File (NEFT Batch) ──────────────────────────────────────────

export function generateBankFile(
  employees: Employee[],
  run: PayrollRun,
  profile: CompanyProfile,
): void {
  const header = ['Payment Seq', 'Beneficiary Name', 'Account Number', 'IFSC Code', 'Amount', 'Payment Mode', 'Narration'].join(',');
  const rows: string[] = [];
  let seq = 1;
  for (const slip of run.employeeSlips) {
    const emp = employees.find((e) => e.id === slip.employeeId);
    if (!emp) continue;
    rows.push([
      seq++,
      `"${emp.name}"`,
      emp.bankAccountNumber || '',
      emp.bankIFSC || '',
      Math.round(slip.netPay),
      'NEFT',
      `"Salary ${run.month} ${run.year}"`,
    ].join(','));
  }

  const content = [
    `# Bank Payment File - NEFT Batch`,
    `# Month: ${run.month} ${run.year}`,
    `# Debit Account: ${profile.parent?.name || ''}`,
    `# Total Amount: ${run.totalNet}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    header,
    ...rows,
  ].join('\n');

  downloadFile(content, `Bank_Payment_${run.month}_${run.year}.csv`, 'text/csv');
}

// ── Form 16 PDF Generation ──────────────────────────────────────────────────

export function generateForm16PDF(
  emp: Employee,
  runs: PayrollRun[],
  financialYear: string,
  profile: CompanyProfile,
): void {
  const allSlips = runs.flatMap((r) => r.employeeSlips);
  const ytd = computeYTD(emp.id, emp.name, allSlips);

  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 20;

  doc.setFillColor(245, 247, 250);
  doc.rect(0, 0, pageW, 50, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.line(0, 50, pageW, 50);

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('FORM No. 16', pageW / 2, y, { align: 'center' });
  y += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Certificate under section 203 of the Income-tax Act, 1961', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.text(`Financial Year: ${financialYear} | Assessment Year: ${getAY(financialYear)}`, pageW / 2, y, { align: 'center' });

  y = 60;

  // Part A - Employer Details
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('PART A', margin, y);
  y += 8;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const col1 = margin;
  const col2 = margin + 80;

  const partA = [
    ['Name of Deductor', profile.parent?.name || ''],
    ['TAN of Deductor', profile.parent?.taxId || ''],
    ['PAN of Deductor', profile.parent?.pan || ''],
    ['Address', `${profile.parent?.state || ''}, India`],
    ['', ''],
    ['Name of Employee', emp.name],
    ['PAN of Employee', emp.panNumber || 'N/A'],
    ['Employee ID', emp.id],
    ['Designation', emp.designation],
    ['Date of Joining', emp.doj],
  ];

  for (const [label, value] of partA) {
    if (!label) { y += 4; continue; }
    doc.setTextColor(100, 116, 139);
    doc.text(label, col1, y);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text(value, col2, y);
    doc.setFont('helvetica', 'normal');
    y += 6;
  }

  y += 10;

  // Part B - Income details
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('PART B - Details of Salary Paid and Tax Deducted', margin, y);
  y += 10;

  const fmt = (n: number) => `INR ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  doc.setFontSize(8);

  const partB: [string, string][] = [
    ['1. Gross Salary (Sec 17(1))', fmt(ytd.totalGross)],
    ['   a) Basic Salary', fmt(ytd.totalBasic)],
    ['   b) HRA', fmt(ytd.totalHRA)],
    ['   c) Special Allowance', fmt(ytd.totalAllowance)],
    ['2. Less: Exemptions (Sec 10)', fmt(0)],
    ['3. Income Chargeable under Salaries', fmt(ytd.totalGross)],
    ['4. Less: Deductions under Chapter VI-A', ''],
    [`   a) Sec 80C (EPF + declared)`, fmt(Math.min(150000, ytd.totalEPF + (emp.section80C ?? 0)))],
    [`   b) Sec 80D (Medical)`, fmt(Math.min(25000, emp.section80D ?? 0))],
    ['5. Total Tax Payable', fmt(ytd.totalTDS)],
    ['6. Less: Relief u/s 87A (if applicable)', fmt(0)],
    ['7. Tax Deducted at Source', fmt(ytd.totalTDS)],
    ['8. Months Processed', String(ytd.monthsProcessed)],
  ];

  for (const [label, value] of partB) {
    doc.setFont('helvetica', label.startsWith(' ') ? 'normal' : 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(label, col1, y);
    doc.text(value, pageW - margin, y, { align: 'right' });
    y += 6;
  }

  y += 10;

  // Monthly Breakdown table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Monthly TDS Summary', margin, y);
  y += 8;

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  const cols = [margin, margin + 30, margin + 60, margin + 90, margin + 120, margin + 140];
  doc.text('Month', cols[0], y);
  doc.text('Gross', cols[1], y);
  doc.text('EPF', cols[2], y);
  doc.text('PT', cols[3], y);
  doc.text('TDS', cols[4], y);
  doc.text('Net', cols[5], y);
  y += 5;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  for (const run of runs) {
    const slip = run.employeeSlips.find((s) => s.employeeId === emp.id);
    if (!slip) continue;
    doc.text(run.month.slice(0, 3), cols[0], y);
    doc.text(fmt(slip.grossEarnings), cols[1], y);
    doc.text(fmt(slip.epf), cols[2], y);
    doc.text(fmt(slip.pt), cols[3], y);
    doc.text(fmt(slip.tds), cols[4], y);
    doc.text(fmt(slip.netPay), cols[5], y);
    y += 5;
    if (y > 270) { doc.addPage(); y = 20; }
  }

  y += 10;
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text('This is a computer-generated Form 16. Verify with actual TDS certificates from TRACES portal.', pageW / 2, y, { align: 'center' });
  doc.text('Generated via CrossBorder Financial OS', pageW / 2, y + 5, { align: 'center' });

  const [fy1] = financialYear.split('-');
  doc.save(`Form16_${emp.name.replace(/\s+/g, '_')}_FY${fy1}.pdf`);
}

function getAY(fy: string): string {
  const [start] = fy.split('-').map(Number);
  return `${start + 1}-${String(start + 2).slice(2)}`;
}

// ── Payroll Register ────────────────────────────────────────────────────────

export function generatePayrollRegister(
  employees: Employee[],
  run: PayrollRun,
): void {
  const header = [
    'Emp ID', 'Name', 'PAN', 'UAN', 'Department', 'Working Days', 'Paid Days', 'LOP Days',
    'Basic', 'HRA', 'Allowance', 'Gross',
    'EPF (Emp)', 'ESI (Emp)', 'PT', 'TDS', 'Total Deductions',
    'Net Pay',
    'EPF (Employer)', 'EPS (Employer)', 'ESI (Employer)',
  ].join(',');

  const rows: string[] = [];
  for (const slip of run.employeeSlips) {
    const emp = employees.find((e) => e.id === slip.employeeId);
    if (!emp) continue;
    rows.push([
      emp.id,
      `"${emp.name}"`,
      emp.panNumber || '',
      emp.uan || '',
      emp.department || '',
      slip.workingDays,
      slip.paidDays,
      slip.lopDays,
      slip.basic,
      slip.hra,
      slip.allowance,
      slip.grossEarnings,
      slip.epf,
      slip.esiEmployee,
      slip.pt,
      slip.tds,
      slip.totalDeductions,
      slip.netPay,
      slip.epfEmployer,
      slip.epsEmployer,
      slip.esiEmployer,
    ].join(','));
  }

  const content = [
    `# Payroll Register - ${run.month} ${run.year}`,
    `# Total Employees: ${run.employeeCount}`,
    `# Total Net Payout: ${run.totalNet}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    header,
    ...rows,
  ].join('\n');

  downloadFile(content, `Payroll_Register_${run.month}_${run.year}.csv`, 'text/csv');
}

// ── Form 26Q (TDS non-salary) ───────────────────────────────────────────────

export function generateForm26QCSV(
  quarter: string,
  financialYear: string,
  profile?: CompanyProfile | null,
): void {
  const deductorProfile = profile ?? getCompanyProfile();
  const withholdings = getWithholdingPayments().filter(
    (w) => w.quarter === quarter && w.financialYear === financialYear && w.section !== '192',
  );
  const header = [
    'Sr No', 'PAN of Deductee', 'Name', 'Section', 'Amount Paid', 'TDS Deducted', 'Payment Date',
    'Deductor TAN', 'Assessment Year',
  ].join(',');
  const rows = withholdings.map((w, i) => [
    i + 1,
    '',
    `"${w.payeeName}"`,
    w.section,
    Math.round(w.amount),
    Math.round(w.withheldAmount),
    w.date,
    deductorProfile?.parent?.taxId || '',
    `${parseInt(financialYear, 10) + 1}-${String(parseInt(financialYear, 10) + 2).slice(2)}`,
  ].join(','));
  const content = [
    `# Form 26Q - Quarterly TDS (Non-Salary)`,
    `# Quarter: ${quarter} | FY: ${financialYear}`,
    `# Deductor: ${deductorProfile?.parent?.name || ''}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    header,
    ...rows,
  ].join('\n');
  downloadFile(content, `Form26Q_${quarter}_${financialYear}.csv`, 'text/csv');
}

// ── Form 27Q (TDS non-resident) ───────────────────────────────────────────────

export function generateForm27QCSV(
  quarter: string,
  financialYear: string,
  profile?: CompanyProfile | null,
): void {
  const deductorProfile = profile ?? getCompanyProfile();
  const withholdings = getWithholdingPayments().filter(
    (w) => w.quarter === quarter && w.financialYear === financialYear && w.payeeCountry !== 'IN',
  );
  const header = [
    'Sr No', 'PAN/TAX ID', 'Name', 'Country', 'Section', 'Amount', 'TDS', 'Treaty', 'Payment Date', 'TAN', 'AY',
  ].join(',');
  const rows = withholdings.map((w, i) => [
    i + 1,
    '',
    `"${w.payeeName}"`,
    w.payeeCountry,
    w.section,
    Math.round(w.amount),
    Math.round(w.withheldAmount),
    w.treatyUsed || '',
    w.date,
    deductorProfile?.parent?.taxId || '',
    `${parseInt(financialYear, 10) + 1}-${String(parseInt(financialYear, 10) + 2).slice(2)}`,
  ].join(','));
  const content = [
    `# Form 27Q - TDS on payments to Non-Residents`,
    `# Quarter: ${quarter} | FY: ${financialYear}`,
    `# Deductor: ${deductorProfile?.parent?.name || ''}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    header,
    ...rows,
  ].join('\n');
  downloadFile(content, `Form27Q_${quarter}_${financialYear}.csv`, 'text/csv');
}

// ── TDS Certificate (draft text) ─────────────────────────────────────────────

export function generateTDSCertificateText(
  payeeName: string,
  panOrTaxId: string,
  section: string,
  amountPaid: number,
  tdsDeducted: number,
  paymentDate: string,
  quarter: string,
  financialYear: string,
  profile?: CompanyProfile | null,
): string {
  const p = profile ?? getCompanyProfile();
  const ay = `${parseInt(financialYear, 10) + 1}-${String(parseInt(financialYear, 10) + 2).slice(2)}`;
  return [
    'TDS CERTIFICATE (Draft)',
    `Section: ${section}`,
    `Deductor: ${p?.parent?.name ?? ''} | TAN: ${p?.parent?.taxId ?? ''}`,
    `Payee: ${payeeName} | PAN/TAX ID: ${panOrTaxId}`,
    `Period: ${quarter} ${financialYear} | Assessment Year: ${ay}`,
    `Amount paid/credited: ${amountPaid}`,
    `TDS deducted: ${tdsDeducted}`,
    `Payment date: ${paymentDate}`,
    `Generated: ${new Date().toISOString()}`,
  ].join('\n');
}

// ── Foreign Income Schedule (ITR) ─────────────────────────────────────────────

export function generateForeignIncomeScheduleCSV(
  startDate: string,
  endDate: string,
): void {
  const records = getForeignIncomeRecords().filter(
    (r) => r.date >= startDate && r.date <= endDate,
  );
  const header = [
    'Date', 'Description', 'Amount', 'Currency', 'Country', 'Income Type', 'Classification', 'Sourcing',
  ].join(',');
  const rows = records.map((r) => [
    r.date,
    `"${r.description}"`,
    r.amount,
    r.currency,
    r.customerCountry,
    r.incomeType,
    r.classification,
    r.sourcingCountry ?? '',
  ].join(','));
  const content = [
    `# Foreign Income Schedule - ${startDate} to ${endDate}`,
    `# For ITR / Tax Computation`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    header,
    ...rows,
  ].join('\n');
  downloadFile(content, `Foreign_Income_Schedule_${startDate}_${endDate}.csv`, 'text/csv');
}
