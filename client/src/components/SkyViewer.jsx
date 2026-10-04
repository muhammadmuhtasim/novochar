import React, { useEffect, useRef, useState } from 'react';
import SkyViewerCanvas from './SkyViewerCanvas.jsx';
import TargetInfo from './TargetInfo.jsx';
import { api, fmtRA, fmtDec } from '../lib/api.js';
import { parseCoordInput } from '../lib/celestial.js';

export const FIELD = { raCenter: 84.0, decCenter: -58.0, raHalf: 14.0, decHalf: 9.0 };

// Zoom that shows a ≤~2° field so the real DSS survey imagery is visible.
export const IMAGERY_ZOOM = 18;
export const IMAGERY_ZOOM_BIG = 4;

export const BAND_OPTIONS = [
  { value: 'ALL', label: 'ALL BANDS' },
  { value: '1', label: 'Band 1 · 0.75–1.11 µm' },
  { value: '2', label: 'Band 2 · 1.11–1.64 µm' },
  { value: '3', label: 'Band 3 · 1.64–2.42 µm' },
  { value: '4', label: 'Band 4 · 2.42–3.82 µm' },
  { value: '5', label: 'Band 5 · 3.82–4.42 µm' },
  { value: '6', label: 'Band 6 · 4.42–5.00 µm' },
];

