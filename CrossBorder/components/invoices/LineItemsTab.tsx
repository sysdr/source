import React, { useState, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
type Item = { desc: string; hsn: string; rate: number; qty: number; unit: string; gst: number; disc: number };

export type ServiceLibraryItem = {
  id: string;
  name: string;
  desc: string;
  hsn: string;
  rate: number;
  unit: string;
  gst: number;
};

const SERVICE_LIB_KEY = 'invoice_service_library';

function loadLibrary(): ServiceLibraryItem[] {
  try { return JSON.parse(localStorage.getItem(SERVICE_LIB_KEY) || '[]'); } catch { return []; }
}
function persistLibrary(lib: ServiceLibraryItem[]) {
  try { localStorage.setItem(SERVICE_LIB_KEY, JSON.stringify(lib)); } catch { /* quota */ }
}

interface LineItemsTabProps {
  items: Item[];
  globalDiscount: number; setGlobalDiscount: (v: number) => void;
  shippingCharge: number; setShippingCharge: (v: number) => void;
  otherCharges: number; setOtherCharges: (v: number) => void;
  otherChargesLabel: string; setOtherChargesLabel: (v: string) => void;
  commission: number; setCommission: (v: number) => void;
  commissionLabel: string; setCommissionLabel: (v: string) => void;
  onAddItem: () => void;
  onAddFromLibrary: (item: ServiceLibraryItem) => void;
  onUpdateItem: (idx: number, key: keyof Item, val: string | number) => void;
  onRemoveItem: (idx: number) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--n-400)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
    {children}
  </span>
);

