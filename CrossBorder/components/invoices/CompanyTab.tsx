import React from 'react';

type CompanyProfile = {
  id: string; label: string;
  name: string; tagline: string; gstin: string; pan: string; cin: string;
  addr1: string; city: string; state: string; pin: string; stateCode: string;
  phone: string; email: string; website: string;
  signatoryName: string; signatoryDesignation: string;
  bankName: string; bankAccName: string; bankAccNum: string; bankAccType: string;
  bankIFSC: string; bankBranch: string; bankUPI: string; bankSWIFT: string;
};

interface CompanyTabProps {
  companyName: string; setCompanyName: (v: string) => void;
  companyTagline: string; setCompanyTagline: (v: string) => void;
  companyGSTIN: string; setCompanyGSTIN: (v: string) => void;
  companyPAN: string; setCompanyPAN: (v: string) => void;
  companyCIN: string; setCompanyCIN: (v: string) => void;
  companyAddr1: string; setCompanyAddr1: (v: string) => void;
  companyCity: string; setCompanyCity: (v: string) => void;
  companyState: string; setCompanyState: (v: string) => void;
  companyPIN: string; setCompanyPIN: (v: string) => void;
  companyStateCode: string; setCompanyStateCode: (v: string) => void;
  companyPhone: string; setCompanyPhone: (v: string) => void;
  companyEmail: string; setCompanyEmail: (v: string) => void;
  companyWebsite: string; setCompanyWebsite: (v: string) => void;
  signatoryName: string; setSignatoryName: (v: string) => void;
  signatoryDesignation: string; setSignatoryDesignation: (v: string) => void;
  companyLogo: string; setCompanyLogo: (v: string) => void;
  bankName: string; setBankName: (v: string) => void;
  bankAccName: string; setBankAccName: (v: string) => void;
  bankAccNum: string; setBankAccNum: (v: string) => void;
  bankAccType: string; setBankAccType: (v: string) => void;
  bankIFSC: string; setBankIFSC: (v: string) => void;
  bankBranch: string; setBankBranch: (v: string) => void;
  bankUPI: string; setBankUPI: (v: string) => void;
  bankSWIFT: string; setBankSWIFT: (v: string) => void;
  profileLabel: string; setProfileLabel: (v: string) => void;
  savedCompanies: CompanyProfile[];
  onSaveProfile: () => void;
  onLoadProfile: (p: CompanyProfile) => void;
  onUpdateProfile: (p: CompanyProfile) => void;
  onDeleteProfile: (id: string) => void;
  isValidGSTIN: (v: string) => boolean;
  isValidPAN: (v: string) => boolean;
  invalidStyle: React.CSSProperties;
}

