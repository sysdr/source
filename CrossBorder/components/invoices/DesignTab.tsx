import React from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
export type FontFamily  = 'system' | 'sans' | 'serif' | 'mono';
export type LogoSize    = 'small' | 'medium' | 'large';
export type PaperSize   = 'a4' | 'letter' | 'a5';
export type TableStyle  = 'clean' | 'striped' | 'bordered';

interface DesignTabProps {
  // Existing
  template: 'zoho' | 'tally' | 'modern'; setTemplate: (v: 'zoho' | 'tally' | 'modern') => void;
  headerColor: string; setHeaderColor: (v: string) => void;
  bgStyle: 'clean' | 'cream' | 'ruled'; setBgStyle: (v: 'clean' | 'cream' | 'ruled') => void;
  watermarkText: string; setWatermarkText: (v: string) => void;
  zoom: number; setZoom: (v: number | ((z: number) => number)) => void;
  // New
  fontFamily: FontFamily; setFontFamily: (v: FontFamily) => void;
  logoSize: LogoSize; setLogoSize: (v: LogoSize) => void;
  paperSize: PaperSize; setPaperSize: (v: PaperSize) => void;
  tableStyle: TableStyle; setTableStyle: (v: TableStyle) => void;
  accentColor: string; setAccentColor: (v: string) => void;
  showWatermark: boolean; onToggleWatermark: () => void;
}

// ── Color theme presets ────────────────────────────────────────────────────────
const THEMES = [
  { name: 'Navy',     header: '#1a3a5c', accent: '#2563eb' },
  { name: 'Forest',   header: '#0a3d2b', accent: '#059669' },
  { name: 'Purple',   header: '#4a1942', accent: '#7c3aed' },
  { name: 'Midnight', header: '#1a1a3e', accent: '#6366f1' },
  { name: 'Crimson',  header: '#7c0020', accent: '#dc2626' },
  { name: 'Teal',     header: '#0d4b5c', accent: '#0891b2' },
  { name: 'Sunset',   header: '#7c3003', accent: '#ea580c' },
  { name: 'Charcoal', header: '#1a1a1a', accent: '#6b7280' },
];

// ── Font families ──────────────────────────────────────────────────────────────
const FONTS: { value: FontFamily; label: string; sample: string }[] = [
  { value: 'system', label: 'System',  sample: 'Aa' },
  { value: 'sans',   label: 'Modern',  sample: 'Aa' },
  { value: 'serif',  label: 'Classic', sample: 'Aa' },
  { value: 'mono',   label: 'Mono',    sample: 'Aa' },
];

const FONT_STACKS: Record<FontFamily, string> = {
  system: 'system-ui, -apple-system, sans-serif',
  sans:   'Inter, "Helvetica Neue", Arial, sans-serif',
  serif:  'Georgia, "Times New Roman", serif',
  mono:   '"JetBrains Mono", "Courier New", monospace',
};

// ── Section header helper ──────────────────────────────────────────────────────
const SectionHead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: 'var(--n-400)', textTransform: 'uppercase', marginBottom: 6, marginTop: 4, paddingBottom: 4, borderBottom: '1px solid var(--n-100)' }}>
    {children}
  </div>
);

// ── Toggle chip ────────────────────────────────────────────────────────────────
const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; style?: React.CSSProperties }> = ({ active, onClick, children, style }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '3px 9px', borderRadius: 12, fontSize: 10, fontWeight: active ? 700 : 500,
      border: 'none', cursor: 'pointer',
      background: active ? 'var(--accent)' : 'var(--n-100)',
      color: active ? '#fff' : 'var(--n-600)',
      transition: 'all 0.12s',
      ...style,
    }}
  >
    {children}
  </button>
);

