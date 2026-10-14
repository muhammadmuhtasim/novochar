// Layer 4 — Data Representation: spectral analysis workbench.
//
// Turns the SPECTRA tab into a scientific tool:
//   - 1-D flux-vs-wavelength plot with labelled spectral-line markers and an
//     interactive Doppler / redshift slider that shifts the line template.
//   - Photometric points with error bars (Gaia / SDSS / SPHEREx bands).
//   - Line-free continuum overlay + residual strip for line identification.
//   - SPHEREx bandpass guide across the top of the plot.
//   - Cross-correlation redshift estimator (AUTO z) with a live match score.
//   - Spectral index (F_λ ∝ λ^α) and line-contrast readouts.
//   - 2-D IFS-style dispersion image (toggle).
//   - Interactive HEALPix map: click a cell to load that source's spectrum, or
//     engage compare mode to stack / overlay spectra in colour.
//   - Target metadata bar + export (CSV / JSON / FITS / SVG / PNG).
//   - Help/legend modal + hover tooltips.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtRA, fmtDec } from '../lib/api.js';
import { spectrumTransform, niceTicks } from '../lib/spectrum-plot.js';
import {
  spectralIndex,
  residualSpectrum,
  alignmentScore,
  estimateRedshift,
  nearestLine,
} from '../lib/spectral-analysis.js';
import {
  spectrumCSV,
  spectrumJSON,
  spectrumFITS,
  spectraSVG,
  spectrumPNGDataURL,
  downloadBlob,
} from '../lib/spectra-export.js';

const PALETTE = ['#ff6a00', '#2bd6ff', '#ff3fd0', '#7dff7d', '#ffe14d', '#b389ff', '#52ffd0'];

// SPHEREx's six near-infrared bandpasses (µm). Kept here (client-side) purely to
// draw the bandpass guide; the authoritative labels come from the server.
const SPHEREX_BANDS = [
  { index: 1, lo: 0.75, hi: 1.11 },
  { index: 2, lo: 1.11, hi: 1.64 },
  { index: 3, lo: 1.64, hi: 2.42 },
  { index: 4, lo: 2.42, hi: 3.82 },
  { index: 5, lo: 3.82, hi: 4.42 },
  { index: 6, lo: 4.42, hi: 5.0 },
];

function fmtW(v) {
  return v >= 1 ? v.toFixed(2) : v.toFixed(4);
}

