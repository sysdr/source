import React, { useState, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import { Employee, CompanyProfile, PayrollRun as PayrollRunType } from '../../types';
import {
  getLeaveRequests, getLeaveBalance, getPayrollRunForCycle,
  addTransaction,
} from '../../services/storageService';
import {
  computeFullSalary, FullSalaryResult, MONTHS,
} from '../../services/payrollCalculator';
import type { Transaction, PayrollRunSlip } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const fmt = (val?: number | null) =>
  (Number.isFinite(val) ? (val as number) : 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

type PayslipFormat = 'txt' | 'pdf' | 'html';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  employees: Employee[];
  profile: CompanyProfile | null;
  allRuns: PayrollRunType[];
  selectedMonth: string;
  selectedYear: number;
  setSelectedMonth: (v: string) => void;
  setSelectedYear: (v: number) => void;
  payslipFormat: PayslipFormat;
  setPayslipFormat: (v: PayslipFormat) => void;
  onAddRun: (run: PayrollRunType) => void;
  toast: (type: 'success' | 'error' | 'info', text: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const PayrollRun: React.FC<Props> = ({
  employees,
  profile,
  allRuns,
  selectedMonth,
  selectedYear,
  setSelectedMonth,
  setSelectedYear,
  payslipFormat,
  setPayslipFormat,
  onAddRun,
  toast,
}) => {
  const [isRunningPayroll, setIsRunningPayroll] = useState(false);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [slipPreview, setSlipPreview] = useState<{ emp: Employee; slip: FullSalaryResult } | null>(null);

  const activeEmployees = useMemo(() => employees.filter((e) => e.status === 'Active'), [employees]);
  const payrollEligible = activeEmployees;

  const selectedRunExists = useMemo(
    () => getPayrollRunForCycle(selectedMonth, selectedYear),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMonth, selectedYear, allRuns],
  );

  const salaryPreviews = useMemo(() => {
    const monthIndex = MONTHS.indexOf(selectedMonth) + 1;
    const payMonthStart = `${selectedYear}-${String(monthIndex).padStart(2, '0')}-01`;
    const payMonthEnd = new Date(selectedYear, monthIndex, 0).toISOString().split('T')[0];
    return payrollEligible.map((emp) => {
      const allLeaves = getLeaveRequests();
      const approvedInMonth = allLeaves.filter(
        (r) =>
          r.employeeId === emp.id &&
          r.status === 'Approved' &&
          r.fromDate <= payMonthEnd &&
          r.toDate >= payMonthStart,
      );
      const totalApprovedDays = approvedInMonth.reduce((s, r) => s + (r.days ?? 0), 0);
      const leaveBalance = getLeaveBalance(emp.id, selectedYear);
      let lopDays = 0;
      if (totalApprovedDays > 0) {
        if (leaveBalance) {
          const totalRemaining = Object.values(leaveBalance.balances).reduce((s, b) => s + b.remaining, 0);
          lopDays = Math.max(0, totalApprovedDays - totalRemaining);
        }
      }
      return {
        emp,
        slip: computeFullSalary(
          emp,
          profile?.payroll || { pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22 },
          selectedMonth,
          selectedYear,
          lopDays,
        ),
      };
    });
  }, [payrollEligible, profile, selectedMonth, selectedYear]);

  const payrollTotals = useMemo(() => {
    return salaryPreviews.reduce(
      (acc, { slip }) => ({
        totalGross: acc.totalGross + slip.grossEarnings,
        totalStatutory: acc.totalStatutory + slip.totalDeductions,
        totalNet: acc.totalNet + slip.netPay,
        totalEmployerCost: acc.totalEmployerCost + slip.totalEmployerCost,
      }),
      { totalGross: 0, totalStatutory: 0, totalNet: 0, totalEmployerCost: 0 },
    );
  }, [salaryPreviews]);

  // ── Run Payroll ────────────────────────────────────────────────────────────

  const handleRunPayroll = async () => {
    if (payrollEligible.length === 0) {
      toast('error', 'No active employees to process');
      return;
    }
    if (selectedRunExists) {
      toast('error', `Payroll for ${selectedMonth} ${selectedYear} already processed`);
      return;
    }
    setIsRunningPayroll(true);
    await new Promise((r) => setTimeout(r, 1200));

    const config = profile?.payroll || { pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22 };
    const runDate = new Date().toISOString().split('T')[0];

    const employeeSlips: PayrollRunSlip[] = [];
    let totalEmployerCost = 0;

    const monthIndex = MONTHS.indexOf(selectedMonth) + 1;
    const payMonthStart = `${selectedYear}-${String(monthIndex).padStart(2, '0')}-01`;
    const payMonthEnd = new Date(selectedYear, monthIndex, 0).toISOString().split('T')[0];
    const allLeaveRequests = getLeaveRequests();

    for (const emp of payrollEligible) {
      const leaveBalance = getLeaveBalance(emp.id, selectedYear);
      const approvedInMonth = allLeaveRequests.filter(
        (r) =>
          r.employeeId === emp.id &&
          r.status === 'Approved' &&
          r.fromDate <= payMonthEnd &&
          r.toDate >= payMonthStart,
      );
      const totalApprovedDays = approvedInMonth.reduce((s, r) => s + (r.days ?? 0), 0);
      let lopDays = 0;
      if (totalApprovedDays > 0) {
        if (leaveBalance) {
          const totalRemaining = Object.values(leaveBalance.balances).reduce((s, b) => s + b.remaining, 0);
          lopDays = Math.max(0, totalApprovedDays - totalRemaining);
        }
      }
      const slip = computeFullSalary(emp, config, selectedMonth, selectedYear, lopDays);

      employeeSlips.push({
        employeeId: emp.id,
        employeeName: emp.name,
        basic: slip.basic,
        hra: slip.hra,
        allowance: slip.allowance,
        grossEarnings: slip.grossEarnings,
        epf: slip.epf,
        esiEmployee: slip.esiEmployee,
        pt: slip.pt,
        tds: slip.tds,
        totalDeductions: slip.totalDeductions,
        netPay: slip.netPay,
        epfEmployer: slip.epfEmployer,
        epsEmployer: slip.epsEmployer,
        esiEmployer: slip.esiEmployer,
        lopDays: slip.lopDays,
        paidDays: slip.paidDays,
        workingDays: slip.workingDays,
      });
      totalEmployerCost += slip.totalEmployerCost;

      const salaryTx: Transaction = {
        id: `PAY-${emp.id}-${Date.now()}`,
        date: runDate,
        description: `Salary: ${emp.name} – ${selectedMonth} ${selectedYear}`,
        amount: slip.netPay,
        currency: 'INR',
        source: 'IndianBank',
        category: 'Payroll',
        status: 'Completed',
        type: 'Expense',
      };
      addTransaction(salaryTx);
    }

    const totals = employeeSlips.reduce(
      (a, s) => ({ gross: a.gross + s.grossEarnings, stat: a.stat + s.totalDeductions, net: a.net + s.netPay }),
      { gross: 0, stat: 0, net: 0 },
    );

    const statutoryTx: Transaction = {
      id: `PAY-STAT-${Date.now()}`,
      date: runDate,
      description: `Statutory Dues (EPF/ESI/PT/TDS) – ${selectedMonth} ${selectedYear}`,
      amount: totals.stat,
      currency: 'INR',
      source: 'IndianBank',
      category: 'Statutory',
      status: 'Completed',
      type: 'Expense',
    };
    addTransaction(statutoryTx);

    const payrollRun: PayrollRunType = {
      id: `RUN-${uid()}`,
      month: selectedMonth,
      year: selectedYear,
      runAt: new Date().toISOString(),
      employeeCount: payrollEligible.length,
      totalGross: totals.gross,
      totalStatutory: totals.stat,
      totalNet: totals.net,
      totalEmployerCost,
      employeeSlips,
    };
    onAddRun(payrollRun);
    setIsRunningPayroll(false);
    toast('success', `Payroll processed: ${payrollEligible.length} employees, ${fmt(totals.net)} disbursed`);
  };

  // ── Download Slip ─────────────────────────────────────────────────────────

  const downloadSlip = (emp: Employee, slip: FullSalaryResult, format: PayslipFormat = payslipFormat) => {
    setIsGenerating(emp.id);
    setTimeout(() => {
      if (format === 'pdf') {
        const doc = new jsPDF();
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 22;
        const contentW = pageW - margin * 2;
        let y = 20;

        doc.setFillColor(79, 70, 229);
        doc.rect(0, 0, pageW, 36, 'F');
        doc.setFillColor(255, 255, 255);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('PAYSLIP', margin, 14);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(255, 255, 255);
        doc.text(`${slip.month} ${slip.year}`, pageW - margin, 14, { align: 'right' });
        doc.setFontSize(9);
        doc.setTextColor(199, 210, 254);
        doc.text(profile?.parent?.name || 'Company', margin, 24);
        doc.text(`ID: ${emp.id}`, pageW - margin, 24, { align: 'right' });
        y = 44;

        const col1X = margin;
        const col2X = margin + contentW / 2 + 12;
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y - 4, contentW, 38, 'F');
        doc.rect(margin, y - 4, contentW, 38, 'S');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text('COMPANY', col1X + 6, y + 4);
        doc.text('EMPLOYEE', col2X + 6, y + 4);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text(profile?.parent?.name || 'Company', col1X + 6, y + 12);
        doc.text(emp.name, col2X + 6, y + 12);
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(`${profile?.parent?.state || ''} · India`, col1X + 6, y + 18);
        doc.text(emp.designation, col2X + 6, y + 18);
        doc.text(`GSTIN: ${profile?.parent?.taxId || 'N/A'}`, col1X + 6, y + 24);
        doc.text(`PAN: ${emp.panNumber || 'N/A'} · UAN: ${emp.uan || 'N/A'}`, col2X + 6, y + 24);
        doc.text('', col1X + 6, y + 30);
        doc.text(`DOJ: ${emp.doj} · Paid: ${slip.paidDays}/${slip.workingDays} days`, col2X + 6, y + 30);
        y += 42;

        const tableTop = y;
        const col1End = margin + 88;
        const col2Start = margin + 98;
        const lineH = 9;

        doc.setFillColor(241, 245, 249);
        doc.rect(margin, tableTop - 4, contentW, lineH + 4, 'F');
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.25);
        doc.line(margin, tableTop - 4, margin + contentW, tableTop - 4);
        doc.line(margin, tableTop + lineH, margin + contentW, tableTop + lineH);
        doc.line(col1End + 6, tableTop - 4, col1End + 6, tableTop + lineH);
        doc.line(col2Start - 6, tableTop - 4, col2Start - 6, tableTop + lineH);
        doc.line(margin + contentW / 2, tableTop - 4, margin + contentW / 2, tableTop + lineH);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(51, 65, 85);
        doc.text('EARNINGS', margin + 8, tableTop + 5);
        doc.text('AMOUNT', col1End - 4, tableTop + 5, { align: 'right' });
        doc.text('DEDUCTIONS', col2Start + 4, tableTop + 5);
        doc.text('AMOUNT', margin + contentW - 8, tableTop + 5, { align: 'right' });
        y = tableTop + lineH + 2;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(30, 41, 59);
        const rows: [string, number, string, number][] = [
          ['Basic Salary', slip.basic, 'Provident Fund (12%)', slip.epf],
          ['HRA', slip.hra, 'ESI (0.75%)', slip.esiEmployee],
          ['Special Allowance', slip.allowance, 'Professional Tax', slip.pt],
        ];
        if (slip.lopDeduction > 0) rows.push(['LOP Deduction', -slip.lopDeduction, 'Income Tax (TDS)', slip.tds]);
        else rows.push(['', 0, 'Income Tax (TDS)', slip.tds]);

        let rowIdx = 0;
        for (const [eLabel, eAmt, dLabel, dAmt] of rows) {
          if (rowIdx % 2 === 1) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, y - 6, contentW / 2 - 14, lineH + 2, 'F');
            doc.rect(margin + contentW / 2 + 2, y - 6, contentW / 2 - 8, lineH + 2, 'F');
          }
          if (eLabel) { doc.text(eLabel, margin + 8, y + 1); doc.text(fmt(eAmt), col1End - 4, y + 1, { align: 'right' }); }
          if (dLabel && dAmt > 0) { doc.text(dLabel, col2Start + 4, y + 1); doc.text(fmt(dAmt), margin + contentW - 8, y + 1, { align: 'right' }); }
          y += lineH + 2;
          rowIdx++;
        }

        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.4);
        doc.line(margin, y - 2, margin + contentW, y - 2);
        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(30, 41, 59);
        doc.text('Total Earnings', margin + 8, y + 2);
        doc.text(fmt(slip.grossEarnings), col1End - 4, y + 2, { align: 'right' });
        doc.text('Total Deductions', col2Start + 4, y + 2);
        doc.text(fmt(slip.totalDeductions), margin + contentW - 8, y + 2, { align: 'right' });
        y += 18;

        doc.setFillColor(79, 70, 229);
        doc.roundedRect(margin, y - 8, contentW, 20, 2, 2, 'F');
        doc.setDrawColor(67, 56, 202);
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y - 8, contentW, 20, 2, 2, 'S');
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('NET PAY', margin + 12, y + 2);
        doc.text(fmt(slip.netPay), margin + contentW - 12, y + 2, { align: 'right' });
        y += 28;

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('Employer contributions (not deducted from salary):', margin, y);
        y += 5;
        doc.setTextColor(71, 85, 105);
        doc.text(`EPF: ${fmt(slip.epfEmployer)}  ·  EPS: ${fmt(slip.epsEmployer)}  ·  EDLI: ${fmt(slip.edliEmployer)}  ·  ESI: ${fmt(slip.esiEmployer)}`, margin, y);
        y += 14;

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.4);
        doc.line(0, pageH - 28, pageW, pageH - 28);
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text('Computer-generated document. No physical signature required.', pageW / 2, pageH - 18, { align: 'center' });
        doc.text('Issued via CrossBorder Financial OS', pageW / 2, pageH - 12, { align: 'center' });
        doc.save(`Payslip_${emp.name.replace(/\s+/g, '_')}_${slip.month.slice(0, 3)}${slip.year}.pdf`);
      } else if (format === 'txt') {
        const pad = (str: string, length: number) => str.padEnd(length);
        const padL = (str: string, length: number) => str.padStart(length);
        const content = `
============================================================
            SALARY SLIP - ${slip.month.toUpperCase()} ${slip.year}
============================================================
COMPANY: ${profile?.parent?.name || ''} | ${profile?.parent?.state || ''}, India
GSTIN: ${profile?.parent?.taxId || 'N/A'}
------------------------------------------------------------
EMPLOYEE: ${emp.name} (${emp.id})
Designation: ${emp.designation} | Dept: ${emp.department || 'N/A'}
PAN: ${emp.panNumber || 'N/A'} | UAN: ${emp.uan || 'N/A'}
DOJ: ${emp.doj} | Days: ${slip.paidDays}/${slip.workingDays}
------------------------------------------------------------
EARNINGS                    | DEDUCTIONS
------------------------------------------------------------
${pad('Basic Salary', 20)} : ${padL(fmt(slip.basic), 14)} | ${pad('Provident Fund', 18)} : ${padL(fmt(slip.epf), 14)}
${pad('HRA', 20)} : ${padL(fmt(slip.hra), 14)} | ${pad('ESI', 18)} : ${padL(fmt(slip.esiEmployee), 14)}
${pad('Special Allowance', 20)} : ${padL(fmt(slip.allowance), 14)} | ${pad('Professional Tax', 18)} : ${padL(fmt(slip.pt), 14)}
${slip.lopDeduction > 0 ? `${pad('LOP Deduction', 20)} : ${padL(fmt(-slip.lopDeduction), 14)}` : pad('', 37)} | ${pad('Income Tax (TDS)', 18)} : ${padL(fmt(slip.tds), 14)}
------------------------------------------------------------
${pad('Total Earnings', 20)} : ${padL(fmt(slip.grossEarnings), 14)} | ${pad('Total Deductions', 18)} : ${padL(fmt(slip.totalDeductions), 14)}
------------------------------------------------------------
NET PAYOUT: ${fmt(slip.netPay)}
------------------------------------------------------------
EMPLOYER CONTRIBUTIONS:
EPF: ${fmt(slip.epfEmployer)} | EPS: ${fmt(slip.epsEmployer)} | EDLI: ${fmt(slip.edliEmployer)} | ESI: ${fmt(slip.esiEmployer)}
------------------------------------------------------------
Computer-generated. Issued via CrossBorder Financial OS.
============================================================`;
        const blob = new Blob([content.trim()], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Payslip_${emp.name.replace(/\s+/g, '_')}_${slip.month.slice(0, 3)}${slip.year}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'html') {
        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payslip – ${emp.name} – ${slip.month} ${slip.year}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0} body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;padding:32px}
  .card{background:#fff;border-radius:16px;max-width:780px;margin:0 auto;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);padding:28px 32px;color:#fff}
  .header h1{font-size:24px;font-weight:800;letter-spacing:-.5px}
  .header .sub{font-size:13px;opacity:.8;margin-top:4px}
  .header .period{font-size:13px;background:rgba(255,255,255,.18);padding:4px 12px;border-radius:20px;display:inline-block;margin-top:8px}
  .section{padding:24px 32px;border-bottom:1px solid #f1f5f9}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  .meta-block label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
  .meta-block p{font-size:14px;font-weight:600;color:#1e293b;margin-top:3px}
  .meta-block p.small{font-size:12px;font-weight:400;color:#64748b}
  .table-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  .t-head{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;padding-bottom:10px}
  .t-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f8fafc}
  .t-row:last-child{border-bottom:none;font-weight:700;color:#1e293b;padding-top:10px;border-top:2px solid #e2e8f0;margin-top:4px}
  .t-row span:first-child{color:#475569;font-size:13px}
  .t-row span:last-child{font-size:13px;font-weight:600;color:#1e293b;font-variant-numeric:tabular-nums}
  .net-box{margin:24px 32px;background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);border-radius:14px;padding:20px 28px;display:flex;justify-content:space-between;align-items:center}
  .net-box .label{color:rgba(255,255,255,.8);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
  .net-box .amount{color:#fff;font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}
  .employer{padding:16px 32px 24px;background:#f8fafc}
  .employer label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
  .employer .row{display:flex;flex-wrap:wrap;gap:20px;margin-top:8px}
  .employer .item{font-size:12px;color:#64748b}<strong>{color:#334155}</strong>
  .footer{padding:16px 32px;background:#fff;border-top:1px solid #f1f5f9;text-align:center;font-size:10px;color:#94a3b8}
  @media print{body{background:#fff;padding:0}.card{box-shadow:none}}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>Payslip</h1>
    <div class="sub">${profile?.parent?.name || 'Company'} · ${profile?.parent?.taxId ? 'GSTIN: ' + profile.parent.taxId : ''}</div>
    <div class="period">${slip.month} ${slip.year}</div>
  </div>
  <div class="section">
    <div class="meta-grid">
      <div class="meta-block">
        <label>Employee</label>
        <p>${emp.name}</p>
        <p class="small">${emp.designation}${emp.department ? ' · ' + emp.department : ''}</p>
      </div>
      <div class="meta-block">
        <label>Employee ID</label>
        <p>${emp.id}</p>
        <p class="small">DOJ: ${emp.doj}</p>
      </div>
      <div class="meta-block">
        <label>PAN / UAN</label>
        <p>${emp.panNumber || 'N/A'}</p>
        <p class="small">UAN: ${emp.uan || 'N/A'}</p>
      </div>
      <div class="meta-block">
        <label>Days Paid</label>
        <p>${slip.paidDays} of ${slip.workingDays} days</p>
        <p class="small">${slip.lopDays > 0 ? slip.lopDays + ' LOP day(s)' : 'No LOP'}</p>
      </div>
      ${emp.bankAccountNumber ? `<div class="meta-block"><label>Bank Account</label><p>${'•'.repeat(Math.max(0, emp.bankAccountNumber.length - 4)) + emp.bankAccountNumber.slice(-4)}</p><p class="small">${emp.bankName || ''} · IFSC: ${emp.bankIFSC || ''}</p></div>` : ''}
      <div class="meta-block">
        <label>Tax Regime</label>
        <p>${emp.taxRegime === 'old' ? 'Old Regime' : 'New Regime (FY25-26)'}</p>
        <p class="small">Annual CTC: ${fmt(emp.ctc)}</p>
      </div>
    </div>
  </div>
  <div class="section">
    <div class="table-grid">
      <div>
        <div class="t-head">Earnings</div>
        <div class="t-row"><span>Basic Salary</span><span>${fmt(slip.basic)}</span></div>
        <div class="t-row"><span>House Rent Allowance</span><span>${fmt(slip.hra)}</span></div>
        <div class="t-row"><span>Special Allowance</span><span>${fmt(slip.allowance)}</span></div>
        ${slip.lopDeduction > 0 ? `<div class="t-row"><span>LOP Deduction</span><span style="color:#dc2626">−${fmt(slip.lopDeduction)}</span></div>` : ''}
        <div class="t-row"><span>Gross Earnings</span><span>${fmt(slip.grossEarnings)}</span></div>
      </div>
      <div>
        <div class="t-head">Deductions</div>
        <div class="t-row"><span>Provident Fund (12%)</span><span>${fmt(slip.epf)}</span></div>
        ${slip.esiEmployee > 0 ? `<div class="t-row"><span>ESI (0.75%)</span><span>${fmt(slip.esiEmployee)}</span></div>` : ''}
        ${slip.pt > 0 ? `<div class="t-row"><span>Professional Tax</span><span>${fmt(slip.pt)}</span></div>` : ''}
        ${slip.tds > 0 ? `<div class="t-row"><span>Income Tax (TDS)</span><span>${fmt(slip.tds)}</span></div>` : ''}
        <div class="t-row"><span>Total Deductions</span><span>${fmt(slip.totalDeductions)}</span></div>
      </div>
    </div>
  </div>
  <div class="net-box">
    <div>
      <div class="label">Net Pay (Take Home)</div>
    </div>
    <div class="amount">${fmt(slip.netPay)}</div>
  </div>
  <div class="employer">
    <label>Employer Contributions (not deducted from salary)</label>
    <div class="row">
      <span class="item"><strong>EPF Employer:</strong> ${fmt(slip.epfEmployer)}</span>
      <span class="item"><strong>EPS:</strong> ${fmt(slip.epsEmployer)}</span>
      <span class="item"><strong>EDLI:</strong> ${fmt(slip.edliEmployer)}</span>
      ${slip.esiEmployer > 0 ? `<span class="item"><strong>ESI Employer:</strong> ${fmt(slip.esiEmployer)}</span>` : ''}
      <span class="item"><strong>Total CTC:</strong> ${fmt(slip.totalEmployerCost)}</span>
    </div>
  </div>
  <div class="footer">Computer-generated payslip. No physical signature required. · Issued via CrossBorder Financial OS</div>
</div>
</body></html>`;
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Payslip_${emp.name.replace(/\s+/g, '_')}_${slip.month.slice(0, 3)}${slip.year}.html`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setIsGenerating(null);
    }, 200);
  };

  const handleDownloadAllSlips = () => {
    const config = profile?.payroll || { pfEnabled: true, esiEnabled: false, ptState: 'Maharashtra', standardWorkingDays: 22 };
    payrollEligible.forEach((emp, i) => {
      const slip = computeFullSalary(emp, config, selectedMonth, selectedYear, 0);
      setTimeout(() => downloadSlip(emp, slip, payslipFormat), i * 300);
    });
    toast('info', `Downloading ${payrollEligible.length} payslips...`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Cycle selector + format */}
      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-sm font-medium text-slate-600">Cycle</label>
        <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
          {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/30">
          {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="ml-auto flex rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
          <button onClick={() => setPayslipFormat('pdf')} className={`px-4 py-2 text-xs font-medium transition-colors ${payslipFormat === 'pdf' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>PDF</button>
          <button onClick={() => setPayslipFormat('txt')} className={`px-4 py-2 text-xs font-medium transition-colors ${payslipFormat === 'txt' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>TXT</button>
          <button onClick={() => setPayslipFormat('html')} className={`px-4 py-2 text-xs font-medium transition-colors ${payslipFormat === 'html' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>HTML</button>
        </div>
      </div>

      {/* Run payroll hero */}
      <div className={`rounded-2xl border overflow-hidden ${selectedRunExists ? 'bg-emerald-900 border-emerald-800' : 'bg-slate-900 border-slate-700'}`}>
        <div className="p-6 sm:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="text-xs font-medium text-white/70 uppercase tracking-wider">
              {selectedRunExists ? 'Processed' : 'Pending'} · {selectedMonth} {selectedYear}
            </p>
            <h3 className="text-2xl font-bold text-white mt-1">{selectedRunExists ? 'Payroll completed' : 'Ready to run'}</h3>
            <div className="mt-6 flex flex-wrap gap-6 sm:gap-10">
              <div>
                <p className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Gross</p>
                <p className="text-lg font-bold text-white mt-0.5">{fmt(payrollTotals.totalGross)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Deductions</p>
                <p className="text-lg font-bold text-white mt-0.5">{fmt(payrollTotals.totalStatutory)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Net payout</p>
                <p className="text-lg font-bold text-emerald-300 mt-0.5">{fmt(payrollTotals.totalNet)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Employer cost</p>
                <p className="text-lg font-bold text-white mt-0.5">{fmt(payrollTotals.totalEmployerCost)}</p>
              </div>
            </div>
            {selectedRunExists && (
              <p className="mt-4 text-sm text-white/70">
                Processed {new Date(selectedRunExists.runAt).toLocaleDateString()} · {selectedRunExists.employeeCount} employees
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {selectedRunExists ? (
              <button
                onClick={handleDownloadAllSlips}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-white text-emerald-900 hover:bg-emerald-50 transition-colors shadow-lg"
              >
                Download all slips ({payslipFormat.toUpperCase()})
              </button>
            ) : (
              <button
                onClick={handleRunPayroll}
                disabled={isRunningPayroll || payrollEligible.length === 0}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
              >
                {isRunningPayroll ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Processing…</>
                ) : (
                  `Run payroll (${payrollEligible.length})`
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Salary preview table */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
          <h3 className="text-base font-bold text-slate-900">Salary preview</h3>
          <p className="text-xs text-slate-500 mt-1">Per-employee breakdown for {selectedMonth} {selectedYear}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-4 font-semibold text-slate-600 text-left">Employee</th>
                <th className="px-4 py-4 font-semibold text-slate-600 text-center">Days</th>
                <th className="px-4 py-4 font-semibold text-slate-600">Basic</th>
                <th className="px-4 py-4 font-semibold text-slate-600">HRA</th>
                <th className="px-4 py-4 font-semibold text-slate-600">Gross</th>
                <th className="px-4 py-4 font-semibold text-slate-600">EPF</th>
                <th className="px-4 py-4 font-semibold text-slate-600">ESI</th>
                <th className="px-4 py-4 font-semibold text-slate-600">PT</th>
                <th className="px-4 py-4 font-semibold text-slate-600">TDS</th>
                <th className="px-4 py-4 font-semibold text-slate-600 text-right">Net pay</th>
                <th className="px-4 py-4 w-28 text-right font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {salaryPreviews.map(({ emp, slip }) => (
                <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors group">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-900">{emp.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{emp.designation}</p>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                      {slip.paidDays}/{slip.workingDays}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-600 tabular-nums">{fmt(slip.basic)}</td>
                  <td className="px-4 py-4 text-slate-600 tabular-nums">{fmt(slip.hra)}</td>
                  <td className="px-4 py-4 font-semibold text-slate-900 tabular-nums">{fmt(slip.grossEarnings)}</td>
                  <td className="px-4 py-4 text-rose-600 tabular-nums">{fmt(slip.epf)}</td>
                  <td className="px-4 py-4 text-rose-600 tabular-nums">{slip.esiEmployee > 0 ? fmt(slip.esiEmployee) : '—'}</td>
                  <td className="px-4 py-4 text-rose-600 tabular-nums">{fmt(slip.pt)}</td>
                  <td className="px-4 py-4 text-rose-600 tabular-nums">{fmt(slip.tds)}</td>
                  <td className="px-4 py-4 text-right font-bold text-slate-900 tabular-nums">{fmt(slip.netPay)}</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setSlipPreview({ emp, slip })}
                        className="px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                        title="View payslip"
                      >
                        View
                      </button>
                      <button
                        onClick={() => downloadSlip(emp, slip)}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                        title="Download payslip"
                      >
                        {isGenerating === emp.id ? (
                          <span className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin block" />
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payrollEligible.length === 0 && (
            <div className="py-14 text-center text-slate-500 text-sm">
              No active employees. Add employees and set status to Active to run payroll.
            </div>
          )}
        </div>
      </section>

      {/* ── Payslip preview modal ── */}
      {slipPreview && (() => {
        const { emp, slip } = slipPreview;
        const refNum = `SLIP-${emp.id.slice(-6).toUpperCase()}-${slip.month.slice(0, 3).toUpperCase()}${slip.year}`;
        const maskedAcct = emp.bankAccountNumber
          ? '•'.repeat(Math.max(0, emp.bankAccountNumber.length - 4)) + emp.bankAccountNumber.slice(-4)
          : null;
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setSlipPreview(null)}
          >
            <div
              className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 px-6 py-5 text-white shrink-0">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Payslip</h2>
                    <p className="text-indigo-100 text-sm mt-0.5">{slip.month} {slip.year}</p>
                    <p className="text-indigo-200 text-[10px] mt-1 font-mono">{refNum}</p>
                  </div>
                  <button onClick={() => setSlipPreview(null)} className="p-1.5 rounded-lg text-white/80 hover:bg-white/20 transition-colors text-xl leading-none" aria-label="Close">×</button>
                </div>
                <p className="text-white/90 text-sm mt-3 font-medium">{profile?.parent?.name || 'Company'}</p>
              </div>

              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-bold text-slate-900">{emp.name}</p>
                    <p className="text-sm text-slate-500">{emp.designation}{emp.department ? ` · ${emp.department}` : ''}</p>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {emp.panNumber && <span className="text-[10px] font-medium text-slate-400">PAN: {emp.panNumber}</span>}
                      {emp.uan && <span className="text-[10px] font-medium text-slate-400">UAN: {emp.uan}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-slate-500">Paid days</p>
                    <p className="text-lg font-bold text-slate-900">{slip.paidDays}<span className="text-sm font-normal text-slate-400">/{slip.workingDays}</span></p>
                    {slip.lopDays > 0 && <p className="text-[10px] text-rose-500">{slip.lopDays} LOP</p>}
                  </div>
                </div>
                {maskedAcct && (
                  <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-slate-400 text-sm">🏦</span>
                    <div>
                      <span className="text-xs font-semibold text-slate-700 font-mono">{maskedAcct}</span>
                      {emp.bankName && <span className="text-[10px] text-slate-400 ml-2">{emp.bankName}</span>}
                      {emp.bankIFSC && <span className="text-[10px] text-slate-400 ml-1">· {emp.bankIFSC}</span>}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-5 overflow-y-auto space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Earnings</p>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between"><span className="text-slate-600">Basic Salary</span><span className="font-medium text-slate-900 tabular-nums">{fmt(slip.basic)}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">HRA</span><span className="font-medium text-slate-900 tabular-nums">{fmt(slip.hra)}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">Allowance</span><span className="font-medium text-slate-900 tabular-nums">{fmt(slip.allowance)}</span></li>
                      {slip.lopDeduction > 0 && <li className="flex justify-between"><span className="text-slate-600">LOP deduction</span><span className="font-medium text-rose-600 tabular-nums">−{fmt(slip.lopDeduction)}</span></li>}
                      <li className="flex justify-between pt-2 border-t border-slate-100"><span className="font-semibold text-slate-800">Gross</span><span className="font-semibold text-slate-900 tabular-nums">{fmt(slip.grossEarnings)}</span></li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Deductions</p>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between"><span className="text-slate-600">PF (12%)</span><span className="font-medium text-slate-900 tabular-nums">{fmt(slip.epf)}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">ESI</span><span className="font-medium text-slate-900 tabular-nums">{slip.esiEmployee > 0 ? fmt(slip.esiEmployee) : '—'}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">Prof. Tax</span><span className="font-medium text-slate-900 tabular-nums">{slip.pt > 0 ? fmt(slip.pt) : '—'}</span></li>
                      <li className="flex justify-between"><span className="text-slate-600">TDS</span><span className="font-medium text-slate-900 tabular-nums">{slip.tds > 0 ? fmt(slip.tds) : '—'}</span></li>
                      <li className="flex justify-between pt-2 border-t border-slate-100"><span className="font-semibold text-slate-800">Total</span><span className="font-semibold text-rose-600 tabular-nums">{fmt(slip.totalDeductions)}</span></li>
                    </ul>
                  </div>
                </div>

                <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-3.5 flex justify-between items-center">
                  <div>
                    <p className="text-indigo-200 text-[10px] font-semibold uppercase tracking-wider">Net Pay (Take Home)</p>
                    <p className="text-indigo-100 text-[10px] mt-0.5">
                      {emp.taxRegime === 'old' ? 'Old Regime' : 'New Regime'} · CTC {fmt(emp.ctc)}/yr
                    </p>
                  </div>
                  <span className="text-2xl font-bold text-white tabular-nums">{fmt(slip.netPay)}</span>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Employer contributions (not deducted from salary)</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'EPF Employer (12%)', value: slip.epfEmployer },
                      { label: 'EPS (8.33%)', value: slip.epsEmployer },
                      { label: 'EDLI (0.5%)', value: slip.edliEmployer },
                      { label: 'ESI Employer', value: slip.esiEmployer },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">{label}</span>
                        <span className="text-xs font-semibold text-slate-700 tabular-nums">{value > 0 ? fmt(value) : '—'}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between">
                    <span className="text-xs font-semibold text-slate-600">Total employer cost</span>
                    <span className="text-xs font-bold text-slate-900">{fmt(slip.totalEmployerCost)}</span>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3 shrink-0">
                <button
                  onClick={() => { downloadSlip(emp, slip); setSlipPreview(null); }}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                  Download {payslipFormat.toUpperCase()}
                </button>
                <button
                  onClick={() => { downloadSlip(emp, slip, 'pdf'); }}
                  className={`px-4 py-2.5 rounded-xl font-medium text-sm border transition-colors ${payslipFormat === 'pdf' ? 'text-slate-400 border-slate-100 cursor-default' : 'text-indigo-600 border-indigo-200 hover:bg-indigo-50'}`}
                  disabled={payslipFormat === 'pdf'}
                  title="Also download as PDF"
                >
                  PDF
                </button>
                <button
                  onClick={() => setSlipPreview(null)}
                  className="px-4 py-2.5 rounded-xl font-medium text-sm text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default PayrollRun;
