import React from 'react';

type ClientProfile = {
  id: string; label: string;
  name: string; gstin: string; pan: string;
  addr: string; city: string; state: string; pin: string; stateCode: string;
  contact: string; email: string;
};

interface ClientTabProps {
  clientName: string; setClientName: (v: string) => void;
  clientGSTIN: string; setClientGSTIN: (v: string) => void;
  clientPAN: string; setClientPAN: (v: string) => void;
  clientAddr: string; setClientAddr: (v: string) => void;
  clientCity: string; setClientCity: (v: string) => void;
  clientState: string; setClientState: (v: string) => void;
  clientPIN: string; setClientPIN: (v: string) => void;
  clientStateCode: string; setClientStateCode: (v: string) => void;
  clientContact: string; setClientContact: (v: string) => void;
  clientEmail: string; setClientEmail: (v: string) => void;
  shipSame: boolean; setShipSame: (v: boolean) => void;
  shipName: string; setShipName: (v: string) => void;
  shipAddr: string; setShipAddr: (v: string) => void;
  shipCity: string; setShipCity: (v: string) => void;
  shipState: string; setShipState: (v: string) => void;
  clientLabel: string; setClientLabel: (v: string) => void;
  clientSearch: string; setClientSearch: (v: string) => void;
  savedClients: ClientProfile[];
  onSaveClient: () => void;
  onLoadClient: (p: ClientProfile) => void;
  onUpdateClient: (p: ClientProfile) => void;
  onDeleteClient: (id: string) => void;
  isValidGSTIN: (v: string) => boolean;
  isValidPAN: (v: string) => boolean;
  invalidStyle: React.CSSProperties;
}

const ClientTab: React.FC<ClientTabProps> = ({
  clientName, setClientName,
  clientGSTIN, setClientGSTIN,
  clientPAN, setClientPAN,
  clientAddr, setClientAddr,
  clientCity, setClientCity,
  clientState, setClientState,
  clientPIN, setClientPIN,
  clientStateCode, setClientStateCode,
  clientContact, setClientContact,
  clientEmail, setClientEmail,
  shipSame, setShipSame,
  shipName, setShipName,
  shipAddr, setShipAddr,
  shipCity, setShipCity,
  shipState, setShipState,
  clientLabel, setClientLabel,
  clientSearch, setClientSearch,
  savedClients,
  onSaveClient,
  onLoadClient,
  onUpdateClient,
  onDeleteClient,
  isValidGSTIN,
  isValidPAN,
  invalidStyle,
}) => {
  return (
    <>
      {/* ADDRESS BOOK */}
      {savedClients.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--n-200)', paddingBottom: 6, marginBottom: 2 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n-400)', marginBottom: 4, letterSpacing: 0.4 }}>CLIENT ADDRESS BOOK</div>
          <input
            className="form-input"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="🔍 Search by name, GSTIN or city…"
            style={{ marginBottom: 4 }}
          />
          <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {savedClients
              .filter((c) => {
                const q = clientSearch.toLowerCase();
                return !q || c.name.toLowerCase().includes(q) || c.gstin.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.label.toLowerCase().includes(q);
              })
              .map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--n-50)', borderRadius: 4, padding: '3px 6px', border: clientName === p.name ? '1px solid var(--accent)' : '1px solid transparent' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</div>
                    <div style={{ fontSize: 9, color: 'var(--n-400)' }}>{(p.gstin || p.pan || '—').slice(0, 15)} · {p.city}</div>
                  </div>
                  <button className="btn btn-sm" type="button" style={{ fontSize: 10, padding: '1px 6px', flexShrink: 0 }} onClick={() => onLoadClient(p)}>Load</button>
                  <button className="btn btn-sm" type="button" style={{ fontSize: 10, padding: '1px 6px', flexShrink: 0 }} onClick={() => onUpdateClient(p)} title="Overwrite saved record with current form values">Upd</button>
                  <button className="btn btn-danger btn-sm" type="button" style={{ fontSize: 10, padding: '1px 6px', flexShrink: 0 }} onClick={() => onDeleteClient(p.id)}>✕</button>
                </div>
              ))}
            {savedClients.filter((c) => {
              const q = clientSearch.toLowerCase();
              return !q || c.name.toLowerCase().includes(q) || c.gstin.toLowerCase().includes(q) || c.city.toLowerCase().includes(q);
            }).length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--n-400)', textAlign: 'center', padding: 8 }}>No clients match &quot;{clientSearch}&quot;</div>
            )}
          </div>
        </div>
      )}

      {/* CLIENT DETAIL FORM */}
      <input className="form-input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client / Company name" />
      <input className="form-input" value={clientGSTIN} onChange={(e) => setClientGSTIN(e.target.value.toUpperCase())} placeholder="Client GSTIN (e.g. 29AAHCN5132L1ZT)" style={!isValidGSTIN(clientGSTIN) ? invalidStyle : {}} />
      {clientGSTIN && !isValidGSTIN(clientGSTIN) && <div style={{ fontSize: 11, color: '#ef4444', marginTop: -6 }}>⚠ Invalid GSTIN format</div>}
      <input className="form-input" value={clientPAN} onChange={(e) => setClientPAN(e.target.value.toUpperCase())} placeholder="Client PAN (e.g. AAHCN5132L)" style={!isValidPAN(clientPAN) ? invalidStyle : {}} />
      {clientPAN && !isValidPAN(clientPAN) && <div style={{ fontSize: 11, color: '#ef4444', marginTop: -6 }}>⚠ Invalid PAN format</div>}
      <textarea className="form-input" value={clientAddr} onChange={(e) => setClientAddr(e.target.value)} placeholder="Billing address" rows={3} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="form-input" value={clientCity} onChange={(e) => setClientCity(e.target.value)} placeholder="City" />
        <input className="form-input" value={clientState} onChange={(e) => setClientState(e.target.value)} placeholder="State" />
        <input className="form-input" value={clientPIN} onChange={(e) => setClientPIN(e.target.value)} placeholder="PIN code" />
        <input className="form-input" value={clientStateCode} onChange={(e) => setClientStateCode(e.target.value)} placeholder="State code (e.g. 29)" />
        <input className="form-input" value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="Contact person" />
        <input className="form-input" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Email" />
      </div>

      {/* SAVE TO ADDRESS BOOK */}
      <div style={{ borderTop: '1px solid var(--n-200)', paddingTop: 6, marginTop: 2 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n-400)', marginBottom: 4, letterSpacing: 0.4 }}>SAVE TO ADDRESS BOOK</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="form-input" value={clientLabel} onChange={(e) => setClientLabel(e.target.value)} placeholder="Label (defaults to client name)" style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" type="button" onClick={onSaveClient} style={{ fontSize: 11, padding: '3px 8px' }}>Save</button>
        </div>
      </div>

      {/* SHIPPING ADDRESS */}
      <label style={{ fontSize: 12 }}><input type="checkbox" checked={shipSame} onChange={() => setShipSame(!shipSame)} /> Ship-to same as Bill-to</label>
      {!shipSame && (
        <>
          <input className="form-input" value={shipName} onChange={(e) => setShipName(e.target.value)} placeholder="Ship-to company" />
          <textarea className="form-input" value={shipAddr} onChange={(e) => setShipAddr(e.target.value)} placeholder="Ship-to address" rows={2} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="form-input" value={shipCity} onChange={(e) => setShipCity(e.target.value)} placeholder="Ship-to city" />
            <input className="form-input" value={shipState} onChange={(e) => setShipState(e.target.value)} placeholder="Ship-to state" />
          </div>
        </>
      )}
    </>
  );
};

export default ClientTab;
