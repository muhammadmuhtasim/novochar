import React, { useRef, useState } from 'react';
import SkyViewerCanvas from './SkyViewerCanvas.jsx';
import TargetInfo from './TargetInfo.jsx';
import { fmtRA, fmtDec } from '../lib/api.js';

export const FIELD = { raCenter: 84.0, decCenter: -58.0, raHalf: 14.0, decHalf: 9.0 };

export default function SkyViewer({ objects, field = FIELD }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const selRef = useRef(null);

  const select = (obj) => {
    selRef.current = obj ? obj.id : null;
    setSelected(obj);
  };

  return (
    <section className="viewer-grid">
      <div className="panel viewer-panel">
        <div className="panel-head">
          <h2>SKY VIEWER</h2>
          <div className="viewer-tools">
            <span className="tag">DRAG</span>
            <span className="tag">SCROLL</span>
            <button className="btn sm" onClick={() => canvasRef.current && canvasRef.current.action('reset')}>
              RESET
            </button>
          </div>
        </div>
        <SkyViewerCanvas
          canvasRef={canvasRef}
          wrapRef={wrapRef}
          objects={objects}
          field={field}
          selRef={selRef}
          onSelect={select}
        />
        <p className="muted caption">
          Field centered at {fmtRA(field.raCenter)} / {fmtDec(field.decCenter)} ·
          coverage {field.raHalf * 2}° × {field.decHalf * 2}°. Click a marker to inspect;
          brighter markers move faster.
        </p>
      </div>

      <aside className="panel side">
        <div className="panel-head">
          <h2>SELECTED TARGET</h2>
          <span className="tag">{selected ? selected.id : 'NONE'}</span>
        </div>
        {selected ? (
          <TargetInfo o={selected} />
        ) : (
          <p className="muted empty">Click a colored marker on the field to inspect a candidate.</p>
        )}
      </aside>
    </section>
  );
}