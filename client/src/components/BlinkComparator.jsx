import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { motionStats } from '../lib/astrometry.js';
import BlinkDraw from './BlinkDraw.jsx';
import Readout from './Readout.jsx';

function fmtArc(mas) {
  if (!Number.isFinite(mas)) return '—';
  const a = Math.abs(mas);
  if (a < 1000) return `${a < 10 ? a.toFixed(1) : a.toFixed(0)} mas`;
  if (a < 600_000) return `${(a / 1000).toFixed(2)}″`;
  return `${(a / 3.6e6).toFixed(2)}°`;
}

function niceStep(range) {
  if (!(range > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(range)));
  const n = range / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
}

export default function BlinkComparator({ objects, selectedId: selectedIdProp = null, onSelect = () => {}, onTarget = () => {} }) {
  // Shared cross-view selection (owned by App) with a local fallback to the
  // first catalogue entry so the view is never empty.
  const sel = selectedIdProp && objects.some((o) => o.id === selectedIdProp)
    ? selectedIdProp
    : (objects.length ? objects[0].id : null);
  const setSel = (id) => { if (id !== sel) onSelect(id); };
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

  // Shared tangent-plane summary powering the readout + both charts.
  const stats = useMemo(() => motionStats(frames), [frames]);

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

        <div className="toolbar">
          <span className="tb-label">OPEN</span>
          <button className="btn sm" disabled={!sel} onClick={() => sel && onTarget('sky', sel)}>SKY VIEWER ⌖</button>
          <button className="btn sm" disabled={!sel} onClick={() => sel && onTarget('spectra', sel)}>SPECTRA ∿</button>
          <button className="btn sm" disabled={!sel} onClick={() => sel && onTarget('catalogue', sel)}>CATALOGUE ≋</button>
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
          ? <Readout frames={frames} idx={idx} meta={meta} stats={stats} />
          : <p className="muted empty">Select a candidate to compute differential motion.</p>}
      </aside>

      {frames.length > 0 && (
        <div className="panel blink-charts">
          <div className="panel-head">
            <h2>MOTION &amp; BRIGHTNESS</h2>
            <span className="tag">ACROSS {frames.length} PASSES</span>
          </div>
          <div className="blink-charts-grid">
            <MotionPlot stats={stats} idx={idx} />
            <LightCurve stats={stats} idx={idx} />
          </div>
        </div>
      )}
    </section>
  );
}