// ── Save-to-library inline prompt ──────────────────────────────────────────────
const SavePrompt: React.FC<{
  item: Item;
  onSave: (name: string) => void;
  onClose: () => void;
}> = ({ item, onSave, onClose }) => {
  const [name, setName] = useState(item.desc.slice(0, 60));
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 4,
      zIndex: 30, background: 'var(--surface-base)',
      border: '1px solid var(--accent)', borderRadius: 8, padding: 10,
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n-700)', marginBottom: 6 }}>
        Save to Library
      </div>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Short name for this service…"
        onKeyDown={e => {
          if (e.key === 'Enter' && name.trim()) { onSave(name.trim()); onClose(); }
          if (e.key === 'Escape') onClose();
        }}
        style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 11, border: '1px solid var(--n-200)', borderRadius: 5, outline: 'none', marginBottom: 7 }}
      />
      <div style={{ display: 'flex', gap: 5 }}>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => { if (name.trim()) { onSave(name.trim()); onClose(); } }}
          style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: name.trim() ? 1 : 0.5 }}
        >
          Save
        </button>
        <button type="button" onClick={onClose}
          style={{ padding: '4px 10px', fontSize: 11, background: 'var(--n-100)', border: 'none', borderRadius: 5, cursor: 'pointer', color: 'var(--n-600)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
};

// ── Library picker panel ───────────────────────────────────────────────────────
const LibraryPicker: React.FC<{
  library: ServiceLibraryItem[];
  onSelect: (item: ServiceLibraryItem) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}> = ({ library, onSelect, onDelete, onClose }) => {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() =>
    !search.trim() ? library :
    library.filter(item =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.desc.toLowerCase().includes(search.toLowerCase()) ||
      item.hsn.toLowerCase().includes(search.toLowerCase())
    ), [library, search]);

  return (
    <div style={{ border: '1px solid var(--accent)', borderRadius: 8, background: 'var(--surface-base)', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
      {/* Header */}
      <div style={{ background: 'var(--accent)', padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>
          Service Library
          {library.length > 0 && <span style={{ opacity: 0.75, marginLeft: 4 }}>({library.length})</span>}
        </span>
        <button type="button" onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 4, width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✕</button>
      </div>

      {library.length === 0 ? (
        <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--n-400)' }}>
          <div style={{ fontSize: 24, marginBottom: 6 }}>📦</div>
          <div style={{ fontSize: 11, fontWeight: 600 }}>Library is empty</div>
          <div style={{ fontSize: 10, marginTop: 3, opacity: 0.7 }}>
            Use "⊕ Save to Library" on any line item to build your catalogue.
          </div>
        </div>
      ) : (
        <>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--n-100)' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, description or HSN…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '4px 8px', fontSize: 11, border: '1px solid var(--n-200)', borderRadius: 5, outline: 'none' }}
            />
          </div>
          <div style={{ maxHeight: 230, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '14px', textAlign: 'center', fontSize: 11, color: 'var(--n-400)' }}>No matches</div>
            ) : filtered.map(item => (
              <div
                key={item.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid var(--n-50)', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--n-50)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => { onSelect(item); onClose(); }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--n-400)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.hsn && <span style={{ marginRight: 6 }}>HSN: {item.hsn}</span>}
                    ₹{fmt(item.rate)} · {item.unit} · {item.gst}% GST
                  </div>
                </div>
                <button type="button" onClick={() => { onSelect(item); onClose(); }}
                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                  Add
                </button>
                <button type="button" onClick={e => { e.stopPropagation(); onDelete(item.id); }}
                  title="Remove from library"
                  style={{ width: 20, height: 20, borderRadius: 4, border: 'none', background: 'var(--n-100)', color: 'var(--n-400)', cursor: 'pointer', fontSize: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ── Line item card ─────────────────────────────────────────────────────────────
const ItemCard: React.FC<{
  item: Item;
  idx: number;
  onUpdate: (key: keyof Item, val: string | number) => void;
  onRemove: () => void;
  onSaveToLibrary: (name: string) => void;
  lineTotal: number;
}> = ({ item, idx, onUpdate, onRemove, onSaveToLibrary, lineTotal }) => {
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  return (
    <div className="card-inset" style={{ padding: 10, display: 'grid', gap: 6, position: 'relative' }}>
      {/* Row header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', padding: '1px 7px', borderRadius: 8 }}>
          Item #{idx + 1}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-700)' }}>₹{fmt(lineTotal)}</span>
      </div>

      {/* Description */}
      <div>
        <Label>Description</Label>
        <input className="form-input" value={item.desc} onChange={e => onUpdate('desc', e.target.value)}
          placeholder="Service / product description" style={{ marginTop: 2 }} />
      </div>

      {/* HSN, Rate, Qty */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div><Label>HSN / SAC</Label><input className="form-input" value={item.hsn} onChange={e => onUpdate('hsn', e.target.value)} placeholder="HSN / SAC" style={{ marginTop: 2 }} /></div>
        <div><Label>Rate (₹)</Label><input className="form-input" type="number" value={item.rate} onChange={e => onUpdate('rate', Number(e.target.value))} placeholder="0.00" style={{ marginTop: 2 }} /></div>
        <div><Label>Qty</Label><input className="form-input" type="number" value={item.qty} onChange={e => onUpdate('qty', Number(e.target.value))} placeholder="1" style={{ marginTop: 2 }} /></div>
      </div>

      {/* Unit, Disc%, GST */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div><Label>Unit</Label><input className="form-input" value={item.unit} onChange={e => onUpdate('unit', e.target.value)} placeholder="Nos / Hr" style={{ marginTop: 2 }} /></div>
        <div><Label>Discount %</Label><input className="form-input" type="number" min={0} max={100} value={item.disc} onChange={e => onUpdate('disc', Number(e.target.value))} placeholder="0" style={{ marginTop: 2 }} /></div>
        <div><Label>GST</Label>
          <select className="form-input" value={item.gst} onChange={e => onUpdate('gst', Number(e.target.value))} style={{ marginTop: 2 }}>
            {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
          </select>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 5, marginTop: 2, position: 'relative' }}>
        <button
          type="button"
          onClick={() => setShowSavePrompt(v => !v)}
          style={{ fontSize: 9, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--n-200)', background: showSavePrompt ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--n-50)', color: showSavePrompt ? 'var(--accent)' : 'var(--n-500)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}
        >
          ⊕ Save to Library
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-danger btn-sm" type="button" onClick={onRemove} style={{ fontSize: 9, padding: '2px 10px' }}>Remove</button>

        {showSavePrompt && (
          <SavePrompt
            item={item}
            onSave={onSaveToLibrary}
            onClose={() => setShowSavePrompt(false)}
          />
        )}
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const LineItemsTab: React.FC<LineItemsTabProps> = ({
  items,
  globalDiscount, setGlobalDiscount,
  shippingCharge, setShippingCharge,
  otherCharges, setOtherCharges,
  otherChargesLabel, setOtherChargesLabel,
  commission, setCommission,
  commissionLabel, setCommissionLabel,
  onAddItem,
  onAddFromLibrary,
  onUpdateItem,
  onRemoveItem,
}) => {
  const [showLibrary, setShowLibrary] = useState(false);
  const [library, setLibrary] = useState<ServiceLibraryItem[]>(loadLibrary);

  const updateLibrary = (lib: ServiceLibraryItem[]) => {
    setLibrary(lib);
    persistLibrary(lib);
  };

  const handleSaveToLibrary = (item: Item, name: string) => {
    const existing = library.find(s => s.name === name);
    if (existing) {
      updateLibrary(library.map(s => s.name === name
        ? { ...s, desc: item.desc, hsn: item.hsn, rate: item.rate, unit: item.unit, gst: item.gst }
        : s
      ));
    } else {
      updateLibrary([...library, { id: `svc_${Date.now()}`, name, desc: item.desc, hsn: item.hsn, rate: item.rate, unit: item.unit, gst: item.gst }]);
    }
  };

  const handleDeleteFromLibrary = (id: string) => updateLibrary(library.filter(s => s.id !== id));

  return (
    <>
      {/* ── Line items ──────────────────────────────────────────────────── */}
      {items.map((it, i) => (
        <ItemCard
          key={`item-${i}`}
          item={it}
          idx={i}
          lineTotal={it.rate * it.qty * (1 - it.disc / 100)}
          onUpdate={(key, val) => onUpdateItem(i, key, val)}
          onRemove={() => onRemoveItem(i)}
          onSaveToLibrary={(name) => handleSaveToLibrary(it, name)}
        />
      ))}

      {/* ── Add item buttons ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={onAddItem}
          style={{ flex: 1, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span> New Item
        </button>
        <button
          type="button"
          onClick={() => setShowLibrary(v => !v)}
          style={{
            flex: 1, fontSize: 11, padding: '5px 10px', borderRadius: 6,
            border: `1px solid ${showLibrary ? 'var(--accent)' : 'var(--n-200)'}`,
            background: showLibrary ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--n-50)',
            color: showLibrary ? 'var(--accent)' : 'var(--n-600)',
            cursor: 'pointer', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            transition: 'all 0.15s',
          }}
        >
          <span style={{ fontSize: 12 }}>📋</span>
          From Library
          {library.length > 0 && (
            <span style={{ fontSize: 9, fontWeight: 800, background: showLibrary ? 'var(--accent)' : 'var(--n-200)', color: showLibrary ? '#fff' : 'var(--n-500)', borderRadius: 8, padding: '0 5px', lineHeight: '14px' }}>
              {library.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Library picker ──────────────────────────────────────────────── */}
      {showLibrary && (
        <LibraryPicker
          library={library}
          onSelect={(svc) => { onAddFromLibrary(svc); }}
          onDelete={handleDeleteFromLibrary}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* ── Charges & adjustments ───────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--n-100)', paddingTop: 8, marginTop: 2 }}>
        <Label>Charges &amp; Adjustments</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
          <input className="form-input" type="number" min={0} max={100} value={globalDiscount} onChange={e => setGlobalDiscount(Number(e.target.value))} placeholder="Global Discount %" />
          <input className="form-input" type="number" min={0} value={shippingCharge} onChange={e => setShippingCharge(Number(e.target.value))} placeholder="Shipping (₹)" />
          <input className="form-input" type="number" min={0} value={otherCharges} onChange={e => setOtherCharges(Number(e.target.value))} placeholder="Other charges (₹)" />
          <input className="form-input" value={otherChargesLabel} onChange={e => setOtherChargesLabel(e.target.value)} placeholder="Other charges label" />
          <input className="form-input" type="number" min={0} max={100} value={commission} onChange={e => setCommission(Number(e.target.value))} placeholder="Commission %" />
          <input className="form-input" value={commissionLabel} onChange={e => setCommissionLabel(e.target.value)} placeholder="Commission label" />
        </div>
      </div>
    </>
  );
};

export default LineItemsTab;
