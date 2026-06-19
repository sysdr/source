import React from 'react';

interface NotesTabProps {
  terms: string[];
  setTerms: (v: string[]) => void;
  footerNote: string; setFooterNote: (v: string) => void;
  projectRef: string; setProjectRef: (v: string) => void;
  onAddTerm: () => void;
}

const NotesTab: React.FC<NotesTabProps> = ({
  terms,
  setTerms,
  footerNote, setFooterNote,
  projectRef, setProjectRef,
  onAddTerm,
}) => {
  return (
    <>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--n-400)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Terms &amp; Conditions
      </div>
      {terms.map((t, i) => (
        <div key={`term-${i}`} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--n-400)', flexShrink: 0, width: 14, textAlign: 'right' }}>{i + 1}.</span>
          <input
            className="form-input"
            value={t}
            onChange={(e) => setTerms(terms.map((x, idx) => idx === i ? e.target.value : x))}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => setTerms(terms.filter((_, idx) => idx !== i))}
            style={{ width: 18, height: 18, borderRadius: 4, border: 'none', background: 'var(--n-100)', color: 'var(--n-400)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
          >×</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" type="button" onClick={onAddTerm}>＋ Add Term</button>
      <textarea className="form-input" rows={2} value={footerNote} onChange={(e) => setFooterNote(e.target.value)} placeholder="Footer note (printed at bottom of invoice)" />
      <input className="form-input" value={projectRef} onChange={(e) => setProjectRef(e.target.value)} placeholder="Project reference / PO ref" />
    </>
  );
};

export default NotesTab;