const CompanyTab: React.FC<CompanyTabProps> = ({
  companyName, setCompanyName,
  companyTagline, setCompanyTagline,
  companyGSTIN, setCompanyGSTIN,
  companyPAN, setCompanyPAN,
  companyCIN, setCompanyCIN,
  companyAddr1, setCompanyAddr1,
  companyCity, setCompanyCity,
  companyState, setCompanyState,
  companyPIN, setCompanyPIN,
  companyStateCode, setCompanyStateCode,
  companyPhone, setCompanyPhone,
  companyEmail, setCompanyEmail,
  companyWebsite, setCompanyWebsite,
  signatoryName, setSignatoryName,
  signatoryDesignation, setSignatoryDesignation,
  companyLogo, setCompanyLogo,
  bankName, setBankName,
  bankAccName, setBankAccName,
  bankAccNum, setBankAccNum,
  bankAccType, setBankAccType,
  bankIFSC, setBankIFSC,
  bankBranch, setBankBranch,
  bankUPI, setBankUPI,
  bankSWIFT, setBankSWIFT,
  profileLabel, setProfileLabel,
  savedCompanies,
  onSaveProfile,
  onLoadProfile,
  onUpdateProfile,
  onDeleteProfile,
  isValidGSTIN,
  isValidPAN,
  invalidStyle,
}) => {
  return (
    <>
      <input className="form-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" />
      <input className="form-input" value={companyTagline} onChange={(e) => setCompanyTagline(e.target.value)} placeholder="Tagline / Business Type" />
      <input className="form-input" value={companyGSTIN} onChange={(e) => setCompanyGSTIN(e.target.value.toUpperCase())} placeholder="GSTIN (e.g. 27AABCT1332L1ZE)" style={!isValidGSTIN(companyGSTIN) ? invalidStyle : {}} />
      {companyGSTIN && !isValidGSTIN(companyGSTIN) && <div style={{ fontSize: 11, color: '#ef4444', marginTop: -6 }}>⚠ Invalid GSTIN format (15 chars, state code + PAN-based)</div>}
      <input className="form-input" value={companyPAN} onChange={(e) => setCompanyPAN(e.target.value.toUpperCase())} placeholder="PAN (e.g. AABCT1332L)" style={!isValidPAN(companyPAN) ? invalidStyle : {}} />
      {companyPAN && !isValidPAN(companyPAN) && <div style={{ fontSize: 11, color: '#ef4444', marginTop: -6 }}>⚠ Invalid PAN format (AAAAA0000A)</div>}
      <input className="form-input" value={companyCIN} onChange={(e) => setCompanyCIN(e.target.value)} placeholder="CIN" />
      <input className="form-input" value={companyAddr1} onChange={(e) => setCompanyAddr1(e.target.value)} placeholder="Address" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="form-input" value={companyCity} onChange={(e) => setCompanyCity(e.target.value)} placeholder="City" />
        <input className="form-input" value={companyState} onChange={(e) => setCompanyState(e.target.value)} placeholder="State" />
        <input className="form-input" value={companyPIN} onChange={(e) => setCompanyPIN(e.target.value)} placeholder="PIN" />
        <input className="form-input" value={companyStateCode} onChange={(e) => setCompanyStateCode(e.target.value)} placeholder="State code" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="form-input" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder="Phone" />
        <input className="form-input" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder="Email" />
        <input className="form-input" value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} placeholder="Website" />
      </div>
      <div style={{ borderTop: '1px solid var(--n-200)', paddingTop: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n-400)', marginBottom: 4, letterSpacing: 0.4 }}>COMPANY LOGO</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="file" accept="image/*" style={{ flex: 1, fontSize: 11 }} onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = (ev) => setCompanyLogo(ev.target?.result as string);
            reader.readAsDataURL(f);
          }} />
          {companyLogo && <button className="btn btn-danger btn-sm" type="button" onClick={() => setCompanyLogo('')}>✕ Remove</button>}
        </div>
        {companyLogo && <img src={companyLogo} alt="logo preview" style={{ marginTop: 6, maxHeight: 48, borderRadius: 4, border: '1px solid var(--n-200)' }} />}
      </div>
      <input className="form-input" value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} placeholder="Signatory name" />
      <input className="form-input" value={signatoryDesignation} onChange={(e) => setSignatoryDesignation(e.target.value)} placeholder="Signatory designation" />
      {/* Bank Details — inside Company tab, saved with company profile */}
      <div style={{ borderTop: '1px solid var(--n-200)', paddingTop: 6, marginTop: 2 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n-400)', marginBottom: 6, letterSpacing: 0.4 }}>BANK DETAILS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input className="form-input" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank name" />
            <input className="form-input" value={bankAccName} onChange={(e) => setBankAccName(e.target.value)} placeholder="Account name" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
            <input className="form-input" value={bankAccNum} onChange={(e) => setBankAccNum(e.target.value)} placeholder="Account number" />
            <select className="form-input" value={bankAccType} onChange={(e) => setBankAccType(e.target.value)} style={{ width: 90 }}><option>Current</option><option>Savings</option></select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input className="form-input" value={bankIFSC} onChange={(e) => setBankIFSC(e.target.value.toUpperCase())} placeholder="IFSC code" />
            <input className="form-input" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} placeholder="Branch" />
          </div>
          <input className="form-input" value={bankUPI} onChange={(e) => setBankUPI(e.target.value)} placeholder="UPI ID (optional)" />
          <input className="form-input" value={bankSWIFT} onChange={(e) => setBankSWIFT(e.target.value.toUpperCase())} placeholder="SWIFT / BIC (for foreign payments)" />
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--n-200)', paddingTop: 6, marginTop: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n-400)', letterSpacing: 0.4 }}>SAVED PROFILES</div>
          <span style={{ fontSize: 9, color: '#16a34a', fontWeight: 600 }}>✓ auto-saved</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--n-400)', marginBottom: 6, lineHeight: 1.4 }}>
          Company details + bank info auto-save as you type and restore on every visit. Click <strong>Save</strong> to create a named profile you can switch between.
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="form-input" value={profileLabel} onChange={(e) => setProfileLabel(e.target.value)} placeholder="Profile name (e.g. My Company, GST Entity 2)" style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" type="button" onClick={onSaveProfile} style={{ fontSize: 11, padding: '3px 8px' }}>Save Profile</button>
        </div>
        {savedCompanies.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 }}>
            {savedCompanies.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--n-50)', border: '1px solid var(--n-200)', borderRadius: 4, padding: '3px 6px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
                  <div style={{ fontSize: 9, color: 'var(--n-400)', marginTop: 1 }}>{p.gstin || p.pan || p.city || ''}</div>
                </div>
                <button className="btn btn-primary btn-sm" type="button" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => onLoadProfile(p)}>Load</button>
                <button className="btn btn-sm" type="button" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => onUpdateProfile(p)} title="Overwrite with current values">Upd</button>
                <button className="btn btn-danger btn-sm" type="button" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => onDeleteProfile(p.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
        {savedCompanies.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--n-300)', fontStyle: 'italic', marginTop: 4 }}>No saved profiles yet. Fill in your company details above and click Save Profile.</div>
        )}
      </div>
    </>
  );
};

export default CompanyTab;
