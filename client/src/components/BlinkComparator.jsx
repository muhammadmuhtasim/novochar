import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import BlinkDraw from './BlinkDraw.jsx';
import Readout from './Readout.jsx';

export default function BlinkComparator({ objects, presetId = null }) {
  const [sel, setSel] = useState(presetId || (objects.length ? objects[0].id : null));
  const [frames, setFrames] = useState([]);
  const [meta, setMeta] = useState(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const playRef = useRef(false);

  useEffect(() => {
    if (!sel) return;
    api
      .blink(sel)
      .then((d) => { setFrames(d.frames); setMeta(d.object); setIdx(0); setPlaying(false); })
      .catch(() => {});
  }, [sel]);

  // Auto-select the first tracked object once the catalogue arrives (covers
  // direct-load cases where `objects` is still empty on first mount).
  useEffect(() => {
    if (!sel && objects.length) setSel(objects[0].id);
  }, [objects, sel]);

  // Honour a deep-linked presetId (arrives after the catalogue loads).
  const prevPreset = useRef(null);
  useEffect(() => {
    if (!presetId || presetId === prevPreset.current) return;
    prevPreset.current = presetId;
    if (objects.some((o) => o.id === presetId)) setSel(presetId);
  }, [presetId, objects]);

  useEffect(() => {
    playRef.current = playing;
    if (!playing || !frames.length) return;
    // Functional update so the 240 ms cadence stays steady across frames instead
    // of being reset (and drifting) on every tick because `idx` changed.
    const timer = setInterval(() => setIdx((i) => (i + 1) % frames.length), 240);
    return () => clearInterval(timer);
  }, [playing, frames.length]);

  const step = (d) => { if (!frames.length) return; setIdx((idx + d + frames.length) % frames.length); };
  const select = (e) => { setPlaying(false); setSel(e.target.value); };

  return (
    <section className="blink-grid">
      <div className="panel">
        <div className="panel-head">
          <h2>BLINK COMPARATOR — TIME SERIES</h2>
          <span className="tag">{meta ? `${meta.id} · ${meta.motion} mas/day` : 'NO TARGET'}</span>
        </div>

        <div className="object-picker">
          <label>Tracked candidate</label>
          <select value={sel} onChange={select} className="select">
            {objects.map((o) => (
              <option key={o.id} value={o.id}>{o.id} · {o.name} · {o.type}</option>
            ))}
          </select>
        </div>

        <BlinkDraw canvasRef={canvasRef} wrapRef={wrapRef} frames={frames} idx={idx} />

        <div className="blink-controls">
          <button className="btn sm" onClick={() => step(-1)}>◀</button>
          <button className="btn sm primary" onClick={() => setPlaying(!playing)}>
            {playing ? '❚❚ PAUSE' : '▶ BLINK'}
          </button>
          <button className="btn sm" onClick={() => step(1)}>▶</button>
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={idx}
            onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
            className="range"
            disabled={!frames.length}
          />
          <span className="range-label">
            {frames[idx] ? new Date(frames[idx].epochISO).toISOString().slice(0, 10) : ''}
          </span>
        </div>

        <FrameTable frames={frames} idx={idx} />
      </div>

      <aside className="panel side">
        <div className="panel-head">
          <h2>DETECTION READOUT</h2>
          <span className="tag">ASTROMETRY</span>
        </div>
        {frames.length && meta
          ? <Readout frames={frames} idx={idx} meta={meta} />
          : <p className="muted empty">Select a candidate to compute differential motion.</p>}
      </aside>
    </section>
  );
}

function FrameTable({ frames, idx }) {
  if (!frames.length) return null;
  return (
    <table className="frame-table">
      <thead>
        <tr>
          <th>Pass</th>
          <th>Epoch (JD)</th>
          <th>RA</th>
          <th>DEC</th>
          <th>Mag</th>
          <th>SNR</th>
          <th>Q</th>
        </tr>
      </thead>
      <tbody>
        {frames.map((f, i) => (
          <tr key={f.pass} className={i === idx ? 'selected' : ''}>
            <td className="mono">{f.passCode}</td>
            <td className="mono">{f.epochJD}</td>
            <td className="mono">{fmtShortRA(f.ra)}</td>
            <td className="mono">{fmtShortDec(f.dec)}</td>
            <td>{f.measuredMag}</td>
            <td>{f.snr}</td>
            <td>{f.quality}{f.flagged ? ' ⚠' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmtShortRA(ra) {
  ra = ((ra % 360) + 360) % 360;
  const h = Math.floor(ra / 15);
  const m = Math.floor((ra / 15 - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fmtShortDec(dec) {
  const sign = dec < 0 ? '-' : '+';
  dec = Math.abs(dec);
  return `${sign}${String(Math.floor(dec)).padStart(2, '0')}.${String(Math.floor((dec - Math.floor(dec)) * 10))}`;
}