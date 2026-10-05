import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { raDecToNormalized } from '../lib/celestial.js';

// DSS cutouts cap at 2° server-side; keep each mosaic tile under that. `width`
// is in RA-coordinate degrees, so we pass aspect=1/cos(dec) to make tiles
// physically square on the sky and step the grid by that real footprint.
const TILE_CAP_DEG = 1.7;
const MAX_FIELD_DEG = 3.0; // max on-screen field for real imagery
const MIN_TILE = 0.3;
const COVER = 0.9;        // tile overlap (1-COVER) so tiles butt up, no gaps
const MAX_GRID = 8;       // cap tiles per axis
const CONCURRENCY = 4;    // simultaneous DSS fetches
const CACHE_LIMIT = 128;  // tile LRU cap so long pans don't balloon memory

function cosDec(dec) { return Math.max(0.12, Math.cos((dec * Math.PI) / 180)); }
const tileKey = (ra, dec, tile) => `${ra.toFixed(4)}/${dec.toFixed(4)}/${tile.toFixed(4)}`;

// Wrap the live view in a virtual `field` equal to the visible patch, so
// raDecToNormalized maps sky -> normalized -> mosaic pixels.
function mineView(v) {
  return { raCenter: v.ra, decCenter: v.dec, raHalf: v.raW / 2, decHalf: v.decH / 2 };
}

/**
 * Synced "REAL SKY" mosaic: reads the main sky viewer's view from `viewRef`
 * (updated on every pan/zoom) and renders the matching patch of sky as a grid
 * of real DSS cutouts, so travelling feels like one continuous image.
 */
