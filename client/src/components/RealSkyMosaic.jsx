import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { raDecToNormalized, normalizedToRaDec } from '../lib/celestial.js';

// DSS cutouts cap at 2° server-side; keep each mosaic tile under that. We request
// square (aspect=1) cutouts, then resample each to square-on-sky pixels on load
// (DSS `width` is in RA-coordinate degrees), so tiles look round and gap-free.
const TILE_CAP_DEG = 1.7;
const MAX_FIELD_DEG = 3.0; // max on-screen field for real imagery
const MIN_TILE = 0.3;
const COVER = 0.9;       // tile overlap (1-COVER) so tiles butt up, no gaps
const MAX_GRID = 8;       // cap tiles per axis
const CONCURRENCY = 4;    // simultaneous DSS fetches
const CACHE_LIMIT = 160;  // tile LRU cap so long pans don't balloon memory

function cosDec(dec) { return Math.max(0.12, Math.cos((dec * Math.PI) / 180)); }
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const tileKey = (ra, dec, tile) => `${ra.toFixed(4)}/${dec.toFixed(4)}/${tile.toFixed(4)}`;

// Wrap the live view in a virtual `field` equal to the visible patch, so
// raDecToNormalized maps sky -> normalized -> mosaic pixels.
function mineView(v) {
  return { raCenter: v.ra, decCenter: v.dec, raHalf: v.raW / 2, decHalf: v.decH / 2 };
}

/**
 * An interactive "REAL SKY" mosaic. It starts synced to the main sky map
 * (`viewRef`), but you can drag to pan and scroll/wheel to zoom directly inside
 * this panel — it then goes MANUAL (with a re-sync button).
 */
