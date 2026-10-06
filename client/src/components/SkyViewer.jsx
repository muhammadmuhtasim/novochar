import React, { useCallback, useEffect, useRef, useState } from 'react';
import SkyViewerCanvas from './SkyViewerCanvas.jsx';
import SkyAnalysis from './SkyAnalysis.jsx';
import RealSkyMosaic from './RealSkyMosaic.jsx';
import TargetInfo from './TargetInfo.jsx';
import { api, fmtRA, fmtDec } from '../lib/api.js';
import { parseCoordInput } from '../lib/celestial.js';

export const FIELD = { raCenter: 84.0, decCenter: -58.0, raHalf: 14.0, decHalf: 9.0 };

// Default overview zoom for the interactive sky map (real sky now lives in the
// separate synced REAL SKY mosaic, not the main map).
export const SKY_INITIAL_ZOOM = 5;
// Zoom used to jump to / inspect a single target (markers + trails).
export const TARGET_ZOOM = 18;

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
  const viewRef = useRef(null);   // latest { ra, dec, raW, decH, zoom } from the sky map
  const [highlight, setHighlight] = useState(null); // Set of ids from brushing

  // Fed by SkyViewerCanvas on every pan/zoom so the synced REAL SKY mosaic can
  // mirror the exact patch of sky on screen without re-rendering this component.
  const onView = useCallback((v) => { viewRef.current = v; }, []);

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
    if (obj) { setBand('ALL'); setQ(''); focusTarget(obj, TARGET_ZOOM); }
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
    focusTarget(obj, TARGET_ZOOM);
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
      if (canvasRef.current) canvasRef.current.action({ mode: 'focus', ra: c.ra, dec: c.dec, zoom: TARGET_ZOOM });
      if (near) select(near);
      return;
    }
    if (visible.length === 1 && visible[0]) {
      select(visible[0]);
      setSearchNote(`Matched ${visible[0].id} ${visible[0].name}`);
    }
  };

  return (
    <div className="viewer-grid">
      <div className="viewer-main-col">
        <section className="panel viewer-panel">
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
              <span className="tag" title="Real sky now lives in the synced REAL SKY mosaic below">REAL ↴</span>
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
            onView={onView}
            initialZoom={SKY_INITIAL_ZOOM}
            highlight={highlight}
          />
          <p className="muted caption">
            Field centered at {fmtRA(field.raCenter)} / {fmtDec(field.decCenter)} · coverage{' '}
            {field.raHalf * 2}° × {field.decHalf * 2}°.
          </p>

          <details className="sky-help">
            <summary>What am I looking at? <span className="muted">(a quick plain-English guide)</span></summary>
            <p>
              The dark background is a synthetic star field — the real patch of night
              sky lives in the <strong>REAL SKY · SYNCED MOSAIC</strong> panel below,
              which mirrors exactly where you're looking and streams live{' '}
              <strong>Digitized Sky Survey</strong> tiles as you pan and zoom. The
              colored markers are the <em>moving objects</em> this survey flagged: a
              candidate <strong>TNO</strong> (remote icy body beyond Neptune),{' '}
              <strong>AST</strong> (nearby asteroid) or <strong>HPM</strong> (a star
              gliding across the field).
            </p>
            <ul>
              <li><strong>Ring size</strong> scales with how fast the object is moving.</li>
              <li><strong>Drag</strong> to pan, <strong>scroll / pinch</strong> to zoom, <strong>click a ring</strong> to inspect a candidate.</li>
              <li>Use <strong>BAND</strong> to filter SPHEREx near-infrared channels, or <strong>search</strong> by RA/Dec or target name.</li>
            </ul>
          </details>
        </section>

        <RealSkyMosaic field={field} viewRef={viewRef} />

        <SkyAnalysis
          objects={visible}
          selectedId={selected ? selected.id : null}
          onSelect={select}
          highlight={highlight}
          onBrush={setHighlight}
        />
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
    </div>
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