// ── Main component ─────────────────────────────────────────────────────────────
const DesignTab: React.FC<DesignTabProps> = ({
  template, setTemplate,
  headerColor, setHeaderColor,
  bgStyle, setBgStyle,
  watermarkText, setWatermarkText,
  zoom, setZoom,
  fontFamily, setFontFamily,
  logoSize, setLogoSize,
  paperSize, setPaperSize,
  tableStyle, setTableStyle,
  accentColor, setAccentColor,
  showWatermark, onToggleWatermark,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Theme Presets ─────────────────────────────────────────────────── */}
      <div>
        <SectionHead>Quick Themes</SectionHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {THEMES.map((t) => (
            <button
              key={t.name}
              type="button"
              title={t.name}
              onClick={() => { setHeaderColor(t.header); setAccentColor(t.accent); }}
              style={{
                position: 'relative',
                height: 36,
                borderRadius: 6,
                overflow: 'hidden',
                border: headerColor === t.header ? '2px solid var(--accent)' : '1px solid var(--n-200)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <div style={{ position: 'absolute', inset: 0, background: t.header }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10, background: t.accent }} />
              <span style={{ position: 'relative', zIndex: 1, fontSize: 8, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Template Layout ───────────────────────────────────────────────── */}
      <div>
        <SectionHead>Layout Template</SectionHead>
        <div style={{ display: 'flex', gap: 5 }}>
          {(['zoho', 'tally', 'modern'] as const).map((t) => (
            <Chip key={t} active={template === t} onClick={() => setTemplate(t)} style={{ textTransform: 'capitalize' }}>{t}</Chip>
          ))}
        </div>
      </div>

      {/* ── Typography ────────────────────────────────────────────────────── */}
      <div>
        <SectionHead>Typography</SectionHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
          {FONTS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFontFamily(f.value)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 2, padding: '6px 4px', borderRadius: 6, border: fontFamily === f.value ? '2px solid var(--accent)' : '1px solid var(--n-200)',
                background: fontFamily === f.value ? 'var(--accent-subtle, #eef2ff)' : 'var(--n-50)',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 16, fontFamily: FONT_STACKS[f.value], fontWeight: 600, color: 'var(--n-700)', lineHeight: 1 }}>{f.sample}</span>
              <span style={{ fontSize: 8, fontWeight: 600, color: fontFamily === f.value ? 'var(--accent)' : 'var(--n-500)' }}>{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Colors ────────────────────────────────────────────────────────── */}
      <div>
        <SectionHead>Colors</SectionHead>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--n-500)', flex: 1 }}>Header</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {['#1a3a5c', '#0a3d2b', '#4a1942', '#1a1a3e', '#7c3003', '#1a1a1a'].map((c) => (
                <button key={c} type="button" onClick={() => setHeaderColor(c)}
                  style={{ width: 18, height: 18, borderRadius: 4, border: headerColor === c ? '2px solid var(--accent)' : '1px solid var(--n-200)', background: c, cursor: 'pointer', padding: 0, flexShrink: 0 }} />
              ))}
            </div>
            <input type="color" value={headerColor} onChange={(e) => setHeaderColor(e.target.value)}
              style={{ width: 28, height: 24, borderRadius: 4, border: '1px solid var(--n-200)', cursor: 'pointer', padding: 0 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--n-500)', flex: 1 }}>Accent</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {['#2563eb', '#059669', '#7c3aed', '#dc2626', '#0891b2', '#ea580c'].map((c) => (
                <button key={c} type="button" onClick={() => setAccentColor(c)}
                  style={{ width: 18, height: 18, borderRadius: 4, border: accentColor === c ? '2px solid #000' : '1px solid var(--n-200)', background: c, cursor: 'pointer', padding: 0, flexShrink: 0 }} />
              ))}
            </div>
            <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)}
              style={{ width: 28, height: 24, borderRadius: 4, border: '1px solid var(--n-200)', cursor: 'pointer', padding: 0 }} />
          </div>
        </div>
      </div>

      {/* ── Paper & Logo ──────────────────────────────────────────────────── */}
      <div>
        <SectionHead>Paper & Logo</SectionHead>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--n-400)', fontWeight: 600 }}>PAPER</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['a4', 'letter', 'a5'] as const).map((p) => (
                <Chip key={p} active={paperSize === p} onClick={() => setPaperSize(p)} style={{ textTransform: 'uppercase', fontSize: 9 }}>{p}</Chip>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--n-400)', fontWeight: 600 }}>LOGO SIZE</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['small', 'medium', 'large'] as const).map((s) => (
                <Chip key={s} active={logoSize === s} onClick={() => setLogoSize(s)} style={{ textTransform: 'capitalize', fontSize: 9 }}>{s}</Chip>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Table Style ───────────────────────────────────────────────────── */}
      <div>
        <SectionHead>Table Style</SectionHead>
        <div style={{ display: 'flex', gap: 5 }}>
          {([
            { value: 'clean',    label: 'Clean',    icon: '▭' },
            { value: 'striped',  label: 'Striped',  icon: '≡' },
            { value: 'bordered', label: 'Bordered', icon: '⊞' },
          ] as const).map((s) => (
            <Chip key={s.value} active={tableStyle === s.value} onClick={() => setTableStyle(s.value)}>
              {s.icon} {s.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* ── Background ────────────────────────────────────────────────────── */}
      <div>
        <SectionHead>Background</SectionHead>
        <div style={{ display: 'flex', gap: 5 }}>
          {([
            { value: 'clean', label: 'White' },
            { value: 'cream', label: 'Cream' },
            { value: 'ruled', label: 'Ruled' },
          ] as const).map((b) => (
            <Chip key={b.value} active={bgStyle === b.value} onClick={() => setBgStyle(b.value)}>{b.label}</Chip>
          ))}
        </div>
      </div>

      {/* ── Watermark ─────────────────────────────────────────────────────── */}
      <div>
        <SectionHead>Watermark</SectionHead>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            onClick={onToggleWatermark}
            style={{
              width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', padding: 2,
              background: showWatermark ? 'var(--accent)' : 'var(--n-200)',
              transition: 'background 0.15s', flexShrink: 0, position: 'relative',
            }}
          >
            <div style={{
              width: 14, height: 14, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2,
              left: showWatermark ? 16 : 2,
              transition: 'left 0.15s',
            }} />
          </button>
          <input
            className="form-input"
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            placeholder="Watermark text…"
            disabled={!showWatermark}
            style={{ flex: 1, opacity: showWatermark ? 1 : 0.4 }}
          />
        </div>
      </div>

      {/* ── Zoom ──────────────────────────────────────────────────────────── */}
      <div>
        <SectionHead>Preview Zoom — {Math.round(zoom * 100)}%</SectionHead>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn btn-sm" type="button" onClick={() => setZoom((z: number) => Math.max(0.4, parseFloat((z - 0.1).toFixed(1))))} style={{ minWidth: 28 }}>−</button>
          <input
            type="range" min="40" max="150" step="5"
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-sm" type="button" onClick={() => setZoom(1)} style={{ minWidth: 34, fontSize: 9 }}>100%</button>
          <button className="btn btn-sm" type="button" onClick={() => setZoom((z: number) => Math.min(1.5, parseFloat((z + 0.1).toFixed(1))))} style={{ minWidth: 28 }}>+</button>
        </div>
      </div>

    </div>
  );
};

export default DesignTab;
export { FONT_STACKS };