export default function SpectraView({ objects, presetId, onTarget = () => {} }) {
  const [selectedId, setSelectedId] = useState(presetId || (objects[0] && objects[0].id) || null);
  const [sed, setSed] = useState(null);
  const [heat, setHeat] = useState(null);
  const [nside, setNside] = useState(64);
  const [z, setZ] = useState(0);
  const [view, setView] = useState('1d'); // '1d' | '2d'
  const [xScale, setXScale] = useState('linear');
  const [showContinuum, setShowContinuum] = useState(true);
  const [showResidual, setShowResidual] = useState(false);
  const [showBands, setShowBands] = useState(true);
  const [help, setHelp] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compare, setCompare] = useState([]); // [{id, name, color}]
  const [compareData, setCompareData] = useState({}); // id -> {sed, color}
  const [resolveTerm, setResolveTerm] = useState('');
  const [resolved, setResolved] = useState(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [ivoErr, setIvoErr] = useState('');
  const [zEstimate, setZEstimate] = useState(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [crosshair, setCrosshair] = useState(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (presetId) { setSelectedId(presetId); setZ(0); setZEstimate(null); }
  }, [presetId]);

  // Auto-select the first tracked object once the catalogue arrives.
  useEffect(() => {
    if (!selectedId && objects.length) setSelectedId(objects[0].id);
  }, [objects, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setSed(null);
    setCrosshair(null);
    setZEstimate(null);
    api.spectra(selectedId).then((d) => setSed(d.sed)).catch(() => setSed({ error: 'failed to load spectrum' }));
  }, [selectedId]);

  useEffect(() => {
    api.fieldHeatmap(nside).then(setHeat).catch(() => {});
  }, [nside]);

  const selected = objects.find((o) => o.id === selectedId) || null;

  // Live cross-correlation score of the shifted line template against the data.
  const matchScore = useMemo(
    () => (sed && sed.spectrum ? alignmentScore(sed, z, sed.lines || []) : 0),
    [sed, z]
  );
  const slope = useMemo(() => (sed && sed.spectrum ? spectralIndex(sed) : { alpha: NaN }), [sed]);
  // Fractional strength of the strongest spectral feature = max |residual|.
  const peakLine = useMemo(() => {
    if (!sed || !sed.spectrum) return NaN;
    const r = residualSpectrum(sed).filter((p) => Number.isFinite(p.y));
    return r.length ? Math.max(...r.map((p) => Math.abs(p.y))) : NaN;
  }, [sed]);

  const addCompare = (id) => {
    const obj = objects.find((o) => o.id === id);
    if (!obj || compare.some((c) => c.id === id)) return;
    const color = PALETTE[compare.length % PALETTE.length];
    setCompare((c) => [...c, { id, name: obj.name, color }]);
    api.spectra(id).then((d) => setCompareData((m) => ({ ...m, [id]: { sed: d.sed, color } }))).catch(() => {});
  };
  const removeCompare = (id) => {
    setCompare((c) => c.filter((x) => x.id !== id));
    setCompareData((m) => { const n = { ...m }; delete n[id]; return n; });
  };
  const clearCompare = () => { setCompare([]); setCompareData({}); };

  const overlays = useMemo(
    () =>
      compare
        .map((c) => ({ sed: compareData[c.id] && compareData[c.id].sed, color: c.color, label: c.name }))
        .filter((o) => o.sed),
    [compare, compareData]
  );

  const runAutoZ = () => {
    if (!sed || !sed.spectrum) return;
    setAutoBusy(true);
    try {
      const result = estimateRedshift(sed, sed.lines || [], { min: 0, max: 1.2, step: 0.002 });
      setZ(result.z);
      setZEstimate(result);
    } finally {
      setAutoBusy(false);
    }
  };

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

  const pick = (id) => {
    if (compareMode) addCompare(id);
    else setSelectedId(id);
  };

  return (
    <div className="spectra-grid">
      <section className="panel wide">
        <div className="panel-head">
          <h2>SPECTRA — 1D / 2D</h2>
          <span className="tag">{selected ? selected.typeLabel : '—'}</span>
          <div className="head-tools">
            <button className="btn sm" onClick={() => setHelp(true)} title="What does this mean?">? HELP</button>
            {sed && sed.object && <ExportControls sed={sed} z={z} xScale={xScale} svgRef={svgRef} />}
          </div>
        </div>

        <div className="toolbar">
          <span className="tb-label">TARGET</span>
          <select className="search" value={selectedId || ''} onChange={(e) => { setSelectedId(e.target.value); setZ(0); setZEstimate(null); }}>
            {objects.map((o) => (<option key={o.id} value={o.id}>{o.id} · {o.name}</option>))}
          </select>
          <span className="tb-spacer" />
          <span className="tb-label">VIEW</span>
          <div className="seg">
            <button className={`seg${view === '1d' ? ' on' : ''}`} onClick={() => setView('1d')}>1D</button>
            <button className={`seg${view === '2d' ? ' on' : ''}`} onClick={() => setView('2d')}>2D</button>
          </div>
          <span className="tb-spacer" />
          <span className="tb-label">WAVE</span>
          <div className="seg">
            <button className={`seg${xScale === 'linear' ? ' on' : ''}`} onClick={() => setXScale('linear')}>λ LIN</button>
            <button className={`seg${xScale === 'log' ? ' on' : ''}`} onClick={() => setXScale('log')}>λ LOG</button>
          </div>
          <span className="tb-spacer" />
          <button className={`btn sm${compareMode ? ' primary' : ''}`} onClick={() => setCompareMode(!compareMode)} title="Click HEALPix cells to stack spectra">
            {compareMode ? 'COMPARE ON (click ⬡)' : 'COMPARE OFF'}
          </button>
          <span className="tb-spacer" />
          <span className="tb-label">OPEN</span>
          {selected && (<>
            <button className="btn sm" onClick={() => onTarget('sky', selected.id)}>SKY ⌖</button>
            <button className="btn sm" onClick={() => onTarget('blink', selected.id)}>BLINK ⧗</button>
            <button className="btn sm" onClick={() => onTarget('catalogue', selected.id)}>CATALOGUE ≋</button>
          </>)}
        </div>

        {selected && sed && sed.object && <MetadataBar o={selected} sed={sed} z={z} />}

        {view === '1d' && sed && sed.object && sed.spectrum && (
          <div className="spec-readout">
            <span className="spec-stat" title="Rest-frame spectral index F_λ ∝ λ^α, fitted over the line-free continuum">
              <i className="spec-stat-k">SPECTRAL INDEX α</i>
              <b className={`spec-stat-v ${Number.isFinite(slope.alpha) ? (slope.alpha < -1 ? 'red' : 'blue') : ''}`}>
                {Number.isFinite(slope.alpha) ? slope.alpha.toFixed(2) : '—'}
              </b>
            </span>
            <span className="spec-stat" title="Fractional strength of the strongest line feature: max |flux − continuum| / continuum">
              <i className="spec-stat-k">STRONGEST LINE</i>
              <b className="spec-stat-v">{Number.isFinite(peakLine) ? `${(peakLine * 100).toFixed(1)}%` : '—'}</b>
            </span>
            <span className="spec-stat" title="Cross-correlation of the rest-frame line template (shifted by z) with the observed line residuals">
              <i className="spec-stat-k">TEMPLATE MATCH</i>
              <b className="spec-stat-v">{matchScore.toFixed(3)}</b>
            </span>
            <span className="spec-stat">
              <i className="spec-stat-k">AUTO z</i>
              <b className="spec-stat-v">{zEstimate ? zEstimate.z.toFixed(4) : '—'}</b>
            </span>
            <span className="tb-spacer" />
            <label className="spec-toggle"><input type="checkbox" checked={showContinuum} onChange={(e) => setShowContinuum(e.target.checked)} /> continuum</label>
            <label className="spec-toggle"><input type="checkbox" checked={showResidual} onChange={(e) => setShowResidual(e.target.checked)} /> residual</label>
            <label className="spec-toggle"><input type="checkbox" checked={showBands} onChange={(e) => setShowBands(e.target.checked)} /> bands</label>
          </div>
        )}

        {sed && sed.error ? (
          <div className="empty-table err">{sed.error}</div>
        ) : view === '2d' ? (
          <SpectralImage2D sed={sed} />
        ) : (
          <>
            <SedPlot
              primary={sed}
              overlays={overlays}
              z={z}
              xScale={xScale}
              svgRef={svgRef}
              showContinuum={showContinuum}
              showResidual={showResidual}
              showBands={showBands}
              bandIndex={selected && selected.bandIndex}
              crosshair={crosshair}
              onCrosshair={setCrosshair}
            />
            {sed && sed.object && sed.spectrum && (
              <RedshiftControl z={z} setZ={setZ} onAuto={runAutoZ} autoBusy={autoBusy} zEstimate={zEstimate} />
            )}
          </>
        )}

        {view === '1d' && sed && sed.object && sed.lines && (
          <div className="spec-legend">
            <span><i className="key-dot em" /> EMISSION</span>
            <span><i className="key-dot abs" /> ABSORPTION</span>
            <span><i className="key-dot cont" /> CONTINUUM</span>
            <span className="muted">λ<sub>obs</sub> = λ<sub>rest</sub>·(1+z)</span>
            {crosshair && crosshair.line && (
              <span className="muted">nearest: {crosshair.line.label} ({crosshair.line.kind})</span>
            )}
          </div>
        )}
      </section>

      {view === '1d' && sed && sed.lines && sed.spectrum && (
        <section className="panel wide">
          <div className="panel-head">
            <h2>LINE IDENTIFICATION</h2>
            <span className="tag">{sed.lines.length} TEMPLATE LINES</span>
            <span className="muted sm">rest → observed at z = {z.toFixed(3)}</span>
          </div>
          <LineTable sed={sed} z={z} />
        </section>
      )}

      {compare.length > 0 && (
        <section className="panel wide">
          <div className="panel-head">
            <h2>COMPARISON STACK</h2>
            <span className="tag">{compare.length} TARGET{compare.length === 1 ? '' : 'S'}</span>
            <button className="btn sm" onClick={clearCompare}>CLEAR</button>
          </div>
          <div className="compare-legend">
            {compare.map((c) => (
              <span key={c.id} className="compare-chip">
                <i style={{ background: c.color }} /> {c.id} · {c.name}
                <button className="btn sm chip-x" onClick={() => removeCompare(c.id)}>✕</button>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h2>HEALPIX FIELD</h2><span className="tag">NSIDE {nside}</span></div>
        <div className="toolbar">
          <span className="tb-label">RESOL</span>
          {[16, 32, 64, 128, 256].map((s) => (
            <button key={s} className={`seg${nside === s ? ' on' : ''}`} onClick={() => setNside(s)}>{s}</button>
          ))}
          <span className="tb-spacer" />
          <span className="tb-label">CLICK</span>
          <span className="muted sm">{compareMode ? 'ADD TO STACK' : 'LOAD SPECTRUM'}</span>
        </div>
        <HeatmapPanel heat={heat} objects={objects} onPick={pick} compareMode={compareMode} />
        <p className="muted caption">Click an illuminated cell to load that source’s spectrum; toggle COMPARE to stack several and overlay them in the plot.</p>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>SYNTHETIC PSF</h2><span className="tag">IMAGE</span></div>
        {selected && sed && sed.object ? <PSFCutout o={sed.object} /> : <p className="muted empty">Select a target.</p>}
      </section>

      <section className="panel wide">
        <div className="panel-head"><h2>IVOA NAME RESOLVER</h2><span className="tag">LAYER 1 · SIMBAD</span></div>
        <div className="resolve-row">
          <input className="search grow" placeholder="Resolve an object name — e.g. Crab, NGC 1952, 3C 273" value={resolveTerm} onChange={(e) => setResolveTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onResolve()} />
          <button className="btn" onClick={onResolve} disabled={resolveBusy}>{resolveBusy ? 'RESOLVING…' : 'RESOLVE'}</button>
        </div>
        {ivoErr && <p className="muted err">{ivoErr}</p>}
        {resolved && <ResolvedCard resolved={resolved} />}
      </section>

      {help && <HelpModal onClose={() => setHelp(false)} />}
    </div>
  );
}

function ResolvedCard({ resolved }) {
  // The resolver API returns a FLAT shape: { name, service, found, ra, dec,
  // aliases?, reason? }. Guard for both found and not-found so a failed lookup
  // never throws (which previously collapsed the whole tab).
  if (!resolved.found) {
    return (
      <p className="muted err resolve-miss">
        No coordinates found for “{resolved.name}” · {resolved.service || 'resolver'}
        {resolved.reason ? ` (${resolved.reason})` : ''}
      </p>
    );
  }
  const hasCoords = Number.isFinite(resolved.ra) && Number.isFinite(resolved.dec);
  return (
    <div className="resolve-result">
      <div className="kv inline">
        <div><dt>Name</dt><dd className="mono">{resolved.name}</dd></div>
        <div><dt>Service</dt><dd className="mono">{resolved.service}</dd></div>
        <div><dt>RA</dt><dd className="mono">{hasCoords ? fmtRA(resolved.ra) : '—'}</dd></div>
        <div><dt>DEC</dt><dd className="mono">{hasCoords ? fmtDec(resolved.dec) : '—'}</dd></div>
      </div>
      {resolved.aliases && resolved.aliases.length > 0 && (
        <p className="muted">aliases: {resolved.aliases.slice(0, 8).join(', ')}</p>
      )}
      <p className="muted">Resolved coordinates can be entered into the SKY VIEWER search to centre on this region.</p>
    </div>
  );
}

function MetadataBar({ o, sed, z }) {
  const meta = sed.meta || {};
  const m = sed.object || o || {};
  const items = [
    ['Object ID', m.id],
    ['Designation', m.name],
    ['RA / DEC', fmtRA(m.ra) + ' · ' + fmtDec(m.dec)],
    ['CLASS', m.typeLabel],
    ['MAG', m.mag != null ? m.mag + ' mag' : '—'],
    ['SNR', meta.snr ?? '—'],
    ['INTEGRATION', meta.integrationSec ? meta.integrationSec + ' s' : '—'],
    ['FILTER / GRATING', meta.filter && meta.grating ? meta.filter + ' · ' + meta.grating : '—'],
    ['TEFF', m.teff ? m.teff + ' K' : '—'],
    ['z TEMPLATE', (z ?? 0).toFixed(3)],
  ];
  return (
    <div className="meta-bar">
      {items.map(([k, v]) => (
        <div className="meta-cell" key={k}>
          <span className="meta-k">{k}</span>
          <span className="meta-v mono">{v}</span>
        </div>
      ))}
    </div>
  );
}

function RedshiftControl({ z, setZ, onAuto, autoBusy, zEstimate }) {
  const c = 299792.458; // km/s
  const v = c * z;
  const velTxt = v < 10000 ? `${Math.round(v)} km/s` : `${(v / 1000).toFixed(1)} ×10³ km/s`;
  return (
    <div className="redshift">
      <div className="rs-row">
        <span className="tb-label">DOPPLER / REDSHIFT</span>
        <input type="range" min="0" max="3" step="0.001" value={z} onChange={(e) => setZ(parseFloat(e.target.value))} className="range rs-range" aria-label="Redshift slider" />
        <span className="rs-val mono">z = {z.toFixed(3)}</span>
        <span className="rs-val mono muted">v ≈ {velTxt}</span>
        <button className="btn sm" onClick={onAuto} disabled={autoBusy} title="Cross-correlate the line template against the observed residuals">
          {autoBusy ? 'FITTING…' : 'AUTO z'}
        </button>
        {zEstimate && (
          <span className="rs-val mono" title="Best-fit redshift from template cross-correlation">
            fit z = {zEstimate.z.toFixed(4)} · score {zEstimate.score.toFixed(3)}
          </span>
        )}
      </div>
      <p className="muted caption">
        Shifts the labelled line template to λ<sub>obs</sub> = λ<sub>rest</sub>·(1+z). Slide to align the markers
        with the observed absorption/emission features, or press AUTO z to cross-correlate automatically.
      </p>
    </div>
  );
}

function ExportControls({ sed, z, xScale, svgRef }) {
  const [open, setOpen] = useState(false);
  const base = `${sed.object.id || 'spectrum'}`;
  const run = (fmt) => {
    if (fmt === 'csv') downloadBlob(new Blob([spectrumCSV(sed)], { type: 'text/csv' }), `${base}.csv`);
    else if (fmt === 'json') downloadBlob(new Blob([spectrumJSON(sed)], { type: 'application/json' }), `${base}.json`);
    else if (fmt === 'fits') downloadBlob(spectrumFITS(sed), `${base}.fits`);
    else if (fmt === 'svg') { const b = spectraSVG(svgRef && svgRef.current); if (b) downloadBlob(b, `${base}.svg`); }
    else if (fmt === 'png') { const a = document.createElement('a'); a.href = spectrumPNGDataURL(sed, { z, xScale, lines: sed.lines || [] }); a.download = `${base}.png`; a.click(); }
    setOpen(false);
  };
  return (
    <div className="export-menu">
      <button className="btn sm" onClick={() => setOpen(!open)} title="Export spectrum data">EXPORT ⤓</button>
      {open && (
        <div className="export-dd">
          <button onClick={() => run('csv')}>CSV · 1-D array</button>
          <button onClick={() => run('json')}>JSON · full SED</button>
          <button onClick={() => run('fits')}>FITS · image</button>
          <button onClick={() => run('svg')}>SVG · vector</button>
          <button onClick={() => run('png')}>PNG · raster</button>
        </div>
      )}
    </div>
  );
}

// Generic sampler → SVG path, skipping non-finite coordinates (log-axis safety).
function pathFor(spectrum, tr, key = 'flux') {
  const parts = [];
  for (const p of spectrum || []) {
    const x = tr.X(p.lambda);
    const y = tr.Y(p[key]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    parts.push(parts.length === 0 ? `M${x},${y}` : `L${x},${y}`);
  }
  return parts.join(' ');
}

function SedPlot({ primary, overlays, z, xScale, svgRef, showContinuum, showResidual, showBands, bandIndex, crosshair, onCrosshair }) {
  if (!primary || !primary.spectrum || !primary.spectrum.length) {
    return <div className="empty-table">{primary && primary.error ? primary.error : 'Loading spectrum…'}</div>;
  }
  const W = 760;
  const H = 380;
  const pad = { l: 56, r: 16, t: 34, b: 44 };
  const allSpectra = [primary, ...overlays.map((o) => o.sed)];
  const tr = spectrumTransform(allSpectra.filter((s) => s && s.spectrum && s.spectrum.length > 0), { xScale, w: W, h: H, pad });
  const lineD = pathFor(primary.spectrum, tr, 'flux');
  const contD = primary.spectrum.some((p) => Number.isFinite(p.continuum)) ? pathFor(primary.spectrum, tr, 'continuum') : '';
  const xticks = niceTicks(tr.wMin, tr.wMax, 8);
  const yticks = [];
  for (let i = Math.ceil(tr.fMin); i <= Math.floor(tr.fMax); i++) yticks.push(i);
  const visibleLines = (primary.lines || [])
    .map((l) => ({ ...l, obs: l.rest * (1 + z) }))
    .filter((l) => l.obs >= tr.wMin && l.obs <= tr.wMax);

  // Report the nearest sample to the pointer, but only when the snapped sample
  // actually changes — this keeps mouse-move from re-rendering the whole view.
  const lastHit = useRef(null);
  const onMove = (e) => {
    if (!onCrosshair) return;
    const svg = svgRef && svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    let best = null;
    let bd = Infinity;
    for (const p of primary.spectrum) {
      const x = tr.X(p.lambda);
      if (!Number.isFinite(x)) continue;
      const d = Math.abs(x - sx);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || lastHit.current === best.lambda) return;
    lastHit.current = best.lambda;
    const line = nearestLine(primary.lines || [], best.lambda, z);
    onCrosshair({ lambda: best.lambda, flux: best.flux, continuum: best.continuum, line, x: tr.X(best.lambda), y: tr.Y(best.flux) });
  };

  return (
    <>
      <div className="sed-plot-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="sed-chart"
        role="img"
        aria-label="Flux vs wavelength spectrum"
        onMouseMove={onMove}
        onMouseLeave={() => onCrosshair && onCrosshair(null)}
      >
        <rect x={tr.pad.l} y={tr.pad.t} width={W - tr.pad.l - tr.pad.r} height={H - tr.pad.t - tr.pad.b} className="plot-box" />
        {xticks.map((t) => <line key={'x' + t} x1={tr.X(t)} y1={tr.pad.t} x2={tr.X(t)} y2={H - tr.pad.b} className="grid" />)}
        {yticks.map((i) => <line key={'y' + i} x1={tr.pad.l} y1={tr.Y(Math.pow(10, i))} x2={W - tr.pad.r} y2={tr.Y(Math.pow(10, i))} className="grid" />)}
        {xticks.map((t) => <text key={'xt' + t} x={tr.X(t)} y={H - 16} textAnchor="middle" className="axis">{fmtW(t)}</text>)}
        {yticks.map((i) => <text key={'yt' + i} x={tr.pad.l - 6} y={tr.Y(Math.pow(10, i)) + 4} textAnchor="end" className="axis">{i === 0 ? '1' : `1e${i}`}</text>)}
        <text x={W / 2} y={H - 2} textAnchor="middle" className="axis-label">Wavelength (µm)</text>
        <text x={12} y={H / 2} transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle" className="axis-label">Synthetic flux (a.u., log)</text>

        {showBands && (
          <g className="band-guide">
            {SPHEREX_BANDS.map((b) => {
              const x0 = tr.X(Math.max(b.lo, tr.wMin));
              const x1 = tr.X(Math.min(b.hi, tr.wMax));
              if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) return null;
              const on = b.index === bandIndex;
              return (
                <g key={b.index} className={on ? 'band on' : 'band'}>
                  <rect x={x0} y={8} width={x1 - x0} height={14} />
                  <text x={(x0 + x1) / 2} y={19} textAnchor="middle" className="band-lbl">B{b.index}</text>
                </g>
              );
            })}
          </g>
        )}

        {overlays.map((o) => (
          <path key={o.label} d={pathFor(o.sed.spectrum, tr, 'flux')} className="overlay-line" style={{ stroke: o.color }} />
        ))}
        {showContinuum && contD && <path d={contD} className="cont-line" />}
        <path d={lineD} className="spec-line" />

        {(primary.photometry || []).map((p) => {
          const x = tr.X(p.lambda);
          const y = tr.Y(p.flux);
          const yTop = tr.Y(p.flux + p.error);
          const yBot = tr.Y(Math.max(p.flux - p.error, 1e-6));
          return (
            <g key={p.band} className="photo-pt">
              <line x1={x} y1={yTop} x2={x} y2={yBot} className="err-line" />
              <circle cx={x} cy={y} r="3" >
                <title>{`${p.band} @ ${p.lambda} µm · flux ${p.flux} ± ${p.error}`}</title>
              </circle>
            </g>
          );
        })}
        {visibleLines.map((l) => {
          const x = tr.X(l.obs);
          return (
            <g key={l.label + l.obs.toFixed(4)} className={`line-marker ${l.kind}`}>
              <line x1={x} y1={tr.pad.t} x2={x} y2={H - tr.pad.b} className={`line-w ${l.kind}`} />
              <text x={x} y={tr.pad.t - 4} textAnchor="middle" className={`line-lbl ${l.kind}`}>{l.label}</text>
            </g>
          );
        })}
      </svg>
      {onCrosshair && <CrosshairOverlay svgRef={svgRef} W={W} H={H} data={crosshair} />}
      </div>
      {showResidual && <ResidualStrip sed={primary} z={z} xScale={xScale} tr={tr} W={W} />}
      <p className="muted caption">
        Solid {primary.object.typeLabel} spectrum with labelled atomic/molecular lines shifted by (1+z);
        {showContinuum ? ' the dotted curve is the line-free continuum;' : ''} dashed curves are comparison targets.
      </p>
    </>
  );
}

// A crosshair tracker rendered as an absolutely-positioned overlay so it never
// forces the parent SVG to re-render on every mouse move.
function CrosshairOverlay({ svgRef, W, H, data }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const svg = svgRef && svgRef.current;
    if (!svg) return undefined;
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const y = ((e.clientY - r.top) / r.height) * H;
      setPos({ x, y });
    };
    const leave = () => setPos(null);
    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', leave);
    return () => { svg.removeEventListener('mousemove', move); svg.removeEventListener('mouseleave', leave); };
  }, [svgRef, W, H]);
  if (!pos) return null;
  const label = data ? `λ ${data.lambda.toFixed(4)} µm · ${data.flux.toFixed(2)} a.u.` : '';
  const lx = Math.min(Math.max(pos.x + 8, 60), W - 170);
  return (
    <svg className="sed-crosshair" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line x1={pos.x} y1={14} x2={pos.x} y2={H - 44} />
      <line x1={56} y1={pos.y} x2={W - 16} y2={pos.y} />
      {data && (
        <g className="cross-label">
          <rect x={lx - 5} y={20} width={168} height={16} rx="2" />
          <text x={lx} y={32}>{label}</text>
        </g>
      )}
    </svg>
  );
}

function ResidualStrip({ sed, z, xScale, tr, W }) {
  const Hr = 96;
  const padB = 18;
  const padT = 10;
  const residual = residualSpectrum(sed).filter((p) => Number.isFinite(p.y));
  if (!residual.length) return null;
  const rMax = Math.max(0.05, ...residual.map((p) => Math.abs(p.y))) * 1.05;
  const Y = (r) => padT + (1 - (r + rMax) / (2 * rMax)) * (Hr - padT - padB);
  // reuse the main x transform for column alignment
  const parts = [];
  for (const p of residual) {
    const x = tr.X(p.x);
    const y = Y(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    parts.push(parts.length === 0 ? `M${x},${y}` : `L${x},${y}`);
  }
  const visibleLines = (sed.lines || [])
    .map((l) => ({ ...l, obs: l.rest * (1 + z) }))
    .filter((l) => l.obs >= tr.wMin && l.obs <= tr.wMax);
  return (
    <div className="resid-wrap">
      <svg viewBox={`0 0 ${W} ${Hr}`} className="resid-chart" role="img" aria-label="Residual spectrum">
        <line x1={tr.pad.l} y1={Y(0)} x2={W - tr.pad.r} y2={Y(0)} className="resid-zero" />
        <text x={tr.pad.l - 6} y={Y(rMax) + 4} textAnchor="end" className="axis">+{Math.round(rMax * 100)}%</text>
        <text x={tr.pad.l - 6} y={Y(-rMax) + 4} textAnchor="end" className="axis">−{Math.round(rMax * 100)}%</text>
        <path d={parts.join(' ')} className="resid-line" />
        {visibleLines.map((l) => (
          <line key={'r' + l.label + l.obs.toFixed(4)} x1={tr.X(l.obs)} y1={padT} x2={tr.X(l.obs)} y2={Hr - padB} className={`line-w ${l.kind}`} />
        ))}
      </svg>
      <div className="cutout-cap mono">residual (flux − continuum)/continuum · line features sit above/below zero</div>
    </div>
  );
}

function LineTable({ sed, z }) {
  const rows = (sed.lines || []).map((l) => ({
    ...l,
    observed: l.rest * (1 + z),
    inWindow: l.rest * (1 + z) >= 0.2 && l.rest * (1 + z) <= 5.1,
  }));
  return (
    <div className="line-table-wrap">
      <table className="line-table">
        <thead>
          <tr><th>Line</th><th>Kind</th><th>λ rest (µm)</th><th>λ obs (µm)</th><th>Δλ (µm)</th><th>In window</th></tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.label + l.rest} className={l.kind}>
              <td>{l.label}</td>
              <td><span className={`kind-tag ${l.kind}`}>{l.kind === 'em' ? 'emission' : 'absorption'}</span></td>
              <td className="mono">{l.rest.toFixed(4)}</td>
              <td className="mono">{l.observed.toFixed(4)}</td>
              <td className="mono">{l.observed - l.rest >= 0 ? '+' : ''}{(l.observed - l.rest).toFixed(4)}</td>
              <td className="mono">{l.inWindow ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpectralImage2D({ sed }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !sed || !sed.spectrum || !sed.spectrum.length) return;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const spec = sed.spectrum;
    const cols = spec.length;
    const minf = Math.min(...spec.map((p) => p.flux));
    const maxf = Math.max(...spec.map((p) => p.flux));
    const lg = (f) => Math.log10(Math.max(f, minf * 0.1));
    const lmin = lg(minf);
    const lmax = lg(maxf);
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const cy = H / 2;
    const sigma = H * 0.16;
    for (let y = 0; y < H; y++) {
      const spat = Math.exp(-0.5 * Math.pow((y - cy) / sigma, 2));
      const tilt = Math.round(((y - cy) / H) * cols * 0.04);
      for (let c = 0; c < cols; c++) {
        const cc = c + tilt;
        if (cc < 0 || cc >= cols) continue;
        const t = (lg(spec[cc].flux) - lmin) / (lmax - lmin);
        const v = Math.min(255, Math.round(255 * Math.min(1, t * (0.12 + 0.88 * spat))));
        const x0 = Math.floor((c / cols) * W);
        const x1 = Math.min(W, Math.floor(((c + 1) / cols) * W));
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          d[i] = v;
          d[i + 1] = Math.round(v * 0.62);
          d[i + 2] = Math.round(v * 0.18);
          d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [sed]);
  return (
    <div className="spec2d">
      <canvas ref={ref} width={760} height={120} className="spec2d-canvas" />
      <div className="cutout-cap mono">2-D IFS-style cutout · dispersion λ 0.2–5.1 µm along x · spatial across y · brightness ∝ flux</div>
    </div>
  );
}

function PSFCutout({ o }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const ra = o ? o.ra || 0 : 0;
  const dec = o ? o.dec || 0 : 0;
  const mag = o ? o.mag : 18;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const S = cv.width;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, S, S);
    let seed = 20260929;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 220; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const a = 0.05 + rnd() * 0.2;
      ctx.fillStyle = `rgba(255,140,60,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }
    const cx = S / 2;
    const cy = S / 2;
    const scale = Math.pow(10, (18 - (mag || 18)) / 2.5);
    const peak = Math.min(255, 255 * scale);
    const sigma = 6 + rnd() * 2;
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    for (let y = cx - 34; y <= cx + 34; y++) {
      for (let x = cy - 34; x <= cy + 34; x++) {
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
    ctx.strokeStyle = 'rgba(255,106,0,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 14, cy - 14, 28, 28);
  }, [ra, dec, mag]);
  return (
    <div className="cutout" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <canvas ref={ref} width={260} height={260} />
      <div className="cutout-cap mono">RA {fmtRA(ra)} · DEC {fmtDec(dec)} · mag {mag}</div>
      {hover && <div className="tooltip">{`Aperture centre · ${fmtRA(ra)} ${fmtDec(dec)} · mag ${mag}`}</div>}
    </div>
  );
}

function HeatmapPanel({ heat, objects, onPick, compareMode }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const COLS = 40;
  // Map a pointer event to a cell using the *rendered* rect (not the intrinsic
  // canvas width) so the mapping stays correct under any CSS scaling.
  const geom = () => {
    if (!heat || !heat.bins.length || !ref.current) return null;
    const rect = ref.current.getBoundingClientRect();
    const ras = heat.bins.map((b) => b.ra);
    const decs = heat.bins.map((b) => b.dec);
    return {
      rect,
      raMin: Math.min(...ras),
      raMax: Math.max(...ras),
      decMin: Math.min(...decs),
      decMax: Math.max(...decs),
      maxCount: Math.max(...heat.bins.map((b) => b.count)),
    };
  };
  const nearest = (ra, dec) => {
    let best = null;
    let bd = Infinity;
    for (const o of objects) {
      const dRA = Math.min(Math.abs(o.ra - ra), 360 - Math.abs(o.ra - ra));
      const d = Math.hypot(dRA, o.dec - dec);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !heat || !heat.bins.length) return;
    const ctx = cv.getContext('2d');
    const S = cv.width;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, S, S);
    const ras = heat.bins.map((b) => b.ra);
    const decs = heat.bins.map((b) => b.dec);
    const raMin = Math.min(...ras);
    const raMax = Math.max(...ras);
    const decMin = Math.min(...decs);
    const decMax = Math.max(...decs);
    const maxCount = Math.max(...heat.bins.map((b) => b.count));
    const cell = S / COLS;
    for (const b of heat.bins) {
      const gx = Math.floor(((b.ra - raMin) / (raMax - raMin || 1)) * COLS);
      const gy = Math.floor(((decMax - b.dec) / (decMax - decMin || 1)) * COLS);
      const t = b.count / maxCount;
      ctx.fillStyle = `rgba(255,${Math.round(106 + 110 * t)},${Math.round(60 * t)},${0.14 + 0.85 * t})`;
      ctx.fillRect(gx * cell, gy * cell, cell, cell);
    }
    ctx.strokeStyle = 'rgba(255,106,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }, [heat]);

  if (!heat || !heat.bins.length) {
    return <div className="cutout"><canvas ref={ref} width={260} height={260} /><div className="cutout-cap mono">no data</div></div>;
  }
  const cellFromEvent = (e) => {
    const g = geom();
    if (!g) return null;
    const mx = e.clientX - g.rect.left;
    const my = e.clientY - g.rect.top;
    const gx = Math.floor((mx / g.rect.width) * COLS);
    const gy = Math.floor((my / g.rect.height) * COLS);
    if (gx < 0 || gy < 0 || gx >= COLS || gy >= COLS) return null;
    const ra = g.raMin + ((gx + 0.5) / COLS) * (g.raMax - g.raMin);
    const dec = g.decMax - ((gy + 0.5) / COLS) * (g.decMax - g.decMin);
    return { gx, gy, ra, dec, mx, my, g };
  };
  const onMove = (e) => {
    const c = cellFromEvent(e);
    if (!c) { setHover(null); return; }
    const obj = nearest(c.ra, c.dec);
    setHover({ x: c.mx, y: c.my, ra: c.ra, dec: c.dec, obj });
  };
  const onClick = (e) => {
    const c = cellFromEvent(e);
    if (!c) return;
    const obj = nearest(c.ra, c.dec);
    if (obj) onPick(obj.id);
  };
  return (
    <div className="cutout" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick} style={{ cursor: 'pointer' }}>
      <canvas ref={ref} width={260} height={260} />
      <div className="cutout-cap mono">{heat.pixelCount} cells · resol ~{heat.resolArcsec}″ · {compareMode ? 'compare mode' : 'click to load'}</div>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(hover.x + 12, 200), top: hover.y + 12 }}>
          <strong>{hover.obj ? `${hover.obj.id} · ${hover.obj.name}` : 'empty cell'}</strong>
          <div className="mono muted">{fmtRA(hover.ra)} {fmtDec(hover.dec)}</div>
          <div className="mono muted">{hover.obj ? `${hover.obj.typeLabel} · mag ${hover.obj.mag}` : 'no source'}</div>
        </div>
      )}
    </div>
  );
}

function HelpModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>SPECTRA — GUIDE & LEGEND</h2>
          <button className="btn sm" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">
          <h3>1-D Spectrum</h3>
          <p className="muted">Synthetic flux (arbitrary units, log scale) against observed wavelength (µm). The solid neon curve is the target; the dotted grey curve is the line-free continuum; dashed coloured curves are comparison sources. Cyan markers are <b>emission</b> lines, amber are <b>absorption</b> lines.</p>
          <h3>Redshift &amp; Auto-fit</h3>
          <p className="muted">z = Δλ/λ. Slide the slider to shift the rest-frame line template to λ<sub>obs</sub> = λ<sub>rest</sub>·(1+z) until it matches the observed features, or press <b>AUTO z</b> to recover it by cross-correlating the template with the residuals. The injected redshift is simulated; the estimator performs a genuine grid search over z.</p>
          <h3>Spectral Index &amp; Contrast</h3>
          <p className="muted"><b>α</b> is the rest-frame slope for F<sub>λ</sub> ∝ λ<sup>α</sup> fitted over the line-free continuum (negative = redder). <b>Line contrast</b> is the peak-to-valley flux ratio across the band, a quick proxy for line strength.</p>
          <h3>Bandpass Guide</h3>
          <p className="muted">The six SPHEREx near-infrared bandpasses are drawn across the top; the highlighted band is the target's dominant detection band.</p>
          <h3>Synthetic PSF</h3>
          <p className="muted">A Gaussian point-spread function rendering of the target at its RA/Dec and magnitude — a stand-in for a real image cutout.</p>
          <h3>HEALPix / NSIDE Resolution</h3>
          <p className="muted">The sky is tiled into equal-area HEALPix cells; <b>NSIDE</b> sets how fine the tiling is (higher = more, smaller cells). Click a bright cell to load that source's spectrum.</p>
        </div>
      </div>
    </div>
  );
}
