// Layer 4 — Data Representation: SED & spectra, image cutout, HEALPix heatmap.
//
// Renders the plan's "Spectral Energy Distributions & Spectra", "Image Cutouts"
// and "HEALPix / spatial footprints" families:
//   - an SVG multi-band SED chart (log-log) from /api/spectra/:id
//   - a synthetic PSF image cutout on <canvas>
//   - a HEALPix density heatmap (RA vs Dec) from /api/field/heatmap?nside=
//   - an IVOA name-resolver starter (Layer 1) to prove the ingestion seam.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtRA, fmtDec } from '../lib/api.js';

const CHART_W = 720;
const CHART_H = 340;
const PAD = { l: 52, r: 14, t: 18, b: 40 };

// asinh (inverse hyperbolic sine) scaling keeps log behaviour but survives zeros/negatives.
const std = Math;
function linScale(v) {
  const s = Math.abs(v) < 1e-12 ? 0 : Math.sign(v) * Math.log10(1 + Math.abs(v));
  return s;
}

export default function SpectraView({ objects, presetId }) {
  const [selectedId, setSelectedId] = useState(presetId || (objects[0] && objects[0].id) || null);
  const [sed, setSed] = useState(null);
  const [heat, setHeat] = useState(null);
  const [nside, setNside] = useState(64);
  const [resolveTerm, setResolveTerm] = useState('');
  const [resolved, setResolved] = useState(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [iveErr, setIvoErr] = useState('');

  useEffect(() => {
    if (presetId) setSelectedId(presetId);
  }, [presetId]);

  useEffect(() => {
    if (!selectedId) return;
    setSed(null);
    api
      .spectra(selectedId)
      .then((d) => setSed(d.sed))
      .catch(() => setSed({ error: 'failed to load spectrum' }));
  }, [selectedId]);

  useEffect(() => {
    api.fieldHeatmap(nside).then(setHeat).catch(() => {});
  }, [nside]);

  const onResolve = async () => {
    const t = resolveTerm.trim();
    if (!t) return;
    setResolveBusy(true);
    setIvoErr('');
    setResolved(null);
    try {
      setResolved(await api.ivoaResolve(t));
    } catch (e) {
      setIvoErr(e.message || 'resolve failed');
    } finally {
      setResolveBusy(false);
    }
  };

  const selected = objects.find((o) => o.id === selectedId) || null;

  return (
    <div className="spectra-grid">
      <section className="panel wide">
        <div className="panel-head">
          <h2>SED & SPECTRA</h2>
          <span className="tag">{selected ? selected.typeLabel : '—'}</span>
        </div>
        {objects.length > 0 && (
          <div className="toolbar">
            <span className="tb-label">TARGET</span>
            <select className="search" value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value)}>
              {objects.map((o) => (
                <option key={o.id} value={o.id}>{o.id} · {o.name}</option>
              ))}
            </select>
          </div>
        )}
        {sed && sed.object && <SedChart sed={sed} />}
        {sed && sed.error && <div className="empty-table">{sed.error}</div>}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>IMAGE CUTOUT</h2><span className="tag">SYNTHETIC PSF</span></div>
        <CutoutCanvas ra={selected ? selected.ra : 0} dec={selected ? selected.dec : 0} mag={selected ? selected.mag : 18} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>HEALPIX DENSITY</h2><span className="tag">NSIDE {nside}</span></div>
        <div className="toolbar">
          <span className="tb-label">RES</span>
          {[16, 32, 64, 128].map((n) => (
            <button key={n} className={`seg${nside === n ? ' on' : ''}`} onClick={() => setNside(n)}>{n}</button>
          ))}
        </div>
        <HeatmapCanvas heat={heat} />
      </section>

      <section className="panel wide">
        <div className="panel-head"><h2>IVOA NAME RESOLVER</h2><span className="tag">LAYER 1 · SIMBAD</span></div>
        <div className="resolve-row">
          <input
            className="search grow"
            placeholder="Resolve e.g. Crab, NGC 1952, 3C 273, TYC2 2234-01132-1…"
            value={resolveTerm}
            onChange={(e) => setResolveTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onResolve()}
          />
          <button className="btn" onClick={onResolve} disabled={resolveBusy}>{resolveBusy ? '…' : 'RESOLVE'}</button>
        </div>
        {resolved && (
          <div className="resolve-result">
            {resolved.found ? (
              <dl className="kv inline">
                <div><dt>RA</dt><dd className="mono">{fmtRA(resolved.ra)} ({resolved.ra.toFixed(5)}°)</dd></div>
                <div><dt>DEC</dt><dd className="mono">{fmtDec(resolved.dec)}</dd></div>
                {resolved.types && resolved.types.length > 0 && (<div><dt>Types</dt><dd>{resolved.types.join(', ')}</dd></div>)}
                {resolved.aliases && resolved.aliases.length > 1 && (<div><dt>Aliases</dt><dd>{resolved.aliases.slice(0, 5).join(', ')}</dd></div>)}
              </dl>
            ) : (
              <p className="muted">Not resolved: {resolved.reason || 'no match'}</p>
            )}
          </div>
        )}
        {iveErr && <p className="muted err">{iveErr}</p>}
      </section>
    </div>
  );
}
function SedChart({ sed }) {
  const { object, photometry, spectrum, bands } = sed;
  const pts = useMemo(() => {
    const lam = [...spectrum.map((s) => s.lambda), ...photometry.map((p) => p.lambda)];
    const flx = [...spectrum.map((s) => s.flux), ...photometry.map((p) => p.flux + (p.error || 0))];
    return {
      lMin: Math.min(...lam),
      lMax: Math.max(...lam),
      fMin: Math.max(1e-4, Math.min(...flx)),
      fMax: Math.max(...flx),
    };
  }, [spectrum, photometry]);

  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const X = (lam) => PAD.l + (Math.log10(lam) - Math.log10(pts.lMin)) / (Math.log10(pts.lMax) - Math.log10(pts.lMin)) * innerW;
  const Y = (flx) => CHART_H - PAD.b - (Math.log10(Math.max(flx, pts.fMin)) - Math.log10(pts.fMin)) / (Math.log10(pts.fMax) - Math.log10(pts.fMin)) * innerH;

  if (pts.lMax <= pts.lMin || pts.fMax <= pts.fMin) {
    return <div className="empty-table">No SED data.</div>;
  }

  const specPath = spectrum.map((s, i) => `${i === 0 ? 'M' : 'L'}${X(s.lambda).toFixed(1)},${Y(s.flux).toFixed(1)}`).join(' ');

  // log ticks for each axis
  const lambdaTicks = [0.2, 0.3, 0.5, 1, 2, 3, 5].filter((t) => t >= pts.lMin && t <= pts.lMax);
  const fluxDecades = Math.ceil(Math.log10(pts.fMax) - Math.log10(pts.fMin));
  const fluxStarts = Math.floor(Math.log10(pts.fMin));
  const fluxTicks = Array.from({ length: fluxDecades + 1 }, (_, i) => Math.pow(10, fluxStarts + i));

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="sed-chart" role="img" aria-label={`SED for ${object.name}`}>
      {fluxTicks.map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD.l} y1={Y(t)} x2={CHART_W - PAD.r} y2={Y(t)} />
          <text className="axis" x={PAD.l - 6} y={Y(t) + 3} textAnchor="end">{t >= 1 ? t : t.toExponential(0)}</text>
        </g>
      ))}
      {lambdaTicks.map((t) => (
        <g key={t}>
          <line className="grid" x1={X(t)} y1={PAD.t} x2={X(t)} y2={CHART_H - PAD.b} />
          <text className="axis" x={X(t)} y={CHART_H - PAD.b + 16} textAnchor="middle">{t}</text>
        </g>
      ))}
      <text className="axis-label" x={CHART_W / 2} y={CHART_H - 6} textAnchor="middle">Wavelength (µm)</text>
      <text className="axis-label" x={14} y={CHART_H / 2} textAnchor="middle" transform={`rotate(-90 14 ${CHART_H / 2})`}>Flux (relative)</text>

      <path d={specPath} className="spec-line" />

      {photometry.map((p) => {
        const cx = X(p.lambda);
        const cy = Y(p.flux);
        const y0 = Y(p.flux + (p.error || 0));
        const y1 = Y(p.flux - (p.error || 0));
        return (
          <g key={p.band} className="photo-pt">
            <line className="err-line" x1={cx} y1={y0} x2={cx} y2={y1} />
            <circle cx={cx} cy={cy} r={4} data-band={p.band}>
              <title>{p.band} · λ={p.lambda} µm · flux={p.flux} ± {p.error}</title>
            </circle>
          </g>
        );
      })}
      <text className="band-label" x={X(0.55)} y={Y(Math.min(...spectrum.map((s) => s.flux))) + 12} fontSize={11}>
        {object.name} · {object.typeLabel} · {bands[0].label.split('·')[0].trim()}+ (Teff≈{object.teff}K)
      </text>
    </svg>
  );
}