export default function SkyViewer({ objects, field = FIELD, presetId = null, onTarget = () => {} }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const selRef = useRef(null);
  const [band, setBand] = useState('ALL');
  const [q, setQ] = useState('');
  const [presets, setPresets] = useState([]);
  const [searchNote, setSearchNote] = useState('');
  const [imagery, setImagery] = useState(true);

  useEffect(() => { api.presets().then((d) => setPresets(d.list || [])).catch(() => {}); }, []);

  const select = (obj) => {
    selRef.current = obj ? obj.id : null;
    setSelected(obj);
  };

  // Focus the canvas on a target object (from a preset or direct link).
  const focusTarget = (obj, zoom) => {
    if (!obj) return;
    select(obj);
    if (canvasRef.current) {
      canvasRef.current.action({ mode: 'focus', ra: obj.ra, dec: obj.dec, zoom });
    }
  };

  // Deep-link support: honour a presetId passed from the Home hero / App.
  const prevPreset = useRef(null);
  useEffect(() => {
    if (!presetId || presetId === prevPreset.current) return;
    prevPreset.current = presetId;
    const obj = objects.find((o) => o.id === presetId);
    if (obj) { setBand('ALL'); setQ(''); focusTarget(obj, IMAGERY_ZOOM); }
  }, [presetId, objects]);

  // Filter pipeline: band first, then free-text name/coordinate search.
  let visible = band === 'ALL' ? objects : objects.filter((o) => o.bandIndex === Number(band));
  const coords = parseCoordInput(q.trim());
  if (q.trim() && !coords) {
    const t = q.trim().toLowerCase();
    visible = visible.filter(
      (o) => o.id.toLowerCase().includes(t) || o.name.toLowerCase().includes(t) || o.type.toLowerCase().includes(t)
    );
  }

  const applyPreset = (p) => {
    const obj = objects.find((o) => o.id === (p && p.target && p.target.id));
    if (!obj) { setSearchNote(`Preset target ${p.target.id} not in this catalogue.`); return; }
    setBand('ALL');
    setQ('');
    setSearchNote(`${p.label} → ${obj.id} ${obj.name}`);
    focusTarget(obj, IMAGERY_ZOOM);
  };

  const gotoBlink = () => {
    if (selected) onTarget('blink', selected.id);
  };

  const gotoSpectra = () => {
    if (selected) onTarget('spectra', selected.id);
  };

  const gotoCatalog = () => {
    if (selected) onTarget('catalogue', selected.id);
  };

  const submitSearch = () => {
    const c = parseCoordInput(q.trim());
    if (c) {
      const near = nearestObject(visible.length ? visible : objects, c);
      setSearchNote(`Centred at ${fmtRA(c.ra)} / ${fmtDec(c.dec)} — nearest ${near ? near.id : 'none'}`);
      if (canvasRef.current) canvasRef.current.action({ mode: 'focus', ra: c.ra, dec: c.dec, zoom: IMAGERY_ZOOM });
      if (near) select(near);
      return;
    }
    if (visible.length === 1 && visible[0]) {
      select(visible[0]);
      setSearchNote(`Matched ${visible[0].id} ${visible[0].name}`);
    }
  };

  return (
    <section className="viewer-grid">
      <div className="panel viewer-panel">
        <div className="panel-head">
          <h2>SKY VIEWER</h2>
          <div className="viewer-tools">
            <span className="tag">DRAG</span>
            <span className="tag">SCROLL</span>
          </div>
        </div>

        <div className="sky-toolbar">
          <div className="tb-group">
            <span className="tb-label">BAND</span>
            <select
              className="select band-select"
              value={band}
              onChange={(e) => { setBand(e.target.value); setSearchNote(''); }}
            >
              {BAND_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
          <div className="tb-group">
            <span className="tb-label">IMAGERY</span>
            <div className="seg-group">
              <button className={`seg${imagery ? ' on' : ''}`} onClick={() => setImagery(true)}>REAL</button>
              <button className={`seg${imagery ? '' : ' on'}`} onClick={() => setImagery(false)}>SYNTH</button>
            </div>
          </div>
          <div className="tb-group grow">
            <span className="tb-label">{coords ? 'COORDS' : 'TARGET'}</span>
            <input
              className="search sky-search"
              placeholder="RA / Dec or name — e.g. 6h 3m −58° 12′ 30″  or  NC-012"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
            />
            <button className="btn sm" onClick={submitSearch}>LOCATE</button>
          </div>
        </div>

        <div className="preset-row">
          <span className="tb-label">PRESETS</span>
          {presets.map((p) => (
            <button key={p.key} className="seg preset-chip" onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
          {selected && (
            <>
              <button className="btn sm primary go-blink" onClick={gotoBlink}>OPEN IN BLINK ⧗</button>
              <button className="btn sm" onClick={gotoSpectra}>OPEN SPECTRA ∿</button>
            </>
          )}
        </div>

        {searchNote && <p className="muted caption">{searchNote}</p>}

        <SkyViewerCanvas
          canvasRef={canvasRef}
          wrapRef={wrapRef}
          objects={visible}
          field={field}
          selRef={selRef}
          onSelect={select}
          imagery={imagery}
          initialZoom={IMAGERY_ZOOM}
        />
        <p className="muted caption">
          Field centered at {fmtRA(field.raCenter)} / {fmtDec(field.decCenter)} · coverage{' '}
          {field.raHalf * 2}° × {field.decHalf * 2}°. Click a marker to inspect; brighter markers move
          faster. Use the <strong>BAND</strong> filter to switch SPHEREx near-infrared channels and the
          search box for RA/Dec or target names.
        </p>
      </div>

      <aside className="panel side">
        <div className="panel-head">
          <h2>SELECTED TARGET</h2>
          <span className="tag">{selected ? selected.id : 'NONE'}</span>
        </div>
        {selected ? (
          <>
            <TargetInfo o={selected} />
            <div className="side-actions">
              <button className="btn primary sm" onClick={gotoBlink}>LAUNCH BLINK COMPARATOR</button>
              <button className="btn sm" onClick={gotoSpectra}>OPEN SPECTRA</button>
              <button className="btn sm" onClick={gotoCatalog}>OPEN CATALOGUE</button>
            </div>
          </>
        ) : (
          <p className="muted empty">Click a colored marker on the field, use a preset, or search coordinates to inspect a candidate.</p>
        )}
      </aside>
    </section>
  );
}

function nearestObject(list, { ra, dec }) {
  let best = null;
  let bestD = Infinity;
  for (const o of list) {
    const dRA = Math.abs(o.ra - ra);
    const dd = Math.abs(o.dec - dec);
    const d = Math.hypot(Math.min(dRA, 360 - dRA), dd);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}