import React from 'react';
import type { ExportInvoiceData } from '../services/exportInvoiceService';
import {
  LUT_DECLARATION,
  formatUsd,
  formatInvoiceDate,
  usdAmountInWords,
} from '../services/exportInvoiceService';

interface ExportInvoicePreviewProps {
  data: ExportInvoiceData;
  compact?: boolean;
}

const ExportInvoicePreview: React.FC<ExportInvoicePreviewProps> = ({ data, compact }) => {
  const { config } = data;
  const agreementRef = `Reference: ${config.agreementReference} dated ${formatInvoiceDate(config.agreementDate)}.`;
  const fontSize = compact ? 10 : 12;

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        fontSize,
        lineHeight: 1.5,
        color: '#1e293b',
        background: '#fff',
      }}
    >
      <div
        style={{
          background: '#fef3c7',
          border: '2px solid #d97706',
          padding: compact ? '6px 10px' : '10px 14px',
          textAlign: 'center',
          fontWeight: 700,
          fontSize: compact ? 9 : 10,
          letterSpacing: '0.03em',
          marginBottom: 16,
          color: '#92400e',
        }}
      >
        {LUT_DECLARATION}
      </div>

      <h2 style={{ textAlign: 'center', fontSize: compact ? 16 : 20, margin: '0 0 16px', letterSpacing: '0.06em' }}>
        COMMERCIAL INVOICE
      </h2>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          {[
            ['Invoice Number', data.invoiceNumber],
            ['Invoice Date', formatInvoiceDate(data.invoiceDate)],
            ['Payment Terms', config.paymentTerms],
            ['Place of Supply', config.placeOfSupply],
            ['LUT Number', config.lutNumber || '[Insert Your 2026-2027 ARN Number]'],
          ].map(([label, value]) => (
            <tr key={label}>
              <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px', fontWeight: 600, background: '#f8fafc', width: '38%' }}>{label}</td>
              <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>From (Service Provider)</div>
        <div style={{ fontWeight: 700 }}>{data.providerName}</div>
        <div style={{ whiteSpace: 'pre-line' }}>{data.providerAddress}</div>
        <div><strong>GSTIN:</strong> {data.providerGstin || '[Your 15-digit GST Number]'}</div>
        <div><strong>PAN:</strong> {data.providerPan || '[LLP PAN Number]'}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>To (Service Recipient)</div>
        <div style={{ fontWeight: 700 }}>{data.recipientName}</div>
        <div style={{ whiteSpace: 'pre-line' }}>{data.recipientAddress}</div>
        <div><strong>EIN:</strong> {data.recipientEin || '[US Employer Identification Number]'}</div>
      </div>

      <div style={{ fontWeight: 600, marginBottom: 6 }}>Service Description</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead>
          <tr style={{ background: '#1e3a5f', color: '#fff' }}>
            {['SAC Code', 'Description', 'Qty', 'Rate (USD)', 'Amount (USD)'].map((h) => (
              <th key={h} style={{ border: '1px solid #cbd5e1', padding: '6px 8px', textAlign: 'left', fontSize: compact ? 9 : 11 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px' }}><strong>{config.sacCode}</strong></td>
            <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px' }}>
              {config.serviceDescription}
              <div style={{ fontStyle: 'italic', color: '#64748b', fontSize: compact ? 9 : 10, marginTop: 4 }}>{agreementRef}</div>
            </td>
            <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px' }}>{config.qty}</td>
            <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px' }}>
              {formatUsd(config.useCalculatedAmount ? data.amountUsd : config.rateUsd)}
            </td>
            <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px' }}>{formatUsd(data.amountUsd)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ fontWeight: 700, fontSize: compact ? 12 : 14 }}>
        Total Invoice Value: {formatUsd(data.amountUsd)} USD
      </div>
      <div style={{ fontStyle: 'italic', color: '#475569', marginTop: 4, marginBottom: 16 }}>
        (Amount in words: {usdAmountInWords(data.amountUsd)})
      </div>

      <div style={{ fontWeight: 600, marginBottom: 6 }}>Wire Transfer Instructions (Inward Remittance)</div>
      <p style={{ fontSize: compact ? 9 : 11, color: '#475569', marginBottom: 8 }}>
        Route funds as follows to obtain FIRC from RBI:
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {[
            ['Beneficiary Name', config.bank.beneficiaryName || '[Your LLP Bank Account Name]'],
            ['Beneficiary Account No.', config.bank.accountNumber || '[Current Account Number]'],
            ['Beneficiary Bank Name', config.bank.bankName || '[Your Indian Bank]'],
            ['Bank Branch Address', config.bank.branchAddress || '[Branch Location]'],
            ['Bank SWIFT Code', config.bank.swiftCode || '[8 or 11 Character SWIFT]'],
            ['Purpose Code', `${config.purposeCode} (Software consultancy/implementation)`],
            ['AD Code', config.bank.adCode || '[Authorized Dealer Code]'],
          ].map(([label, value]) => (
            <tr key={label}>
              <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px', fontWeight: 600, background: '#f8fafc', width: '38%' }}>{label}</td>
              <td style={{ border: '1px solid #cbd5e1', padding: '6px 8px' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 600 }}>Authorized Signatory</div>
        <div style={{ borderTop: '1px solid #334155', width: 200, marginTop: 32, paddingTop: 6 }}>
          <strong>{config.signatoryTitle}</strong>, {data.providerName}
        </div>
      </div>
    </div>
  );
};

export default ExportInvoicePreview;