function CutoutCanvas({ ra, dec, mag }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const S = cv.width;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, S, S);
    // faint field stars
    let seed = 20260929;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 220; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const a = 0.05 + rnd() * 0.2;
      ctx.fillStyle = `rgba(255,140,60,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }
    // gaussian PSF (brightness scales with magnitude)
    const cx = S / 2;
    const cy = S / 2;
    const scale = Math.pow(10, (18 - (mag || 18)) / 2.5);
    const peak = Math.min(255, 255 * scale);
    const sigma = 6 + Math.random() * 2;
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    for (let y = cx - 30; y <= cx + 30; y++) {
      for (let x = cy - 30; x <= cy + 30; x++) {
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        const r = Math.hypot(x - cx, y - cy) / sigma;
        const val = Math.max(0, peak * Math.exp(-0.5 * r * r));
        const i = (y * S + x) * 4;
        d[i] = Math.min(255, d[i] + val);
        d[i + 1] = Math.min(255, d[i + 1] + val * 0.55);
        d[i + 2] = Math.min(255, d[i + 2] + val * 0.2);
      }
    }
    ctx.putImageData(img, 0, 0);
    // reticle
    ctx.strokeStyle = 'rgba(255,106,0,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 14, cy - 14, 28, 28);
  }, [ra, dec, mag]);

  return (
    <div className="cutout">
      <canvas ref={ref} width={260} height={260} />
      <div className="cutout-cap mono">RA {fmtRA(ra)} · DEC {fmtDec(dec)} · mag {mag}</div>
    </div>
  );
}

function HeatmapCanvas({ heat }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !heat || !heat.bins.length) return;
    const ctx = cv.getContext('2d');
    const S = cv.width;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, S, S);

    // bounding box (with a little padding) over the returned pixel centres
    const ras = heat.bins.map((b) => b.ra);
    const decs = heat.bins.map((b) => b.dec);
    const raMin = Math.min(...ras) - 0.5;
    const raMax = Math.max(...ras) + 0.5;
    const decMin = Math.min(...decs) - 0.5;
    const decMax = Math.max(...decs) + 0.5;
    const maxCount = Math.max(...heat.bins.map((b) => b.count));
    const cols = 44;
    const rowH = S / cols;
    // simple 2-D histogram coloured by count (dark -> neon orange)
    for (const b of heat.bins) {
      const gx = Math.floor(((b.ra - raMin) / (raMax - raMin)) * cols);
      const gy = Math.floor(((decMax - b.dec) / (decMax - decMin)) * cols);
      const t = b.count / maxCount;
      const alpha = 0.15 + 0.85 * t;
      ctx.fillStyle = `rgba(255,${Math.round(106 + 110 * t)},${Math.round(0 + 60 * t)},${alpha})`;
      ctx.fillRect(gx * rowH, gy * rowH, rowH, rowH);
    }
    ctx.strokeStyle = 'rgba(255,106,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }, [heat]);

  if (!heat || !heat.bins.length) {
    return (
      <div className="cutout">
        <canvas ref={ref} width={260} height={260} />
        <div className="cutout-cap mono">no data</div>
      </div>
    );
  }
  return (
    <div className="cutout">
      <canvas ref={ref} width={260} height={260} />
      <div className="cutout-cap mono">{heat.pixelCount} cells · resol ~{heat.resolArcsec}″</div>
    </div>
  );
}