// Tangent-plane motion track: true on-sky offsets (mas) of each pass relative
// to the first epoch. A single shared scale keeps the track's angle truthful.
function MotionPlot({ stats, idx }) {
  const path = (stats && stats.path) || [];
  if (path.length === 0) return <p className="muted empty">No motion data.</p>;
  const W = 360, H = 262;
  const pad = { l: 50, r: 16, t: 16, b: 34 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const es = path.map((p) => p.east);
  const ns = path.map((p) => p.north);
  let eMin = Math.min(...es, 0), eMax = Math.max(...es, 0);
  let nMin = Math.min(...ns, 0), nMax = Math.max(...ns, 0);
  if (eMax - eMin < 1e-3) { eMin -= 1; eMax += 1; }
  if (nMax - nMin < 1e-3) { nMin -= 1; nMax += 1; }
  const eMid = (eMin + eMax) / 2;
  const nMid = (nMin + nMax) / 2;
  const scale = Math.min(iw / (eMax - eMin), ih / (nMax - nMin));
  const X = (e) => pad.l + iw / 2 + (e - eMid) * scale;
  const Y = (n) => pad.t + ih / 2 - (n - nMid) * scale;
  const stepE = niceStep((eMax - eMin) / 3);
  const stepN = niceStep((nMax - nMin) / 3);
  const ticksE = [];
  for (let v = Math.ceil(eMin / stepE) * stepE; v <= eMax + 1e-9; v += stepE) ticksE.push(v);
  const ticksN = [];
  for (let v = Math.ceil(nMin / stepN) * stepN; v <= nMax + 1e-9; v += stepN) ticksN.push(v);
  const d = path.map((p, i) => `${i ? 'L' : 'M'}${X(p.east).toFixed(1)},${Y(p.north).toFixed(1)}`).join(' ');
  const now = path[Math.min(idx, path.length - 1)];
  return (
    <div className="chart">
      <h4 className="chart-title">MOTION TRACK <span className="muted">· east / north offset</span></h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="motion-svg" role="img" aria-label="Tangent-plane motion track">
        <rect x={pad.l} y={pad.t} width={iw} height={ih} className="mp-frame" />
        {ticksE.map((v) => (
          <line key={`e${v}`} x1={X(v)} y1={pad.t} x2={X(v)} y2={pad.t + ih} className="mp-grid" />
        ))}
        {ticksN.map((v) => (
          <line key={`n${v}`} x1={pad.l} y1={Y(v)} x2={pad.l + iw} y2={Y(v)} className="mp-grid" />
        ))}
        <line x1={X(0)} y1={pad.t} x2={X(0)} y2={pad.t + ih} className="mp-origin" />
        <line x1={pad.l} y1={Y(0)} x2={pad.l + iw} y2={Y(0)} className="mp-origin" />
        {ticksE.map((v) => (
          <text key={`el${v}`} x={X(v)} y={pad.t + ih + 13} textAnchor="middle" className="mp-tick">{fmtArc(v)}</text>
        ))}
        {ticksN.map((v) => (
          <text key={`nl${v}`} x={pad.l - 6} y={Y(v) + 3} textAnchor="end" className="mp-tick">{fmtArc(v)}</text>
        ))}
        <text x={pad.l + iw / 2} y={H - 3} textAnchor="middle" className="mp-axis">← west · east →</text>
        <text x={13} y={pad.t + ih / 2} textAnchor="middle" className="mp-axis" transform={`rotate(-90 13 ${pad.t + ih / 2})`}>north ↑</text>
        <path d={d} className="mp-path" />
        {path.map((p, i) => (
          <circle
            key={p.passCode || i}
            cx={X(p.east)}
            cy={Y(p.north)}
            r={i === idx ? 5 : 2.5}
            className={`mp-dot${i === idx ? ' now' : ''}${p.flagged ? ' flagged' : ''}`}
          />
        ))}
      </svg>
      <p className="muted caption">
        Track across {path.length} passes; the axes cross at the first epoch (dashed). The bright dot is the current pass
        {now ? ` (${fmtArc(Math.hypot(now.east, now.north))} from the start).` : '.'}
      </p>
    </div>
  );
}

// Brightness history: the target's binned magnitude at each pass. Magnitudes are
// inverted (brighter = higher on the plot) so "up = brighter" reads naturally.
function LightCurve({ stats, idx }) {
  const path = (stats && stats.path) || [];
  const mags = path.map((p) => p.mag).filter((m) => Number.isFinite(m));
  if (mags.length === 0) return <p className="muted empty">No brightness data.</p>;
  const W = 360, H = 262;
  const pad = { l: 46, r: 16, t: 16, b: 34 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const min = Math.min(...mags);
  const max = Math.max(...mags);
  const span = Math.max(0.4, max - min);
  const lo = max + span * 0.18; // faint (bottom)
  const hi = min - span * 0.18; // bright (top)
  const X = (i) => pad.l + (path.length > 1 ? (i / (path.length - 1)) * iw : iw / 2);
  const Y = (m) => pad.t + ((m - hi) / (lo - hi)) * ih;
  const stepM = niceStep((lo - hi) / 3) || 0.2;
  const ticks = [];
  for (let v = Math.ceil(hi / stepM) * stepM; v <= lo + 1e-9; v += stepM) ticks.push(v);
  const d = path
    .map((p, i) => (Number.isFinite(p.mag) ? `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.mag).toFixed(1)}` : ''))
    .filter(Boolean)
    .join(' ');
  const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
  const dateAt = (i) => (path[i] && path[i].epochISO ? new Date(path[i].epochISO).toISOString().slice(5, 10) : '');
  return (
    <div className="chart">
      <h4 className="chart-title">LIGHT CURVE <span className="muted">· magnitude per pass</span></h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="lightcurve-svg" role="img" aria-label="Brightness versus pass">
        <rect x={pad.l} y={pad.t} width={iw} height={ih} className="mp-frame" />
        {ticks.map((v) => (
          <line key={v} x1={pad.l} y1={Y(v)} x2={pad.l + iw} y2={Y(v)} className="mp-grid" />
        ))}
        {ticks.map((v) => (
          <text key={`l${v}`} x={pad.l - 6} y={Y(v) + 3} textAnchor="end" className="mp-tick">{v.toFixed(1)}</text>
        ))}
        <line x1={pad.l} y1={Y(mean)} x2={pad.l + iw} y2={Y(mean)} className="lc-mean" />
        <path d={d} className="lc-path" />
        {path.map((p, i) =>
          Number.isFinite(p.mag) ? (
            <circle
              key={p.passCode || i}
              cx={X(i)}
              cy={Y(p.mag)}
              r={i === idx ? 4.6 : 2.4}
              className={`mp-dot${i === idx ? ' now' : ''}`}
            />
          ) : null
        )}
        {[0, Math.floor((path.length - 1) / 2), path.length - 1].map((i) => (
          <text key={`x${i}`} x={X(i)} y={pad.t + ih + 14} textAnchor={i === 0 ? 'start' : i === path.length - 1 ? 'end' : 'middle'} className="mp-tick">
            {dateAt(i)}
          </text>
        ))}
        <text x={13} y={pad.t + ih / 2} textAnchor="middle" className="mp-axis" transform={`rotate(-90 13 ${pad.t + ih / 2})`}>magnitude</text>
      </svg>
      <p className="muted caption">
        Binned magnitude each pass; higher = brighter. The dashed line is the mean ({mean.toFixed(2)}). Constant light with
        steady drift points to a Solar-System mover; a change in brightness suggests a variable source.
      </p>
    </div>
  );
}

function FrameTable({ frames, idx }) {
  if (!frames.length) return null;
  return (
    <div className="frame-table-wrap">
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
    </div>
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