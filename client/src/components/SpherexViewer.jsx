// M3-C — the real SPHEREx product viewer.
//
// This tab shows the two actual reprojected observations of the North Ecliptic
// Pole deep field, produced by the Python sidecar and served by
// GET /api/spherex/products. See docs/spherex-m3c-contracts.md for the boundary
// this component is written against. Three things are deliberate:
//
//   * one display stretch is computed over *both* epochs, so neither can
//     auto-scale itself against the other and make a fake change;
//   * pixels the server did not certify (MASK = 0) stay transparent over a
//     distinct "no data" backdrop — faint data and no data must not look alike;
//   * while the sidecar's gate reports `quantitative_difference_enabled: false`
//     this view stays a labelled visualization. There is no control, here or in
//     the API, that computes a difference image, so there is nothing to switch on.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtRA, fmtDec } from '../lib/api.js';
import {
  computeStretch,
  decodeRaster,
  formatSky,
  insideRaster,
  makeScreenTransform,
  pixelToSky,
  renderRaster,
} from '../lib/spherex-view.js';

/** One metadata row: archive- or derived-supplied fact, rendered verbatim. */
function Fact({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd title={String(value)}>{String(value)}</dd>
    </div>
  );
}

function pct(v, digits = 4) {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : Number(v).toFixed(digits);
}

function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

/** A single epoch's image. Drawn at native resolution and scaled by CSS. */
function EpochPanel({ epoch, raster, stretch, wcs, width, height, cursor, onCursor }) {
  const canvasRef = useRef(null);
  const transform = useMemo(() => makeScreenTransform({ width, height }), [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rgba = renderRaster(raster, stretch);
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  }, [raster, stretch, width, height]);

  const pointer = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // CSS may scale the canvas; map back through the rect so the readout tracks
    // the pixel under the cursor rather than the pixel under the element.
    const sx = (event.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (event.clientY - rect.top) * (canvas.height / rect.height);
    const p = transform.screenToWcs(sx, sy);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };

  const handleMove = (event) => {
    const p = pointer(event);
    if (p) onCursor(insideRaster({ x: p.x, y: p.y }, width, height) ? p : null);
  };

  const valueAtCursor = cursor
    ? raster.image[cursor.y * width + cursor.x]
    : null;
  const validAtCursor = cursor
    ? raster.mask[cursor.y * width + cursor.x] === 1 && Number.isFinite(valueAtCursor)
    : false;

  return (
    <figure className="spherex-frame">
      <figcaption className="spherex-frame-head">
        <span className="spherex-epoch">{epoch.archive.label}</span>
        <span className="spherex-epoch-meta">
          {epoch.archive.date_obs_utc.slice(0, 10)} · MJD {Number(epoch.archive.mjd_obs).toFixed(3)} ·
          {' '}{width}×{height} px
        </span>
      </figcaption>
      <div className="spherex-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="spherex-canvas"
          width={width}
          height={height}
          role="img"
          aria-label={`SPHEREx ${epoch.archive.label}, ${epoch.archive.date_obs_utc.slice(0, 10)}`}
          onPointerMove={handleMove}
          onPointerLeave={() => onCursor(null)}
        />
      </div>
      <div className="spherex-frame-foot">
        <span>{validAtCursor
          ? `px ${cursor.x},${cursor.y} · ${valueAtCursor.toPrecision(6)} MJy/sr`
          : cursor
            ? `px ${cursor.x},${cursor.y} · no data`
            : 'move the cursor to read a pixel'}</span>
        <span>{epoch.archive.obs_id}</span>
      </div>
    </figure>
  );
}

