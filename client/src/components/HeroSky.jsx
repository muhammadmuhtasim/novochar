import React, { useEffect, useRef, useState } from 'react';
import SkyViewerCanvas from './SkyViewerCanvas.jsx';
import { api } from '../lib/api.js';
import { IMAGERY_ZOOM } from './SkyViewer.jsx';

// Compact, interactive sky preview embedded in the landing hero so judges see
// live survey data the moment the page opens. Drag / scroll to pan & zoom, click
// a candidate to select it, or fire a curated preset to jump straight at a mover.
export default function HeroSky({ objects, field, onTarget }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const selRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [presets, setPresets] = useState([]);

  useEffect(() => { api.presets().then((d) => setPresets(d.list || [])).catch(() => {}); }, []);

  const select = (obj) => {
    selRef.current = obj ? obj.id : null;
    setSelected(obj);
  };

  const firePreset = (p) => {
    const obj = objects.find((o) => o.id === (p && p.target && p.target.id));
    if (!obj) return;
    select(obj);
    if (canvasRef.current) {
      canvasRef.current.action({ mode: 'focus', ra: obj.ra, dec: obj.dec, zoom: IMAGERY_ZOOM });
    }
  };

  const blink = () => { if (selected) onTarget('blink', selected.id); };
  const open = () => { if (selected) onTarget('sky', selected.id); };

  return (
    <div className="hero-sky">
      <div className="hero-sky-top">
        <span className="hero-eyebrow">LIVE SURVEY FIELD · SPHEREx SEASON 1</span>
        <span className="tag live">STREAM</span>
      </div>

      <SkyViewerCanvas
        canvasRef={canvasRef}
        wrapRef={wrapRef}
        objects={objects}
        field={field}
        selRef={selRef}
        onSelect={select}
        imagery
        initialZoom={IMAGERY_ZOOM}
      />

      <div className="hero-presets">
        <span className="tb-label">PRESETS</span>
        {presets.map((p) => (
          <button key={p.key} className="seg preset-chip" onClick={() => firePreset(p)}>{p.label}</button>
        ))}
        <span className="tb-spacer" />
        <button className="btn sm" onClick={() => onTarget('sky')}>FULL VIEWER ⌖</button>
        <button className="btn sm primary" onClick={blink} disabled={!selected}>
          BLINK {selected ? selected.id : ''} ⧗
        </button>
      </div>
      <p className="muted caption">
        {selected
          ? `Tracking ${selected.id} · ${selected.name} · ${selected.typeLabel} · ${selected.motion} ${selected.motionUnits}`
          : 'Drag to pan · scroll to zoom · click a colored marker to select a mover.'}
      </p>
    </div>
  );
}