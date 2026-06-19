import React, { useState } from 'react';

// ── Subject presets ────────────────────────────────────────────────────────────
const SUBJECT_PRESETS = [
  'Software Development Services',
  'Web Application Development',
  'Mobile App Development',
  'UI/UX Design & Prototyping',
  'IT Consulting Services',
  'Cloud Infrastructure & DevOps',
  'Data Analytics & Reporting',
  'Digital Marketing Services',
  'SEO & Content Strategy',
  'Cybersecurity Assessment',
  'Technical Support & Maintenance',
  'Training & Certification',
  'Legal & Compliance Advisory',
  'Financial & Accounting Services',
  'HR & Recruitment Services',
  'Custom',
] as const;

interface InvoiceTabProps {
  invoiceType: string; setInvoiceType: (v: string) => void;
  invoiceNumber: string; setInvoiceNumber: (v: string) => void;
  invoiceDate: string; setInvoiceDate: (v: string) => void;
  dueDate: string; setDueDate: (v: string) => void;
  poNumber: string; setPoNumber: (v: string) => void;
  poDate: string; setPoDate: (v: string) => void;
  placeOfSupply: string; setPlaceOfSupply: (v: string) => void;
  supplyType: 'intra' | 'inter'; setSupplyType: (v: 'intra' | 'inter') => void;
  reverseCharge: 'N' | 'Y'; setReverseCharge: (v: 'N' | 'Y') => void;
  currency: string; setCurrency: (v: string) => void;
  irnNumber: string; setIrnNumber: (v: string) => void;
  originalInvNum: string; setOriginalInvNum: (v: string) => void;
  originalInvDate: string; setOriginalInvDate: (v: string) => void;
  showEInvoice: boolean;
  // Subject
  invoiceSubject: string; setInvoiceSubject: (v: string) => void;
}

const InvoiceTab: React.FC<InvoiceTabProps> = ({
  invoiceType, setInvoiceType,
  invoiceNumber, setInvoiceNumber,
  invoiceDate, setInvoiceDate,
  dueDate, setDueDate,
  poNumber, setPoNumber,
  poDate, setPoDate,
  placeOfSupply, setPlaceOfSupply,
  supplyType, setSupplyType,
  reverseCharge, setReverseCharge,
  currency, setCurrency,
  irnNumber, setIrnNumber,
  originalInvNum, setOriginalInvNum,
  originalInvDate, setOriginalInvDate,
  showEInvoice,
  invoiceSubject, setInvoiceSubject,
}) => {
  // Determine if current subject matches a preset
  const isCustom = invoiceSubject !== '' && !SUBJECT_PRESETS.slice(0, -1).includes(invoiceSubject as typeof SUBJECT_PRESETS[number]);
  const [dropdownValue, setDropdownValue] = useState<string>(
    isCustom ? 'Custom' : (invoiceSubject || '')
  );

  const handleDropdownChange = (val: string) => {
    setDropdownValue(val);
    if (val !== 'Custom' && val !== '') {
      setInvoiceSubject(val);
    } else if (val === 'Custom') {
      // Keep existing custom text; don't overwrite
    }
  };

  const showCustomInput = dropdownValue === 'Custom' || isCustom;

  return (
    <>
      {/* ── Subject / Description of Services ─────────────────────────── */}
      <div style={{
        background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
        borderRadius: 7,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>
          Subject / Nature of Services
        </div>

        {/* Preset dropdown */}
        <select
          className="form-input"
          value={showCustomInput ? 'Custom' : dropdownValue}
          onChange={e => handleDropdownChange(e.target.value)}
        >
          <option value="">— Select subject type —</option>
          {SUBJECT_PRESETS.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {/* Custom text input — shown when "Custom" is selected or text doesn't match any preset */}
        {showCustomInput && (
          <input
            className="form-input"
            value={invoiceSubject}
            onChange={e => setInvoiceSubject(e.target.value)}
            placeholder="Describe the services rendered…"
            autoFocus={dropdownValue === 'Custom'}
          />
        )}

        {/* Preview chip */}
        {invoiceSubject && (
          <div style={{ fontSize: 9, color: 'var(--n-500)', background: 'var(--surface-base)', border: '1px solid var(--n-150)', borderRadius: 4, padding: '3px 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ↳ {invoiceSubject}
          </div>
        )}
      </div>

      {/* ── Invoice type & number ──────────────────────────────────────── */}
      <select className="form-input" value={invoiceType} onChange={e => setInvoiceType(e.target.value)}>
        <option>Tax Invoice</option>
        <option>Proforma Invoice</option>
        <option>Credit Note</option>
        <option>Debit Note</option>
        <option>Revised Invoice</option>
      </select>
      <input className="form-input" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Invoice number" />
      <input className="form-input" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
      <input className="form-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      <input className="form-input" value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="PO number" />
      <input className="form-input" type="date" value={poDate} onChange={e => setPoDate(e.target.value)} />
      <input className="form-input" value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)} placeholder="Place of supply" />
      <select className="form-input" value={supplyType} onChange={e => setSupplyType(e.target.value as 'intra' | 'inter')}>
        <option value="intra">Intra-State</option>
        <option value="inter">Inter-State</option>
      </select>
      <select className="form-input" value={reverseCharge} onChange={e => setReverseCharge(e.target.value as 'N' | 'Y')}>
        <option value="N">Reverse Charge: No</option>
        <option value="Y">Reverse Charge: Yes</option>
      </select>
      <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
        <option value="INR">₹ INR</option>
        <option value="USD">$ USD</option>
        <option value="EUR">€ EUR</option>
      </select>
      <input className="form-input" value={irnNumber} onChange={e => setIrnNumber(e.target.value)} placeholder="IRN (Invoice Registration Number)" />

      {showEInvoice && irnNumber && (
        <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#92400e' }}>
          ⚠ IRN shown is a system-generated placeholder. Replace with official IRN from the IRP/GSTN portal before issuing.
        </div>
      )}

      {(invoiceType === 'Credit Note' || invoiceType === 'Debit Note') && (
        <div style={{ borderTop: '1px solid var(--n-200)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#92400e' }}>
            ⚠ GST Rule 53 requires a {invoiceType} to reference the original Tax Invoice number and date.
          </div>
          <input className="form-input" value={originalInvNum} onChange={e => setOriginalInvNum(e.target.value)} placeholder="Original Invoice Number (mandatory)" />
          <input className="form-input" type="date" value={originalInvDate} onChange={e => setOriginalInvDate(e.target.value)} />
          {!originalInvNum && <div style={{ fontSize: 11, color: '#ef4444' }}>⚠ Original invoice number is required for {invoiceType}</div>}
        </div>
      )}
    </>
  );
};

export default InvoiceTab;
