import React from 'react';

type Features = {
  showTaxTable: boolean;
  showAmountWords: boolean;
  showRoundOff: boolean;
  showTDS: boolean;
  showEInvoice: boolean;
  showSignature: boolean;
  showBankDetails: boolean;
  showWatermark: boolean;
};

interface TaxTabProps {
  features: Features;
  tdsSection: string; setTdsSection: (v: string) => void;
  tdsAmount: number; setTdsAmount: (v: number) => void;
  defaultGST: number; setDefaultGST: (v: number) => void;
  defaultSAC: string; setDefaultSAC: (v: string) => void;
  onToggleFeature: (k: keyof Features) => void;
}

const TaxTab: React.FC<TaxTabProps> = ({
  features,
  tdsSection, setTdsSection,
  tdsAmount, setTdsAmount,
  defaultGST, setDefaultGST,
  defaultSAC, setDefaultSAC,
  onToggleFeature,
}) => {
  return (
    <>
      {Object.keys(features).map((k) => (
        <label key={k} style={{ fontSize: 12 }}>
          <input type="checkbox" checked={features[k as keyof Features]} onChange={() => onToggleFeature(k as keyof Features)} /> {k}
        </label>
      ))}
      {features.showTDS && (
        <>
          <input className="form-input" value={tdsSection} onChange={(e) => setTdsSection(e.target.value)} />
          <input className="form-input" type="number" value={tdsAmount} onChange={(e) => setTdsAmount(Number(e.target.value))} />
        </>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="form-input" type="number" value={defaultGST} onChange={(e) => setDefaultGST(Number(e.target.value))} />
        <input className="form-input" value={defaultSAC} onChange={(e) => setDefaultSAC(e.target.value)} />
      </div>
    </>
  );
};

export default TaxTab;