export default function RealSkyMosaic({ field, viewRef }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const tiles = useRef(new Map());
  const order = useRef([]);
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tileCount, setTileCount] = useState(0);
  const [mode, setMode] = useState('...'); // 'follow' | 'manual'
  const [readout, setReadout] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = () => canvas.width / dpr;
    const H = () => canvas.height / dpr;

    // Mosaic's own pan/zoom state (normalized to the survey field).
    let cx = 0.5; let cy = 0.5; let zoom = 12; let manual = false; let lastFollow = '';
    let drag = null;
    let renderTimer = null;
    let raf = null;
    const toView = () => {
      const { ra, dec } = normalizedToRaDec(cx, cy, field || { raCenter: 84, decCenter: -58, raHalf: 14, decHalf: 9 });
      const f = field || { raHalf: 14, decHalf: 9 };
      return { ra, dec, raW: (2 * f.raHalf) / zoom, decH: (2 * f.decHalf) / zoom, zoom };
    };
    const adoptView = (v) => {
      const f = field || { raHalf: 14, decHalf: 9 };
      const { nx, ny } = raDecToNormalized(v.ra, v.dec, f);
      cx = clamp01(nx); cy = clamp01(ny);
      zoom = Math.min(120, Math.max(1, (2 * f.raHalf) / (v.raW || 0.1)));
    };

    // Maps normalized sky coords -> canvas px, preserving true field aspect.
    let p = (nx, ny) => ({ x: nx * W(), y: ny * H() });
    const cache = (key, entry) => {
      tiles.current.set(key, entry);
      order.current.push(key);
      while (order.current.length > CACHE_LIMIT) { const old = order.current.shift(); tiles.current.delete(old); }
    };

    const drawTile = (meta, img) => {
      const mine = { raCenter: toView().ra, decCenter: toView().dec, raHalf: toView().raW / 2, decHalf: toView().decH / 2 };
      const xL = p(raDecToNormalized(meta.raLeft, mine.decCenter, mine).nx, 0.5).x;
      const xR = p(raDecToNormalized(meta.raRight, mine.decCenter, mine).nx, 0.5).x;
      const yT = p(0.5, raDecToNormalized(mine.raCenter, meta.decTop, mine).ny).y;
      const yB = p(0.5, raDecToNormalized(mine.raCenter, meta.decBottom, mine).ny).y;
      ctx.drawImage(img, Math.min(xL, xR), Math.min(yT, yB), Math.abs(xR - xL), Math.abs(yB - yT));
    };

    const loadImageEl = (blob) => new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = URL.createObjectURL(blob);
    });

    const loadTile = async (ra, dec, tile) => {
      const key = tileKey(ra, dec, tile);
      if (tiles.current.has(key)) return true;
      try {
        // aspect=1: DSS `width` is in RA-coordinate degrees, so a square request
        // spans size·cos(dec) on-sky in RA and size in Dec — its source pixels
        // are anisotropic on the sky by 1/cos(dec). We resample each tile to
        // square-on-sky pixels here, then draw it into its WCS-corner box below,
        // so the content stays round and the mosaic stays gap-free.
        const res = await fetch(api.skyImageUrl(ra, dec, tile, { aspect: 1, width: 360 }));
        if (!res.ok) return false;
        const meta = {
          raLeft: parseFloat(res.headers.get('X-Sky-Ra-Left')),
          raRight: parseFloat(res.headers.get('X-Sky-Ra-Right')),
          decTop: parseFloat(res.headers.get('X-Sky-Dec-Top')),
          decBottom: parseFloat(res.headers.get('X-Sky-Dec-Bottom')),
        };
        if (![meta.raLeft, meta.raRight, meta.decTop, meta.decBottom].every(Number.isFinite)) return false;
        const blob = await res.blob();
        const raw = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : await loadImageEl(blob);

        const decC = (meta.decTop + meta.decBottom) / 2;
        const physW = Math.abs(meta.raLeft - meta.raRight) * cosDec(decC); // on-sky degrees wide
        const physH = Math.abs(meta.decTop - meta.decBottom);              // on-sky degrees tall
        if (!(physW > 0 && physH > 0)) return false;

        // Resample so pixel aspect matches the on-sky footprint => content round.
        const corrW = raw.width;
        const corrH = Math.max(1, Math.round(raw.width * (physH / physW)));
        const off = document.createElement('canvas');
        off.width = corrW;
        off.height = corrH;
        off.getContext('2d').drawImage(raw, 0, 0, corrW, corrH);

        cache(key, { img: off, meta });
        return true;
      } catch (e) { return false; }
    };

    const fetchMissing = async (missing, tile) => {
      setLoading(true);
      let idx = 0; let ok = 0; let att = 0;
      const worker = async () => {
        while (idx < missing.length) {
          const [ra, dec] = missing[idx++];
          att += 1;
          if (await loadTile(ra, dec, tile)) ok += 1;
        }
      };
      const workers = Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => worker());
      await Promise.all(workers);
      setLoading(false);
      drawCanvas();
      if (att > 0 && ok === 0 && tiles.current.size === 0) setError(true);
    };

    const drawCanvas = () => {
      const v = toView();
      const w = W(); const h = H();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#04060b';
      ctx.fillRect(0, 0, w, h);

      const maxF = Math.max(v.raW, v.decH);
      if (maxF > MAX_FIELD_DEG) { setHint('ZOOM INTO THE SKY MAP'); setTileCount(0); setReadout(readoutText(v)); setLoading(false); return; }
      if (maxF < MIN_TILE * 0.5) { setHint('VERY DEEP — SCROLL OUT'); setTileCount(0); setLoading(false); return; }
      setHint('');

      // Preserve true sky aspect (letterbox if the wrapper was height-clamped).
      const fa = v.raW / v.decH;
      let drawW = w, drawH = h, offX = 0, offY = 0;
      if (w / h > fa) { drawH = h; drawW = h * fa; offX = (w - drawW) / 2; }
      else { drawW = w; drawH = w / fa; offY = (h - drawH) / 2; }
      p = (nx, ny) => ({ x: offX + nx * drawW, y: offY + ny * drawH });

      const c = cosDec(v.dec);
      const tile = Math.min(TILE_CAP_DEG, Math.max(MIN_TILE, maxF / 3));
      // aspect=1 tiles are size·cos(dec) on-sky wide and size tall, so columns
      // are cos-heavier and RA tile centres step by `tile` (coordinates).
      const cols = Math.max(1, Math.ceil(v.raW / (tile * c * COVER)));
      const rows = Math.max(1, Math.ceil(v.decH / (tile * COVER)));
      if (cols > MAX_GRID || rows > MAX_GRID) { setHint('ZOOM INTO THE SKY MAP'); setTileCount(0); setLoading(false); return; }

      const raStep = tile * COVER;     // RA-coordinate step (physical = ×cos)
      const decStep = tile * COVER;
      let drawn = 0;
      const keys = [];
      for (let j = 0; j < rows; j++) {
        const decT = v.dec + (j - (rows - 1) / 2) * decStep;
        for (let i = 0; i < cols; i++) {
          const raT = v.ra + (i - (cols - 1) / 2) * raStep;
          const key = tileKey(raT, decT, tile);
          keys.push([raT, decT]);
          const te = tiles.current.get(key);
          if (te) { drawTile(te.meta, te.img); drawn++; }
        }
      }
      setTileCount(drawn);
      if (drawn > 0) setError(false);
      setReadout(readoutText(v));
      const missing = keys.filter(([ra, dec]) => !tiles.current.has(tileKey(ra, dec, tile)));
      if (missing.length) fetchMissing(missing, tile);
      else setLoading(false);
    };

    const readoutText = (v) => `RA ${v.ra.toFixed(2)}° · DEC ${v.dec.toFixed(2)}° · ${Math.round(v.raW * 60)}\u2032 field · ×${v.zoom.toFixed(1)}`;
    const scheduleRender = () => { clearTimeout(renderTimer); renderTimer = setTimeout(drawCanvas, 140); };

    setMode(manual ? 'manual' : 'follow');
    const sync = () => { manual = false; if (viewRef.current) adoptView(viewRef.current); setMode('follow'); scheduleRender(); };

    // Follow the main map until the user interacts with this panel.
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = viewRef.current;
      if (!v) return;
      const sig = `${v.ra.toFixed(4)}|${v.dec.toFixed(4)}|${v.raW.toFixed(5)}|${v.decH.toFixed(5)}`;
      if (!manual && sig !== lastFollow) {
        lastFollow = sig;
        adoptView(v);
        setMode('follow');
        scheduleRender();
      }
    };
    raf = requestAnimationFrame(loop);

    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = toLocal(e);
      drag = { x: p.x, y: p.y, cx, cy };
      if (!manual) { manual = true; setMode('manual'); }
    };
    const onMove = (e) => {
      if (!drag) return;
      const p = toLocal(e);
      cx = clamp01(drag.cx - (p.x - drag.x) / W() / zoom);
      cy = clamp01(drag.cy - (p.y - drag.y) / H() / zoom);
      scheduleRender();
    };
    const onUp = () => { drag = null; drawCanvas(); };
    const onWheel = (e) => {
      e.preventDefault();
      if (!manual) { manual = true; setMode('manual'); }
      const f = Math.pow(1.002, -e.deltaY);
      zoom = Math.min(120, Math.max(1, zoom * f));
      scheduleRender();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const w = Math.max(2, wrap.clientWidth);
      const h = Math.max(2, wrap.clientHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      drawCanvas();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    window.__ncSync = sync; // tiny escape hatch for the re-sync button
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(renderTimer);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => { if (window.__ncSync) window.__ncSync(); };

  return (
    <div className="realsky panel">
      <div className="panel-head">
        <h2>REAL SKY · SYNCED MOSAIC</h2>
        <div className="realsky-head-btns">
          <span className={`tag${mode === 'manual' ? '' : ' live'}`}>{mode === 'manual' ? 'MANUAL' : 'FOLLOW MAP'}</span>
          {mode === 'manual' && <button className="btn sm" onClick={sync}>⟳ RE-SYNC</button>}
          <span className="tag">{tileCount > 0 ? `${tileCount} TILES` : 'DSS'}</span>
        </div>
      </div>
      <p className="muted caption">
        Real Digitized-Sky-Survey tiles. <em>Drag to pan — scroll/wheel to zoom — right in this panel.</em>{' '}
        Follows the sky map until you move it.
      </p>
      <div className="realsky-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="realsky-canvas" />
        {error && <div className="imagery-badge hint real">REAL SKY UNREACHABLE — check the server / DSS network</div>}
        {!error && hint && <div className="imagery-badge hint real">{hint}</div>}
        {!error && !hint && loading && <div className="imagery-badge loading real">LOADING REAL SKY…</div>}
        {!error && !hint && !loading && tileCount === 0 && (
          <div className="imagery-badge hint real">Drag or scroll to explore</div>
        )}
        {readout && <div className="sky-readout real">{readout}</div>}
      </div>
    </div>
  );
}