export default function RealSkyMosaic({ viewRef }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const tiles = useRef(new Map());
  const order = useRef([]);
  const viewState = useRef({ last: null });
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tileCount, setTileCount] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const W = () => canvas.width / dpr;
    const H = () => canvas.height / dpr;
    // Maps normalized sky coords -> canvas pixels, preserving the true field
    // aspect ratio. Reassigned on every draw so the sky is never stretched,
    // even when the wrapper has been clamped by max-height.
    let p = (nx, ny) => ({ x: nx * W(), y: ny * H() });

    const cache = (key, entry) => {
      tiles.current.set(key, entry);
      order.current.push(key);
      while (order.current.length > CACHE_LIMIT) {
        const old = order.current.shift();
        tiles.current.delete(old);
      }
    };

    const drawTile = (meta, img, mine) => {
      if (!mine) return;
      const xL = p(raDecToNormalized(meta.raLeft, mine.decCenter, mine).nx, 0.5).x;
      const xR = p(raDecToNormalized(meta.raRight, mine.decCenter, mine).nx, 0.5).x;
      const yT = p(0.5, raDecToNormalized(mine.raCenter, meta.decTop, mine).ny).y;
      const yB = p(0.5, raDecToNormalized(mine.raCenter, meta.decBottom, mine).ny).y;
      ctx.drawImage(img, Math.min(xL, xR), Math.min(yT, yB), Math.abs(xR - xL), Math.abs(yB - yT));
    };

    const loadTile = async (ra, dec, tile, aspect) => {
      const key = tileKey(ra, dec, tile);
      if (tiles.current.has(key)) return true;
      try {
        // aspect = 1/cos(dec) makes the cutout physically square on the sky
        // (DSS `width` is in RA-coordinate degrees, not on-sky degrees).
        const res = await fetch(api.skyImageUrl(ra, dec, tile, { aspect, width: 360 }));
        if (!res.ok) return false;
        const meta = {
          raLeft: parseFloat(res.headers.get('X-Sky-Ra-Left')),
          raRight: parseFloat(res.headers.get('X-Sky-Ra-Right')),
          decTop: parseFloat(res.headers.get('X-Sky-Dec-Top')),
          decBottom: parseFloat(res.headers.get('X-Sky-Dec-Bottom')),
        };
        if (![meta.raLeft, meta.raRight, meta.decTop, meta.decBottom].every(Number.isFinite)) return false;
        const blob = await res.blob();
        let img;
        if (typeof createImageBitmap === 'function') img = await createImageBitmap(blob);
        else {
          img = new Image();
          await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = URL.createObjectURL(blob); });
        }
        cache(key, { img, meta });
        return true;
      } catch (e) { return false; }
    };

    const fetchMissing = async (missing, tile, aspect) => {
      setLoading(true);
      let idx = 0;
      let okCount = 0; let attemptCount = 0;
      const worker = async () => {
        while (idx < missing.length) {
          const [ra, dec] = missing[idx++];
          attemptCount += 1;
          if (await loadTile(ra, dec, tile, aspect)) okCount += 1;
        }
      };
      const workers = Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => worker());
      await Promise.all(workers);
      setLoading(false);
      if (viewState.current.last) drawCanvas();
      // Nothing loaded at all and nothing cached => archive is unreachable.
      if (attemptCount > 0 && okCount === 0 && tiles.current.size === 0) setError(true);
    };

    const drawCanvas = () => {
      const v = viewState.current.last;
      if (!v) return;
      const w = W();
      const h = H();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#04060b';
      ctx.fillRect(0, 0, w, h);

      const maxF = Math.max(v.raW, v.decH);
      if (maxF > MAX_FIELD_DEG) { setHint('ZOOM INTO THE SKY MAP'); setTileCount(0); return; }
      if (maxF < MIN_TILE * 0.5) { setHint('VERY DEEP'); setTileCount(0); return; }
      setHint('');

      // Fit the sky inside the canvas at its correct aspect ratio (letterboxed
      // if the wrapper is wider/taller than the field), so stars aren't stretched.
      const fa = v.raW / v.decH; // true sky aspect (w/h), constant = raHalf/decHalf
      let drawW = w; let drawH = h; let offX = 0; let offY = 0;
      if (w / h > fa) { drawH = h; drawW = h * fa; offX = (w - drawW) / 2; }
      else { drawW = w; drawH = w / fa; offY = (h - drawH) / 2; }
      p = (nx, ny) => ({ x: offX + nx * drawW, y: offY + ny * drawH });

      const c = cosDec(v.dec);
      const aspect = 1 / c; // makes each cutout physically square on the sky
      // Largest on-sky tile that still fits under the 2° RA-coordinate cap.
      const maxTile = Math.min(TILE_CAP_DEG, 2 * c);
      const tile = Math.max(MIN_TILE, Math.min(maxTile, maxF / 3));
      // Physically-square tiles: each spans `tile` on-sky in both axes, so the
      // grid counts/step derive from `tile` directly (no extra cos factor).
      const cols = Math.max(1, Math.ceil(v.raW / (tile * COVER)));
      const rows = Math.max(1, Math.ceil(v.decH / (tile * COVER)));
      if (cols > MAX_GRID || rows > MAX_GRID) { setHint('ZOOM INTO THE SKY MAP'); setTileCount(0); return; }

      const mine = mineView(v); // keep the raw view in `last`; mine is only for mapping
      const raStep = (tile * COVER) / c; // overlap in RA-coordinate degrees
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
          if (te) { drawTile(te.meta, te.img, mine); drawn++; }
        }
      }
      setTileCount(drawn);
      if (drawn > 0) setError(false);
      const missing = keys.filter(([ra, dec]) => !tiles.current.has(tileKey(ra, dec, tile)));
      if (missing.length) fetchMissing(missing, tile, aspect);
      else setLoading(false);
    };

    // Follow the synced view with a small debounce so an idle canvas doesn't
    // churn the tile fetcher while the user is still dragging.
    let raf = null;
    let timer = null;
    let last = '';
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = viewRef.current;
      if (!v) return;
      const sig = `${v.ra.toFixed(4)}|${v.dec.toFixed(4)}|${v.raW.toFixed(5)}|${v.decH.toFixed(5)}|${v.zoom.toFixed(3)}`;
      if (sig !== last) {
        last = sig;
        clearTimeout(timer);
        timer = setTimeout(() => {
          viewState.current.last = v;
          drawCanvas();
        }, 160);
      }
    };
    raf = requestAnimationFrame(loop);

    const resize = () => {
      const w = Math.max(2, wrap.clientWidth);
      const h = Math.max(2, wrap.clientHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      if (viewState.current.last) drawCanvas();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    return () => { cancelAnimationFrame(raf); clearTimeout(timer); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="realsky panel">
      <div className="panel-head">
        <h2>REAL SKY · SYNCED MOSAIC</h2>
        <span className="tag">{tileCount > 0 ? `${tileCount} TILES` : 'DSS'}</span>
      </div>
      <p className="muted caption">
        Real Digitized-Sky-Survey tiles, synced to the sky map. Pan / zoom the map and this follows — tiles
        load together so the sky feels continuous.
      </p>
      <div className="realsky-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="realsky-canvas" />
        {error && <div className="imagery-badge hint real">REAL SKY UNREACHABLE — check the server / DSS network</div>}
        {!error && hint && <div className="imagery-badge hint real">{hint}</div>}
        {!error && !hint && loading && <div className="imagery-badge loading real">LOADING REAL SKY…</div>}
        {!error && !hint && !loading && tileCount === 0 && (
          <div className="imagery-badge hint real">SWEEP THE SKY MAP TO FETCH TILES</div>
        )}
      </div>
    </div>
  );
}