export default function SpherexViewer() {
  const [state, setState] = useState({ status: 'loading', meta: null, rasters: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', meta: null, rasters: null, error: null });
    (async () => {
      try {
        const meta = await api.spherexProducts();
        const rasters = {};
        for (const epoch of meta.epochs) {
          const res = await fetch(epoch.raster);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const err = new Error(body.error || `raster ${epoch.role} -> ${res.status}`);
            err.status = res.status;
            err.code = body.code ?? null;
            throw err;
          }
          const bytesIn = new Uint8Array(await res.arrayBuffer());
          if (bytesIn.length !== meta.wire.byteLength) {
            throw new Error(
              `${epoch.role} raster is ${bytesIn.length} bytes, the wire contract says ${meta.wire.byteLength}`,
            );
          }
          const [width, height] = epoch.derived.shape;
          rasters[epoch.role] = decodeRaster(bytesIn, { width, height });
        }
        if (!cancelled) setState({ status: 'ready', meta, rasters, error: null });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', meta: null, rasters: null, error });
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  // One stretch over every epoch's valid pixels — never one per frame.
  const stretch = useMemo(() => {
    if (state.status !== 'ready') return null;
    const planes = state.meta.epochs.map((e) => state.rasters[e.role]);
    if (planes.length < 2) return computeStretch(planes[0].image, planes[0].mask);
    const image = new Float32Array(planes.reduce((n, p) => n + p.image.length, 0));
    const mask = new Uint8Array(planes.reduce((n, p) => n + p.mask.length, 0));
    let io = 0;
    let mo = 0;
    for (const p of planes) {
      image.set(p.image, io);
      io += p.image.length;
      mask.set(p.mask, mo);
      mo += p.mask.length;
    }
    return computeStretch(image, mask);
  }, [state]);

  if (state.status === 'loading') {
    return <div className="module-loading" role="status">Loading SPHEREx products</div>;
  }

  if (state.status === 'error') {
    // Retryable environment states come back as 503 with a machine-readable
    // code (no sidecar, archive unreachable, reprojection failed). Say so
    // instead of showing an empty picture.
    const err = state.error;
    return (
      <div className="module-error" role="alert">
        <p>Could not load the SPHEREx products</p>
        <p className="module-error-detail">
          {err.code ? `${err.code}: ` : ''}{err.message}
          {err.status === 503 ? ' — this is a transient environment failure, not a missing observation.' : ''}
        </p>
        <div className="module-error-actions">
          <button className="btn primary sm" onClick={() => setAttempt((a) => a + 1)}>Retry</button>
        </div>
      </div>
    );
  }

  const { meta } = state;
  const [width, height] = meta.epochs[0].derived.shape;
  const wcs = meta.epochs[0].derived.wcs;
  const twoUp = meta.epochs.length === 2;
  const sky = cursor
    ? pixelToSky(wcs, cursor.x + 0.5, cursor.y + 0.5)
    : null;

  return (
    <div className="spherex">
      <section className="panel">
        <div className="panel-head">
          <h2>SPHEREx · {meta.field.name}</h2>
          <span className="tag live">REAL OBSERVATIONS</span>
        </div>

        <p className="spherex-banner">
          {twoUp
            ? 'Visualization — spatial alignment only. Two observations on one agreed grid, shown side by side. No difference, subtraction or variability measurement is computed here.'
            : 'Single observation on the agreed grid.'}
        </p>

        <div className="spherex-grid" style={{ '--spherex-cols': twoUp ? 2 : 1 }}>
          {meta.epochs.map((epoch) => (
            <EpochPanel
              key={epoch.role}
              epoch={epoch}
              raster={state.rasters[epoch.role]}
              stretch={stretch}
              wcs={wcs}
              width={width}
              height={height}
              cursor={cursor}
              onCursor={setCursor}
            />
          ))}
        </div>

        <div className="spherex-readout">
          <span className="spherex-readout-sky">
            {sky ? fmtRA(sky.ra) : '—'} <span className="spherex-readout-sep">/</span> {sky ? fmtDec(sky.dec) : '—'}
          </span>
          <span className="spherex-readout-raw mono">
            {sky ? formatSky(sky) : 'cursor outside the image'}
          </span>
          <span className="spherex-readout-px mono">
            {cursor ? `pixel ${cursor.x}, ${cursor.y} (0-based)` : ''}
          </span>
        </div>

        <div className="spherex-legend">
          <span className="spherex-swatch" aria-hidden="true">
            <i style={{ background: `linear-gradient(90deg, rgb(0,0,0), rgb(255,255,255))` }} />
            <span className="mono">
              stretch {pct(stretch.lo, 3)} → {pct(stretch.hi, 3)} MJy/sr
              {' '}(1–99 pct, {stretch.sampleSize.toLocaleString('en-US')} valid px, shared by both epochs)
            </span>
          </span>
          <span className="spherex-swatch" aria-hidden="true">
            <i className="spherex-nodata" />
            <span className="mono">no data (outside footprint or invalid per the product flags)</span>
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>What is being shown</h2>
          <span className="tag">PROVENANCE</span>
        </div>

        <div className="spherex-meta">
          <div className="spherex-meta-block">
            <h3>Archive — what SPHEREx recorded</h3>
            <p className="spherex-note">
              Taken from the mission release manifest, unmodified.
            </p>
            <dl className="kv">
              <Fact label="MISSION" value={meta.mission} />
              <Fact label="RELEASE" value={meta.release?.label} />
              <Fact label="PRODUCT" value={meta.product?.type} />
              <Fact label="DOI" value={meta.release?.doi} />
              <Fact label="FIELD" value={meta.field.id} />
              <Fact label="CENTRE (ICRS)" value={`${meta.field.center.ra_deg}°, ${meta.field.center.dec_deg}°`} />
              <Fact label="BASELINE" value={meta.baseline_days ? `${Number(meta.baseline_days).toFixed(2)} d` : null} />
              <Fact label="USAGE TERMS" value={meta.rights?.terms} />
              <Fact label="CITATION" value={meta.rights?.citation_doi} />
            </dl>
          </div>

          <div className="spherex-meta-block">
            <h3>Derived — what this pipeline did</h3>
            <p className="spherex-note">
              Reprojected by the sidecar onto the agreed grid; every input and
              output is re-hashed by the server.
            </p>
            <dl className="kv">
              <Fact label="GRID" value={meta.grid?.id} />
              <Fact label="GRID SHAPE" value={meta.grid ? `[${meta.grid.shape.join(', ')}] (nx, ny)` : null} />
              <Fact label="PIXEL SCALE" value={meta.grid ? `${meta.grid.pixel_scale_arcsec}″/px` : null} />
              <Fact label="ORIENTATION" value={meta.grid?.orientation} />
              <Fact label="WIRE FORMAT" value={meta.wire?.format} />
              <Fact label="RASTER SIZE" value={meta.wire ? bytes(meta.wire.byteLength) : null} />
              <Fact label="SIDECAR" value={meta.sidecar ? `astropy ${meta.sidecar.astropy} · reproject ${meta.sidecar.reproject}` : null} />
              <Fact label="PYTHON" value={meta.sidecar?.python} />
            </dl>
          </div>

          <div className="spherex-meta-block">
            <h3>Display — computed in your browser</h3>
            <p className="spherex-note">
              Client-side only: never sent to the server, never stored.
            </p>
            <dl className="kv">
              <Fact label="STRETCH" value={stretch ? `${stretch.lowPct * 100}–${stretch.highPct * 100} percentile, linear` : null} />
              <Fact label="STRETCH RANGE" value={stretch ? `${pct(stretch.lo, 3)} → ${pct(stretch.hi, 3)} MJy/sr` : null} />
              <Fact label="NO-DATA PIXELS" value="transparent, drawn over a distinct backdrop" />
              <Fact label="COLORMAP" value="grayscale (linear in intensity)" />
              <Fact label="RESAMPLING" value="none — one image pixel per screen pixel" />
            </dl>
          </div>
        </div>

        <div className="spherex-meta-block">
          <h3>Scientific gate</h3>
          <dl className="kv">
            <Fact label="SPATIAL ALIGNMENT" value={meta.gate?.spatial_alignment ? 'ESTABLISHED' : 'NOT ESTABLISHED'} />
            <Fact label="QUANTITATIVE DIFFERENCE" value={meta.gate?.quantitative_difference_enabled ? 'ENABLED' : 'DISABLED'} />
            <Fact label="ALGORITHM" value={meta.alignment
              ? `integer-lag ±${Math.max(Math.abs(meta.alignment.lag_px[0]), Math.abs(meta.alignment.lag_px[1]))} px, peak ρ ${meta.alignment.peak_correlation} over ${meta.alignment.common_pixels.toLocaleString('en-US')} px`
              : null} />
            <Fact label="OFFSET" value={meta.alignment ? `${meta.alignment.offset_arcsec}″ (below one pixel)` : null} />
          </dl>
          <p className="spherex-note spherex-gate-rule">{meta.gate?.acceptance_rule}</p>
          {meta.gate?.still_required_for_comparability?.length > 0 && (
            <>
              <p className="spherex-note">Still required before any comparison could be called quantitative:</p>
              <ul className="spherex-list">
                {meta.gate.still_required_for_comparability.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="spherex-meta-block">
          <h3>Epochs</h3>
          {meta.epochs.map((epoch) => (
            <div key={epoch.role} className="spherex-epoch-block">
              <h4>{epoch.archive.label} · {epoch.archive.obs_id}</h4>
              <dl className="kv">
                <Fact label="OBSERVED (UTC)" value={epoch.archive.date_obs_utc} />
                <Fact label="MJD" value={epoch.archive.mjd_obs} />
                <Fact label="DETECTOR" value={epoch.archive.detector} />
                <Fact label="EXPOSURE" value={epoch.archive.exposure_sec ? `${epoch.archive.exposure_sec} s` : null} />
                <Fact label="QUALITY L1/L2" value={epoch.archive.quality
                  ? `${epoch.archive.quality.L1DQAFLG} / ${epoch.archive.quality.L2DQAFLG}`
                  : null} />
                <Fact label="PIPELINE" value={epoch.archive.pipeline_version} />
                <Fact label="UNITS" value={epoch.derived.units} />
                <Fact label="SHAPE" value={epoch.derived.shape ? `[${epoch.derived.shape.join(', ')}] (nx, ny)` : null} />
                <Fact label="VALID PIXELS" value={epoch.derived.stats ? pct(epoch.derived.stats.valid_fraction) : null} />
                <Fact label="COVERED" value={epoch.derived.stats ? pct(epoch.derived.stats.covered_fraction) : null} />
                <Fact label="QUALITY FLAGS" value={epoch.derived.stats ? pct(epoch.derived.stats.quality_flag_fraction) : null} />
                <Fact label="INFORMATIONAL" value={epoch.derived.stats ? pct(epoch.derived.stats.informational_flag_fraction) : null} />
                <Fact label="INPUT SHA-256" value={epoch.derived.input_sha256} />
                <Fact label="OUTPUT SHA-256" value={epoch.derived.output_sha256} />
              </dl>
            </div>
          ))}
        </div>

        {meta.caveats?.length > 0 && (
          <div className="spherex-meta-block">
            <h3>Caveats from the manifest</h3>
            <ul className="spherex-list">
              {meta.caveats.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        )}

        <p className="spherex-note spherex-credit">
          {meta.rights?.acknowledgement}
          {' '}<a href={meta.rights?.terms_url} target="_blank" rel="noreferrer">Usage terms</a>
        </p>
      </section>
    </div>
  );
}
